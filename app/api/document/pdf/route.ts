import { requireUser, documentAccess, loadTemplate, approvedFile, event, sha, fail } from "../../../../lib/access";
import { degrees, PDFDocument, PDFImage, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";
import { CCPL_LOGO_BASE64 } from "../../../../lib/ccpl-logo";
import { db, ensureSchema, parseTemplate, seedIfEmpty, type DocumentBlock, type TemplateRow } from "../../../../lib/form-store";

export const dynamic = "force-dynamic";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 72;
const CONTENT_W = PAGE_W - MARGIN * 2;
const GREEN = rgb(83 / 255, 129 / 255, 53 / 255);
const TEXT = rgb(31 / 255, 35 / 255, 40 / 255);
const MUTED = rgb(102 / 255, 102 / 255, 102 / 255);
const LINE = rgb(85 / 255, 85 / 255, 85 / 255);
const LIGHT = rgb(239 / 255, 239 / 255, 239 / 255);

type Template = ReturnType<typeof parseTemplate>;

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

function roman(input: number) {
  const table: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let value = input;
  let result = "";
  for (const [number, glyph] of table) while (value >= number) { result += glyph; value -= number; }
  return result;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = inlineClean(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else if (line) { lines.push(line); line = word; }
    else {
      let fragment = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(fragment + character, size) > width && fragment) { lines.push(fragment); fragment = character; }
        else fragment += character;
      }
      line = fragment;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawRight(page: PDFPage, value: string, right: number, y: number, size: number, font: PDFFont, color = TEXT) {
  const text = inlineClean(value);
  page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y, size, font, color });
}

function drawCenter(page: PDFPage, value: string, center: number, y: number, size: number, font: PDFFont, color = TEXT) {
  const text = inlineClean(value);
  page.drawText(text, { x: center - font.widthOfTextAtSize(text, size) / 2, y, size, font, color });
}

function drawBorder(page: PDFPage) {
  const outer = 17;
  const inner = 22;
  page.drawLine({ start: { x: outer, y: PAGE_H - outer }, end: { x: PAGE_W - outer, y: PAGE_H - outer }, thickness: 3, color: TEXT });
  page.drawLine({ start: { x: inner, y: PAGE_H - inner }, end: { x: PAGE_W - inner, y: PAGE_H - inner }, thickness: 0.7, color: TEXT });
  page.drawLine({ start: { x: outer, y: outer }, end: { x: PAGE_W - outer, y: outer }, thickness: 0.7, color: TEXT });
  page.drawLine({ start: { x: inner, y: inner }, end: { x: PAGE_W - inner, y: inner }, thickness: 3, color: TEXT });
  page.drawLine({ start: { x: outer, y: outer }, end: { x: outer, y: PAGE_H - outer }, thickness: 3, color: TEXT });
  page.drawLine({ start: { x: inner, y: inner }, end: { x: inner, y: PAGE_H - inner }, thickness: 0.7, color: TEXT });
  page.drawLine({ start: { x: PAGE_W - outer, y: outer }, end: { x: PAGE_W - outer, y: PAGE_H - outer }, thickness: 0.7, color: TEXT });
  page.drawLine({ start: { x: PAGE_W - inner, y: inner }, end: { x: PAGE_W - inner, y: PAGE_H - inner }, thickness: 3, color: TEXT });
}

function drawHeader(page: PDFPage, logo: PDFImage, bold: PDFFont, template: Template) {
  page.drawImage(logo, { x: MARGIN, y: 774, width: 28, height: 28 });
  drawCenter(page, template.documentMeta.classification, PAGE_W / 2, 784, 9, bold);
  const lines = wrap(`${template.code} | ${template.name}`, bold, 8.5, 190).slice(0, 2);
  lines.forEach((line, index) => drawRight(page, line, PAGE_W - MARGIN, 790 - index * 11, 8.5, bold));
  page.drawLine({ start: { x: MARGIN, y: 768 }, end: { x: PAGE_W - MARGIN, y: 768 }, thickness: 0.7, color: LINE });
}

function drawFooter(page: PDFPage, regular: PDFFont, bold: PDFFont, template: Template, pageText: string) {
  page.drawLine({ start: { x: MARGIN, y: 52 }, end: { x: PAGE_W - MARGIN, y: 52 }, thickness: 0.7, color: LINE });
  page.drawText(`Version ${inlineClean(template.documentMeta.versionLabel || String(template.version))}`, { x: MARGIN, y: 36, size: 8, font: regular, color: MUTED });
  drawCenter(page, template.documentMeta.classification, PAGE_W / 2, 36, 8, bold, TEXT);
  drawRight(page, pageText, PAGE_W - MARGIN, 36, 8, regular, MUTED);
}

function drawWatermark(page: PDFPage, bold: PDFFont, template: Template) {
  if (template.documentMeta.documentStatus === "APPROVED") return;
  page.drawText("DRAFT", { x: 145, y: 330, size: 78, font: bold, color: rgb(.55, .55, .55), opacity: .10, rotate: degrees(45) });
}

function drawCenteredMetadata(page: PDFPage, label: string, value: string, y: number, regular: PDFFont, bold: PDFFont) {
  const labelWidth = bold.widthOfTextAtSize(label, 10);
  const safeValue = inlineClean(value || "Not set");
  const valueWidth = regular.widthOfTextAtSize(safeValue, 10);
  const x = PAGE_W / 2 - (labelWidth + 3 + valueWidth) / 2;
  page.drawText(label, { x, y, size: 10, font: bold, color: MUTED });
  page.drawText(safeValue, { x: x + labelWidth + 3, y, size: 10, font: regular, color: TEXT });
}

function drawCover(page: PDFPage, logo: PDFImage, regular: PDFFont, bold: PDFFont, template: Template) {
  const meta = template.documentMeta;
  page.drawImage(logo, { x: PAGE_W / 2 - 63, y: 635, width: 126, height: 126 });
  drawCenter(page, "COMMON CRITERIA PAKISTAN LAB", PAGE_W / 2, 610, 11, bold, MUTED);
  drawCenter(page, meta.documentType, PAGE_W / 2, 579, 16, bold, GREEN);
  const lines = wrap(template.name, bold, 19, 430);
  let titleY = 543;
  lines.forEach((line) => { drawCenter(page, line, PAGE_W / 2, titleY, 19, bold); titleY -= 23; });
  const dividerY = Math.min(titleY - 10, 510);
  page.drawLine({ start: { x: MARGIN, y: dividerY }, end: { x: PAGE_W - MARGIN, y: dividerY }, thickness: .8, color: MUTED });
  drawCenter(page, template.code, PAGE_W / 2, dividerY - 27, 10.5, regular);
  drawCenter(page, `Version ${meta.versionLabel || template.version}`, PAGE_W / 2, dividerY - 48, 10.5, regular);
  drawCenteredMetadata(page, "Prepared by:", meta.preparedBy, dividerY - 70, regular, bold);
  drawCenteredMetadata(page, "Document Owner:", meta.documentOwner, dividerY - 92, regular, bold);
  drawCenteredMetadata(page, "Document Status:", meta.documentStatus, dividerY - 114, regular, bold);
  drawCenteredMetadata(page, "Effective Date:", meta.effectiveDate ? displayDate(meta.effectiveDate) : "Pending Director approval", dividerY - 136, regular, bold);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 46, color: GREEN });
  drawCenter(page, meta.classification, PAGE_W / 2, 17, 11, bold, rgb(1, 1, 1));
}

function drawPageTitle(page: PDFPage, value: string, bold: PDFFont) {
  drawCenter(page, value, PAGE_W / 2, 733, 14, bold);
}

function drawTableCell(page: PDFPage, value: string, x: number, yTop: number, width: number, height: number, font: PDFFont, size: number, bold = false, centered = false, fill?: ReturnType<typeof rgb>) {
  page.drawRectangle({ x, y: yTop - height, width, height, color: fill, borderColor: TEXT, borderWidth: .7 });
  const lines = wrap(value, font, size, width - 10).slice(0, Math.max(1, Math.floor((height - 10) / (size + 3))));
  const totalHeight = lines.length * (size + 3);
  lines.forEach((line, index) => {
    const textX = centered ? x + (width - font.widthOfTextAtSize(line, size)) / 2 : x + 5;
    page.drawText(line, { x: textX, y: yTop - (height - totalHeight) / 2 - size - index * (size + 3), size, font, color: TEXT });
  });
  void bold;
}

function drawHistory(page: PDFPage, regular: PDFFont, bold: PDFFont, versions: Template[]) {
  drawPageTitle(page, "Document History", bold);
  const widths = [49, 76, 106, 70, 76, 74];
  const headers = ["Version", "Revision Date", "Change Description", "Prepared By", "Reviewed By", "Approved By"];
  let y = 714;
  let x = MARGIN;
  headers.forEach((header, index) => { drawTableCell(page, header, x, y, widths[index], 49, bold, 9, true, true, LIGHT); x += widths[index]; });
  y -= 49;
  const historyRows = [...versions].sort((a, b) => a.version - b.version).slice(-8);
  const rows = historyRows.length ? historyRows : [];
  while (rows.length < 3) rows.push(null as unknown as Template);
  rows.forEach((version) => {
    x = MARGIN;
    const values = version ? [version.documentMeta.versionLabel || String(version.version), displayDate(version.revisionDate || version.updatedAt), version.changeDescription || "Initial issue", version.documentMeta.preparedBy || version.createdBy, version.documentMeta.reviewedBy || "Pending", version.documentMeta.approvedBy || "Pending"] : ["", "", "", "", "", ""];
    values.forEach((value, index) => { drawTableCell(page, value, x, y, widths[index], 50, regular, 8.5, false, true); x += widths[index]; });
    y -= 50;
  });
}

function drawToc(page: PDFPage, regular: PDFFont, bold: PDFFont, entries: Array<{ number: string; title: string; page: number }>) {
  drawPageTitle(page, "Table of Contents", bold);
  let y = 701;
  entries.slice(0, 23).forEach((entry) => {
    page.drawText(`${entry.number}.`, { x: MARGIN, y, size: 10.5, font: regular, color: TEXT });
    const titleLines = wrap(entry.title, regular, 10.5, 350).slice(0, 2);
    titleLines.forEach((line, lineIndex) => page.drawText(line, { x: MARGIN + 25, y: y - lineIndex * 14, size: 10.5, font: regular, color: TEXT }));
    drawRight(page, String(entry.page), PAGE_W - MARGIN, y, 10.5, regular);
    y -= Math.max(23, titleLines.length * 14 + 8);
  });
}

function drawJustifiedLine(page: PDFPage, line: string, x: number, y: number, width: number, size: number, font: PDFFont, color = TEXT, justify = true) {
  const words = line.split(/\s+/).filter(Boolean);
  if (!justify || words.length < 2) { page.drawText(line, { x, y, size, font, color }); return; }
  const wordsWidth = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
  const gap = (width - wordsWidth) / (words.length - 1);
  let cursor = x;
  words.forEach((word, index) => { page.drawText(word, { x: cursor, y, size, font, color }); cursor += font.widthOfTextAtSize(word, size) + (index < words.length - 1 ? gap : 0); });
}

async function drawBody(pdf: PDFDocument, regular: PDFFont, bold: PDFFont, italic: PDFFont, template: Template) {
  const pages: PDFPage[] = [];
  const entries: Array<{ number: string; title: string; page: number }> = [];
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = 724;
  let h1 = 0;
  let h2 = 0;
  let h3 = 0;
  const newPage = () => { page = pdf.addPage([PAGE_W, PAGE_H]); pages.push(page); y = 724; };
  const ensure = (height: number) => { if (y - height < 76) newPage(); };

  for (const block of template.contentSchema as DocumentBlock[]) {
    if (block.type === "page-break") { if (y < 720) newPage(); continue; }
    if (block.type === "spacer") { ensure(block.spacerHeight || 18); y -= block.spacerHeight || 18; continue; }
    if (block.type === "divider") { ensure(20); page.drawLine({ start: { x: MARGIN, y: y - 7 }, end: { x: PAGE_W - MARGIN, y: y - 7 }, thickness: .7, color: LINE }); y -= 20; continue; }

    if (block.type.startsWith("heading")) {
      if (block.type === "heading1") { h1 += 1; h2 = 0; h3 = 0; }
      if (block.type === "heading2") { h2 += 1; h3 = 0; }
      if (block.type === "heading3") h3 += 1;
      const number = block.type === "heading1" ? `${h1}` : block.type === "heading2" ? `${Math.max(h1, 1)}.${h2}` : `${Math.max(h1, 1)}.${Math.max(h2, 1)}.${h3}`;
      const size = block.type === "heading1" ? 14 : block.type === "heading2" ? 12 : 11;
      const lines = wrap(`${number}. ${block.text || "Untitled heading"}`, bold, size, CONTENT_W);
      ensure(lines.length * (size + 5) + (block.type === "heading1" ? 31 : 24));
      if (block.type === "heading1") entries.push({ number, title: inlineClean(block.text || "Untitled heading"), page: pages.length });
      y -= block.type === "heading1" ? 8 : 4;
      lines.forEach((line) => { page.drawText(line, { x: MARGIN, y, size, font: bold, color: TEXT }); y -= size + 5; });
      y -= block.type === "heading1" ? 9 : 5;
      continue;
    }

    if (block.type === "paragraph") {
      const paragraphs = clean(block.text).split(/\n+/).filter(Boolean);
      for (const paragraph of paragraphs.length ? paragraphs : [""]) {
        const font = block.bold ? bold : block.italic ? italic : regular;
        const lines = wrap(paragraph, font, 12, CONTENT_W);
        ensure(lines.length * 18 + 8);
        lines.forEach((line, index) => {
          const lineWidth = font.widthOfTextAtSize(line, 12);
          const x = block.align === "center" ? MARGIN + (CONTENT_W - lineWidth) / 2 : block.align === "right" ? PAGE_W - MARGIN - lineWidth : MARGIN;
          drawJustifiedLine(page, line, x, y, CONTENT_W, 12, font, TEXT, (!block.align || block.align === "justify") && index < lines.length - 1);
          if (block.underline) page.drawLine({ start: { x, y: y - 2 }, end: { x: x + (block.align === "justify" && index < lines.length - 1 ? CONTENT_W : lineWidth), y: y - 2 }, thickness: .5, color: TEXT });
          y -= 18;
        });
        y -= 6;
      }
      continue;
    }

    if (block.type === "bullets") {
      for (const item of (block.items || []).filter((value) => inlineClean(value))) {
        const lines = wrap(item, regular, 12, CONTENT_W - 22);
        ensure(lines.length * 18 + 5);
        page.drawCircle({ x: MARGIN + 5, y: y + 4, size: 2.3, color: TEXT });
        lines.forEach((line) => { page.drawText(line, { x: MARGIN + 18, y, size: 12, font: regular, color: TEXT }); y -= 18; });
        y -= 3;
      }
      y -= 4;
      continue;
    }

    if (block.type === "table") {
      const cells = block.cells || [];
      if (block.caption) { ensure(25); page.drawText(inlineClean(block.caption), { x: MARGIN, y, size: 10.5, font: bold, color: TEXT }); y -= 18; }
      const columns = Math.max(1, cells[0]?.length || 1);
      const columnWidth = CONTENT_W / columns;
      for (let rowIndex = 0; rowIndex < cells.length; rowIndex += 1) {
        const row = cells[rowIndex];
        const rowFont = block.headerRow !== false && rowIndex === 0 ? bold : regular;
        const maxLines = Math.max(...row.map((cell) => wrap(cell, rowFont, 9, columnWidth - 10).length), 1);
        const height = Math.max(31, maxLines * 12 + 12);
        if (y - height < 76) {
          newPage();
          if (block.headerRow !== false && rowIndex > 0 && cells[0]) {
            let headerX = MARGIN;
            cells[0].forEach((cell) => { drawTableCell(page, cell, headerX, y, columnWidth, 31, bold, 9, true, false, LIGHT); headerX += columnWidth; });
            y -= 31;
          }
        }
        let x = MARGIN;
        row.forEach((cell) => { drawTableCell(page, cell, x, y, columnWidth, height, rowFont, 9, rowIndex === 0, false, block.headerRow !== false && rowIndex === 0 ? LIGHT : undefined); x += columnWidth; });
        y -= height;
      }
      y -= 14;
      continue;
    }

    if (block.type === "image" && block.imageDataUrl) {
      try {
        const [header, encoded] = block.imageDataUrl.split(",", 2);
        const bytes = fromBase64(encoded || "");
        const image = header.includes("jpeg") || header.includes("jpg") ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
        const maxHeight = 300;
        const scale = Math.min(CONTENT_W / image.width, maxHeight / image.height, 1);
        const width = image.width * scale;
        const height = image.height * scale;
        ensure(height + (block.caption ? 30 : 14));
        page.drawImage(image, { x: MARGIN + (CONTENT_W - width) / 2, y: y - height, width, height });
        y -= height + 8;
        if (block.caption) { drawCenter(page, block.caption, PAGE_W / 2, y, 9, italic, MUTED); y -= 20; }
      } catch { /* Invalid image data is ignored instead of breaking the document. */ }
      continue;
    }

    if (block.type === "signature") {
      const roles = clean(block.text).split(/\n+/).filter(Boolean);
      const height = roles.length * 42 + 12;
      ensure(height);
      roles.forEach((role) => { page.drawText(inlineClean(role), { x: MARGIN, y, size: 10, font: bold, color: MUTED }); page.drawLine({ start: { x: MARGIN + 120, y: y - 3 }, end: { x: PAGE_W - MARGIN, y: y - 3 }, thickness: .6, color: LINE }); y -= 42; });
      y -= 6;
    }
  }

  if (!template.contentSchema.length) page.drawText("No document content has been configured.", { x: MARGIN, y, size: 12, font: regular, color: MUTED });
  return { pages, entries };
}

export async function renderPDF(template: Template, versions: Template[]) {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
    const logo = await pdf.embedPng(fromBase64(CCPL_LOGO_BASE64));

    const cover = pdf.addPage([PAGE_W, PAGE_H]);
    drawCover(cover, logo, regular, bold, template);
    const history = pdf.addPage([PAGE_W, PAGE_H]);
    const toc = pdf.addPage([PAGE_W, PAGE_H]);
    const body = await drawBody(pdf, regular, bold, italic, template);
    drawHistory(history, regular, bold, versions);
    drawToc(toc, regular, bold, body.entries);

    [history, toc].forEach((page, index) => { drawWatermark(page, bold, template); drawBorder(page); drawHeader(page, logo, bold, template); drawFooter(page, regular, bold, template, roman(index + 1)); });
    body.pages.forEach((page, index) => { drawWatermark(page, bold, template); drawBorder(page); drawHeader(page, logo, bold, template); drawFooter(page, regular, bold, template, `Page ${index + 1} of ${body.pages.length}`); });

    pdf.setTitle(inlineClean(template.name));
    pdf.setSubject(`${template.documentMeta.documentType} | ${template.code}`);
    pdf.setAuthor("Common Criteria Pakistan Lab");
    pdf.setCreator("CCPL FormFlow");
    pdf.setProducer("CCPL FormFlow");
    pdf.setCreationDate(new Date(template.createdAt));
    pdf.setModificationDate(new Date(template.updatedAt));
    const bytes = await pdf.save();
    return bytes;
}
export async function GET(request: Request) {
 try {
  const user=await requireUser(request);const id=new URL(request.url).searchParams.get("id") || "";
  await documentAccess(user,id);const row=await loadTemplate(id);const template=parseTemplate(row);
  const approval=await db().prepare("SELECT * FROM ac_approvals WHERE template_id=?").bind(id).first();
  let bytes;
  if(approval) bytes=await approvedFile(id,"pdf");
  else {
   const history=await db().prepare("SELECT * FROM templates WHERE code=? AND version<=? ORDER BY version").bind(template.code,template.version).all<TemplateRow>();
   bytes=await renderPDF(template,history.results.map(parseTemplate));
  }
  await event(user,"PDF downloaded",id,{sha256:sha(bytes),approved:!!approval}).run();
  const filename=(template.code+"-v"+template.documentMeta.versionLabel+".pdf").replace(/[^A-Za-z0-9._-]/g,"_");
  return new Response(bytes as BodyInit,{headers:{"content-type":"application/pdf","content-disposition":'attachment; filename="'+filename+'"',"cache-control":"no-store"}});
 } catch(e){return fail(e);}
}
