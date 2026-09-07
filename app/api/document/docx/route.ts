import { requireUser, documentAccess, loadTemplate, approvedFile, event, sha, fail } from "../../../../lib/access";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, HorizontalPositionRelativeFrom,
  ImageRun, LevelFormat, LevelSuffix, LineRuleType, NumberFormat, Packer,
  LeaderType, PageBorderDisplay, PageBorderOffsetFrom, PageBreak, PageNumber, Paragraph,
  SectionType, ShadingType, Tab, Table, TableCell, TableLayoutType,
  TableRow, TabStopType, TextRun, TextWrappingType, UnderlineType, VerticalAlignTable, VerticalPositionRelativeFrom, WidthType,
} from "docx";
import { CCPL_LOGO_BASE64 } from "../../../../lib/ccpl-logo";
import { db, ensureSchema, parseTemplate, seedIfEmpty, type DocumentBlock, type TemplateRow } from "../../../../lib/form-store";

export const dynamic = "force-dynamic";

const PAGE_WIDTH = 11907;
const PAGE_HEIGHT = 16839;
const PAGE_MARGIN = 1440;
const HEADER_DISTANCE = 720;
const FOOTER_DISTANCE = 288;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;
const GREEN = "538135";
const BLACK = "000000";
const GRAY = "666666";
const LIGHT_GRAY = "EFEFEF";
const CORBEL = { ascii: "Corbel", hAnsi: "Corbel", eastAsia: "Corbel", cs: "Times New Roman" };
const GRID_BORDER = { style: BorderStyle.SINGLE, size: 8, color: BLACK };
const TRANSPARENT_PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xw9vWQAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));

type TemplateType = ReturnType<typeof parseTemplate>;

function clean(value: unknown) {
  return String(value ?? "").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\t\r]+/g, " ").trim();
}

function inlineClean(value: unknown) {
  return clean(value).replace(/\s+/g, " ");
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function displayDate(value: string) {
  if (!value) return "Pending";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? inlineClean(value) : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function run(text: unknown, options: { size?: number; bold?: boolean; italics?: boolean; color?: string; underline?: boolean; allCaps?: boolean } = {}) {
  const safeText = String(text ?? "").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/[\t\r\n]+/g, " ");
  return new TextRun({
    text: safeText,
    font: CORBEL,
    size: options.size ?? 24,
    sizeComplexScript: options.size ?? 24,
    bold: options.bold,
    boldComplexScript: options.bold,
    italics: options.italics,
    italicsComplexScript: options.italics,
    color: options.color ?? BLACK,
    allCaps: options.allCaps,
    underline: options.underline ? { type: UnderlineType.SINGLE, color: options.color ?? BLACK } : undefined,
  });
}

function paragraph(text: unknown, options: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; size?: number; bold?: boolean; italics?: boolean; color?: string; before?: number; after?: number; line?: number; keepNext?: boolean; pageBreakBefore?: boolean; underline?: boolean } = {}) {
  return new Paragraph({
    alignment: options.align ?? AlignmentType.JUSTIFIED,
    spacing: { before: options.before ?? 0, after: options.after ?? 120, line: options.line ?? 360, lineRule: LineRuleType.AUTO },
    keepNext: options.keepNext,
    pageBreakBefore: options.pageBreakBefore,
    children: [run(text, { size: options.size, bold: options.bold, italics: options.italics, color: options.color, underline: options.underline })],
  });
}

function emptyParagraph(after: number) {
  return new Paragraph({ spacing: { before: 0, after, line: 240 }, children: [run("", { size: 2 })] });
}

function pageBorders() {
  return {
    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
    pageBorderTop: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 24, color: BLACK, space: 8 },
    pageBorderLeft: { style: BorderStyle.THICK_THIN_SMALL_GAP, size: 24, color: BLACK, space: 8 },
    pageBorderBottom: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 24, color: BLACK, space: 8 },
    pageBorderRight: { style: BorderStyle.THIN_THICK_SMALL_GAP, size: 24, color: BLACK, space: 8 },
  };
}

function sectionPage(formatType: (typeof NumberFormat)[keyof typeof NumberFormat], start = 1, borders = true) {
  return {
    size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    margin: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN, header: HEADER_DISTANCE, footer: FOOTER_DISTANCE },
    pageNumbers: { start, formatType },
    borders: borders ? pageBorders() : undefined,
  };
}

function imageDimensions(bytes: Uint8Array, mime: string) {
  if (mime.includes("png") && bytes.length > 24) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mime.includes("jpeg") || mime.includes("jpg")) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] };
      offset += Math.max(length + 2, 2);
    }
  }
  return { width: 800, height: 450 };
}

function logoRun(width: number, height: number) {
  return new ImageRun({ type: "png", data: fromBase64(CCPL_LOGO_BASE64), transformation: { width, height }, altText: { name: "CCPL logo", title: "Common Criteria Pakistan Lab", description: "CCPL logo" } });
}

function headerTable(template: TemplateType) {
  const widths = [1200, 2500, CONTENT_WIDTH - 3700];
  const bottom = { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLACK } };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { top: { style: BorderStyle.NONE }, bottom: GRID_BORDER, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: widths[0], type: WidthType.DXA }, verticalAlign: VerticalAlignTable.CENTER, borders: bottom, margins: { top: 30, bottom: 60, left: 0, right: 60 }, children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [logoRun(32, 32)] })] }),
      new TableCell({ width: { size: widths[1], type: WidthType.DXA }, verticalAlign: VerticalAlignTable.CENTER, borders: bottom, margins: { top: 30, bottom: 60, left: 60, right: 60 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(template.documentMeta.classification, { size: 18, bold: true })] })] }),
      new TableCell({ width: { size: widths[2], type: WidthType.DXA }, verticalAlign: VerticalAlignTable.CENTER, borders: bottom, margins: { top: 30, bottom: 60, left: 60, right: 0 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${template.code} | ${template.name}`, { size: 18, bold: true })] })] }),
    ] })],
  });
}

function watermarkParagraph(template: TemplateType) {
  if (template.documentMeta.documentStatus === "APPROVED") return null;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="240" viewBox="0 0 700 240"><g transform="translate(350 120) rotate(-35)"><text x="0" y="32" text-anchor="middle" font-family="Arial" font-size="120" font-weight="700" fill="#777777" fill-opacity="0.14">DRAFT</text></g></svg>`;
  return new Paragraph({ children: [new ImageRun({
    type: "svg", data: new TextEncoder().encode(svg), fallback: { type: "png", data: TRANSPARENT_PNG }, transformation: { width: 520, height: 180 },
    floating: { horizontalPosition: { relative: "page", offset: 550000 }, verticalPosition: { relative: "page", offset: 3600000 }, behindDocument: true, allowOverlap: true, wrap: { type: 0 } },
    altText: { name: "Draft watermark", title: "DRAFT", description: "Draft document watermark" },
  })] });
}

function header(template: TemplateType) {
  const watermark = watermarkParagraph(template);
  return new Header({ children: [...(watermark ? [watermark] : []), headerTable(template)] });
}

function footer(template: TemplateType, body: boolean, totalBodyPages = 1) {
  const widths = [2600, 3300, CONTENT_WIDTH - 5900];
  const rightChildren = body
    ? [run("Page ", { size: 16 }), new TextRun({ children: [PageNumber.CURRENT], font: CORBEL, size: 16 }), run(` of ${totalBodyPages}`, { size: 16 })]
    : [new TextRun({ children: [PageNumber.CURRENT], font: CORBEL, size: 16 })];
  return new Footer({ children: [new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
    borders: { top: GRID_BORDER, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: widths[0], type: WidthType.DXA }, margins: { top: 80, bottom: 0, left: 0, right: 30 }, children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [run(`Version ${template.documentMeta.versionLabel || template.version}`, { size: 16 })] })] }),
      new TableCell({ width: { size: widths[1], type: WidthType.DXA }, margins: { top: 80, bottom: 0, left: 30, right: 30 }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(template.documentMeta.classification, { size: 16, bold: true })] })] }),
      new TableCell({ width: { size: widths[2], type: WidthType.DXA }, margins: { top: 80, bottom: 0, left: 30, right: 0 }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: rightChildren })] }),
    ] })],
  })] });
}

function coverMetadata(label: string, value: string) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 90, line: 276, lineRule: LineRuleType.AUTO }, children: [run(`${label}:`, { size: 20, bold: true, color: GRAY }), run(` ${value || "Not set"}`, { size: 20 })] });
}

function coverChildren(template: TemplateType) {
  const barSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="54" viewBox="0 0 794 54"><rect width="794" height="54" fill="#538135"/><text x="397" y="35" text-anchor="middle" font-family="Arial" font-size="18" font-weight="700" fill="#ffffff">${template.documentMeta.classification}</text></svg>`;
  return [
    emptyParagraph(900),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [logoRun(145, 145)] }),
    paragraph("COMMON CRITERIA PAKISTAN LAB", { align: AlignmentType.CENTER, size: 22, bold: true, color: GRAY, after: 150, line: 276 }),
    paragraph(template.documentMeta.documentType, { align: AlignmentType.CENTER, size: 32, bold: true, color: GREEN, after: 180, line: 300 }),
    paragraph(template.name, { align: AlignmentType.CENTER, size: 40, bold: true, after: 250, line: 360 }),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GRAY } }, spacing: { after: 180 }, children: [run("", { size: 2 })] }),
    paragraph(template.code, { align: AlignmentType.CENTER, size: 21, after: 70, line: 260 }),
    paragraph(`Version ${template.documentMeta.versionLabel || template.version}`, { align: AlignmentType.CENTER, size: 21, after: 150, line: 260 }),
    coverMetadata("Prepared by", template.documentMeta.preparedBy),
    coverMetadata("Document Owner", template.documentMeta.documentOwner),
    coverMetadata("Document Status", template.documentMeta.documentStatus),
    coverMetadata("Effective Date", template.documentMeta.effectiveDate ? displayDate(template.documentMeta.effectiveDate) : "Pending Director approval"),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0, line: 20 }, children: [new ImageRun({
      type: "svg", data: new TextEncoder().encode(barSvg), fallback: { type: "png", data: TRANSPARENT_PNG }, transformation: { width: 794, height: 54 },
      floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 10174000 }, allowOverlap: true, behindDocument: false, wrap: { type: TextWrappingType.NONE } },
      altText: { name: "Classification bar", title: template.documentMeta.classification, description: "Document classification" },
    })] }),
  ];
}

function historyTable(versions: TemplateType[]) {
  const widths = [980, 1450, 2200, 1350, 1450, CONTENT_WIDTH - 7430];
  const labels = ["Version", "Revision Date", "Change Description", "Prepared By", "Reviewed By", "Approved By"];
  const history = [...versions].sort((a, b) => a.version - b.version);
  const rows: TableRow[] = [new TableRow({ tableHeader: true, children: labels.map((label, index) => new TableCell({ width: { size: widths[index], type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, fill: LIGHT_GRAY }, margins: { top: 130, bottom: 130, left: 80, right: 80 }, verticalAlign: VerticalAlignTable.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(label, { size: 19, bold: true })] })] })) })];
  history.forEach((version) => {
    const values = [version.documentMeta.versionLabel || version.version, displayDate(version.revisionDate || version.updatedAt), version.changeDescription || "Initial issue", version.documentMeta.preparedBy || version.createdBy, version.documentMeta.reviewedBy || "Pending", version.documentMeta.approvedBy || "Pending"];
    rows.push(new TableRow({ cantSplit: true, children: values.map((value, index) => new TableCell({ width: { size: widths[index], type: WidthType.DXA }, margins: { top: 140, bottom: 140, left: 80, right: 80 }, verticalAlign: VerticalAlignTable.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: 276 }, children: [run(value, { size: 18 })] })] })) }));
  });
  while (rows.length < 4) rows.push(new TableRow({ children: widths.map((width) => new TableCell({ width: { size: width, type: WidthType.DXA }, margins: { top: 260, bottom: 260, left: 80, right: 80 }, children: [new Paragraph({ children: [run("", { size: 18 })] })] })) }));
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: { top: GRID_BORDER, bottom: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER, insideHorizontal: GRID_BORDER, insideVertical: GRID_BORDER }, rows });
}

function contentTable(block: DocumentBlock) {
  const cells = block.cells?.length ? block.cells : [[""]];
  const columns = Math.max(1, cells[0]?.length || 1);
  const base = Math.floor(CONTENT_WIDTH / columns);
  const widths = Array.from({ length: columns }, (_, index) => index === columns - 1 ? CONTENT_WIDTH - base * (columns - 1) : base);
  const rows = cells.map((row, rowIndex) => new TableRow({ tableHeader: block.headerRow !== false && rowIndex === 0, cantSplit: true, children: widths.map((width, columnIndex) => new TableCell({ width: { size: width, type: WidthType.DXA }, verticalAlign: VerticalAlignTable.CENTER, shading: block.headerRow !== false && rowIndex === 0 ? { type: ShadingType.CLEAR, fill: LIGHT_GRAY } : undefined, margins: { top: 100, bottom: 100, left: 100, right: 100 }, children: [new Paragraph({ alignment: AlignmentType.LEFT, spacing: { line: 276 }, children: [run(row[columnIndex] || "", { size: 20, bold: block.headerRow !== false && rowIndex === 0 })] })] })) }));
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, borders: { top: GRID_BORDER, bottom: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER, insideHorizontal: GRID_BORDER, insideVertical: GRID_BORDER }, rows });
}

function estimateBodyPagination(blocks: DocumentBlock[]) {
  const pageByHeading = new Map<string, number>();
  let page = 1;
  let used = 0;
  const budget = 10100;
  const blockUnits = (block: DocumentBlock) => {
    if (block.type === "heading1") return 700;
    if (block.type === "heading2") return 600;
    if (block.type === "heading3") return 550;
    if (block.type === "paragraph") return Math.max(480, Math.ceil(inlineClean(block.text).length / 88) * 360 + 120);
    if (block.type === "bullets") return Math.max(480, (block.items || []).filter((item) => inlineClean(item)).reduce((sum, item) => sum + Math.max(1, Math.ceil(inlineClean(item).length / 78)) * 360 + 80, 0));
    if (block.type === "table") return 360 + Math.max(1, block.cells?.length || 1) * 620;
    if (block.type === "image") return 4200;
    if (block.type === "signature") return Math.max(1, clean(block.text).split(/\n+/).filter(Boolean).length) * 720;
    if (block.type === "spacer") return Math.max(120, (block.spacerHeight || 18) * 20);
    if (block.type === "divider") return 300;
    return 0;
  };
  blocks.forEach((block) => {
    if (block.type === "page-break") { if (used > 0) { page += 1; used = 0; } return; }
    const units = blockUnits(block);
    if (used > 0 && used + units > budget) { page += 1; used = 0; }
    if (block.type === "heading1") pageByHeading.set(block.id, page);
    used += units;
  });
  return { pageByHeading, total: Math.max(1, page) };
}

function staticToc(template: TemplateType, pageByHeading: Map<string, number>) {
  let number = 0;
  return (template.contentSchema as DocumentBlock[]).filter((block) => block.type === "heading1").map((block) => {
    number += 1;
    return new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9000, leader: LeaderType.NONE }],
      spacing: { after: 140, line: 300, lineRule: LineRuleType.AUTO },
      children: [run(`${number}.    ${block.text || "Untitled heading"}`, { size: 22 }), new TextRun({ children: [new Tab()], font: CORBEL, size: 22 }), run(String(pageByHeading.get(block.id) || 1), { size: 22 })],
    });
  });
}

function bodyChildren(template: TemplateType) {
  const children: Array<Paragraph | Table> = [];
  for (const block of template.contentSchema as DocumentBlock[]) {
    if (block.type === "heading1" || block.type === "heading2" || block.type === "heading3") {
      const level = block.type === "heading1" ? 0 : block.type === "heading2" ? 1 : 2;
      const heading = level === 0 ? HeadingLevel.HEADING_1 : level === 1 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ heading, numbering: { reference: "document-headings", level }, keepNext: true, spacing: { before: level === 0 ? 240 : 180, after: level === 0 ? 120 : 90, line: 276 }, children: [run(block.text || "Untitled heading", { size: level === 0 ? 28 : level === 1 ? 28 : 24, bold: true })] }));
    } else if (block.type === "paragraph") {
      const align = block.align === "center" ? AlignmentType.CENTER : block.align === "right" ? AlignmentType.RIGHT : block.align === "left" ? AlignmentType.LEFT : AlignmentType.JUSTIFIED;
      clean(block.text).split(/\n+/).filter(Boolean).forEach((text) => children.push(new Paragraph({ alignment: align, spacing: { before: 0, after: 120, line: 360, lineRule: LineRuleType.AUTO }, children: [run(text, { size: 24, bold: block.bold, italics: block.italic, underline: block.underline })] })));
    } else if (block.type === "bullets") {
      (block.items || []).filter((item) => inlineClean(item)).forEach((item) => children.push(new Paragraph({ numbering: { reference: "document-bullets", level: 0 }, alignment: AlignmentType.JUSTIFIED, spacing: { after: 80, line: 360, lineRule: LineRuleType.AUTO }, children: [run(item, { size: 24 })] })));
    } else if (block.type === "table") {
      if (block.caption) children.push(paragraph(block.caption, { align: AlignmentType.LEFT, size: 22, bold: true, before: 120, after: 80, line: 276, keepNext: true }));
      children.push(contentTable(block));
      children.push(emptyParagraph(120));
    } else if (block.type === "image" && block.imageDataUrl) {
      try {
        const [header, encoded] = block.imageDataUrl.split(",", 2);
        const bytes = fromBase64(encoded || "");
        const mime = header.includes("jpeg") || header.includes("jpg") ? "jpg" : "png";
        const dimensions = imageDimensions(bytes, mime);
        const scale = Math.min(520 / dimensions.width, 360 / dimensions.height, 1);
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 80 }, children: [new ImageRun({ type: mime, data: bytes, transformation: { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) }, altText: { name: block.caption || "Document image", title: block.caption || "Document image", description: block.caption || "Document image" } })] }));
        if (block.caption) children.push(paragraph(block.caption, { align: AlignmentType.CENTER, size: 18, italics: true, color: GRAY, after: 120, line: 240 }));
      } catch { /* Invalid image data is skipped. */ }
    } else if (block.type === "divider") {
      children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GRAY } }, spacing: { before: 120, after: 120 }, children: [run("", { size: 2 })] }));
    } else if (block.type === "spacer") {
      children.push(emptyParagraph(Math.max(60, Math.round((block.spacerHeight || 18) * 20))));
    } else if (block.type === "page-break") {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    } else if (block.type === "signature") {
      clean(block.text).split(/\n+/).filter(Boolean).forEach((role) => children.push(new Paragraph({ spacing: { before: 180, after: 300, line: 276 }, tabStops: [{ type: "right", position: 9000, leader: "underscore" }], children: [run(`${role}:`, { size: 20, bold: true }), new TextRun({ children: ["\t"], font: CORBEL, size: 20 })] })));
    }
  }
  return children.length ? children : [paragraph("No document content has been configured.")];
}

function documentFile(template: TemplateType, versions: TemplateType[]) {
  const controlledHeader = header(template);
  const pagination = estimateBodyPagination(template.contentSchema as DocumentBlock[]);
  return new Document({
    title: template.name,
    subject: `${template.documentMeta.documentType} | ${template.code}`,
    creator: "Common Criteria Pakistan Lab",
    lastModifiedBy: template.createdBy,
    description: template.description,
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 240 } } },
        heading1: { run: { font: CORBEL, size: 28, bold: true, boldComplexScript: true, color: BLACK }, paragraph: { spacing: { before: 240, after: 120, line: 276 }, keepNext: true, outlineLevel: 0 } },
        heading2: { run: { font: CORBEL, size: 28, bold: true, boldComplexScript: true, color: BLACK }, paragraph: { spacing: { before: 180, after: 90, line: 276 }, keepNext: true, outlineLevel: 1 } },
        heading3: { run: { font: CORBEL, size: 24, bold: true, boldComplexScript: true, color: BLACK }, paragraph: { spacing: { before: 160, after: 80, line: 276 }, keepNext: true, outlineLevel: 2 } },
        heading4: { run: { font: CORBEL, size: 24, italics: true, italicsComplexScript: true, color: "4472C4" }, paragraph: { keepNext: true, outlineLevel: 3 } },
      },
    },
    numbering: { config: [
      { reference: "document-headings", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1", suffix: LevelSuffix.SPACE, style: { run: { font: CORBEL, size: 28, bold: true }, paragraph: { indent: { left: 0, hanging: 0 } } } },
        { level: 1, format: LevelFormat.DECIMAL, text: "%1.%2", suffix: LevelSuffix.SPACE, style: { run: { font: CORBEL, size: 28, bold: true }, paragraph: { indent: { left: 0, hanging: 0 } } } },
        { level: 2, format: LevelFormat.DECIMAL, text: "%1.%2.%3", suffix: LevelSuffix.SPACE, style: { run: { font: CORBEL, size: 24, bold: true }, paragraph: { indent: { left: 0, hanging: 0 } } } },
      ] },
      { reference: "document-bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", suffix: LevelSuffix.SPACE, style: { run: { font: CORBEL, size: 24 }, paragraph: { indent: { left: 480, hanging: 240 } } } }] },
    ] },
    sections: [
      { properties: { titlePage: true, type: SectionType.NEXT_PAGE, page: sectionPage(NumberFormat.DECIMAL, 1, false) }, children: coverChildren(template) },
      { properties: { titlePage: false, type: SectionType.NEXT_PAGE, page: sectionPage(NumberFormat.LOWER_ROMAN, 1, true) }, headers: { default: controlledHeader }, footers: { default: footer(template, false) }, children: [
        paragraph("Document History", { align: AlignmentType.CENTER, size: 28, bold: true, after: 180, line: 276 }),
        historyTable(versions),
        new Paragraph({ children: [new PageBreak()] }),
        paragraph("Table of Contents", { align: AlignmentType.CENTER, size: 28, bold: true, after: 180, line: 276 }),
        ...staticToc(template, pagination.pageByHeading),
      ] },
      { properties: { titlePage: false, type: SectionType.NEXT_PAGE, page: sectionPage(NumberFormat.DECIMAL, 1, true) }, headers: { default: controlledHeader }, footers: { default: footer(template, true, pagination.total) }, children: bodyChildren(template) },
    ],
  });
}

export async function renderDOCX(template: TemplateType, versions: TemplateType[]) { return new Uint8Array(await Packer.toArrayBuffer(documentFile(template, versions))); }
export async function GET(request: Request) {
 try {
  const user=await requireUser(request);const id=new URL(request.url).searchParams.get("id") || "";
  await documentAccess(user,id);const row=await loadTemplate(id);const template=parseTemplate(row);
  const approval=await db().prepare("SELECT * FROM ac_approvals WHERE template_id=?").bind(id).first();
  let bytes;
  if(approval) bytes=await approvedFile(id,"docx");
  else {
   const history=await db().prepare("SELECT * FROM templates WHERE code=? AND version<=? ORDER BY version").bind(template.code,template.version).all<TemplateRow>();
   bytes=await renderDOCX(template,history.results.map(parseTemplate));
  }
  await event(user,"DOCX downloaded",id,{sha256:sha(bytes),approved:!!approval}).run();
  const filename=(template.code+"-v"+template.documentMeta.versionLabel+".docx").replace(/[^A-Za-z0-9._-]/g,"_");
  return new Response(bytes as BodyInit,{headers:{"content-type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","content-disposition":'attachment; filename="'+filename+'"',"cache-control":"no-store"}});
 } catch(e){return fail(e);}
}
