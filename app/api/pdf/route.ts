import { PDFDocument, PDFPage, PDFFont, PDFImage, StandardFonts, rgb } from "pdf-lib";
import { CCPL_LOGO_BASE64 } from "../../../lib/ccpl-logo";
import {
  db,
  ensureSchema,
  parseSubmission,
  parseTemplate,
  seedIfEmpty,
  type FormField,
  type SubmissionRow,
  type TemplateRow,
} from "../../../lib/form-store";

export const dynamic = "force-dynamic";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 72;
const GREEN = rgb(83 / 255, 129 / 255, 53 / 255);
const DARK_GREEN = rgb(30 / 255, 94 / 255, 53 / 255);
const TEXT = rgb(31 / 255, 41 / 255, 55 / 255);
const MUTED = rgb(91 / 255, 99 / 255, 112 / 255);
const LINE = rgb(185 / 255, 190 / 255, 196 / 255);

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function roman(input: number) {
  const table: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let value = input;
  let output = "";
  for (const [number, glyph] of table) {
    while (value >= number) {
      output += glyph;
      value -= number;
    }
  }
  return output;
}

function displayDate(value: string) {
  if (!value) return "Not set";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? clean(value) : parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const paragraphs = clean(text).split(/\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else if (line) {
        lines.push(line);
        line = word;
      } else {
        let fragment = "";
        for (const character of word) {
          const next = fragment + character;
          if (font.widthOfTextAtSize(next, size) > width && fragment) {
            lines.push(fragment);
            fragment = character;
          } else fragment = next;
        }
        line = fragment;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawRight(page: PDFPage, text: string, right: number, y: number, size: number, font: PDFFont, color = TEXT) {
  const safe = clean(text);
  page.drawText(safe, { x: right - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

function drawCenter(page: PDFPage, text: string, center: number, y: number, size: number, font: PDFFont, color = TEXT) {
  const safe = clean(text);
  page.drawText(safe, { x: center - font.widthOfTextAtSize(safe, size) / 2, y, size, font, color });
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

function drawHeader(page: PDFPage, logo: PDFImage, bold: PDFFont, template: ReturnType<typeof parseTemplate>) {
  page.drawImage(logo, { x: MARGIN, y: 771, width: 34, height: 34 });
  drawCenter(page, template.documentMeta.classification, PAGE_W / 2, 784, 9, bold, TEXT);
  const headingLines = wrap(`${template.code} | ${template.name}`, bold, 8.5, 188).slice(0, 2);
  headingLines.forEach((line, index) => drawRight(page, line, PAGE_W - MARGIN, 789 - index * 11, 8.5, bold, TEXT));
  page.drawLine({ start: { x: MARGIN, y: 765 }, end: { x: PAGE_W - MARGIN, y: 765 }, thickness: 0.8, color: MUTED });
}

function drawFooter(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  version: string,
  classification: string,
  pageText: string,
) {
  const y = 35;
  page.drawLine({ start: { x: MARGIN, y: 53 }, end: { x: PAGE_W - MARGIN, y: 53 }, thickness: 0.8, color: GREEN });
  page.drawText(`Version ${clean(version)}`, { x: MARGIN, y, size: 8, font: regular, color: MUTED });
  drawCenter(page, classification, PAGE_W / 2, y, 8, bold, DARK_GREEN);
  drawRight(page, pageText, PAGE_W - MARGIN, y, 8, regular, MUTED);
}

function drawCenteredMetadata(page: PDFPage, label: string, value: string, y: number, regular: PDFFont, bold: PDFFont) {
  const safeLabel = clean(label);
  const safeValue = clean(value || "Not set");
  const size = 10;
  const labelWidth = bold.widthOfTextAtSize(safeLabel, size);
  const valueWidth = regular.widthOfTextAtSize(safeValue, size);
  const gap = 3;
  const x = PAGE_W / 2 - (labelWidth + gap + valueWidth) / 2;
  page.drawText(safeLabel, { x, y, size, font: bold, color: MUTED });
  page.drawText(safeValue, { x: x + labelWidth + gap, y, size, font: regular, color: TEXT });
}

function drawCover(
  page: PDFPage,
  logo: PDFImage,
  regular: PDFFont,
  bold: PDFFont,
  template: ReturnType<typeof parseTemplate>,
) {
  const meta = template.documentMeta;
  page.drawImage(logo, { x: PAGE_W / 2 - 63, y: 635, width: 126, height: 126 });
  drawCenter(page, "COMMON CRITERIA PAKISTAN LAB", PAGE_W / 2, 610, 11, bold, MUTED);
  drawCenter(page, clean(meta.documentType), PAGE_W / 2, 579, 16, bold, GREEN);
  const titleLines = wrap(template.name, bold, 19, 430);
  let titleY = 543;
  for (const line of titleLines) {
    drawCenter(page, line, PAGE_W / 2, titleY, 19, bold);
    titleY -= 23;
  }
  const dividerY = Math.min(titleY - 10, 510);
  page.drawLine({ start: { x: MARGIN, y: dividerY }, end: { x: PAGE_W - MARGIN, y: dividerY }, thickness: 0.8, color: MUTED });
  drawCenter(page, template.code, PAGE_W / 2, dividerY - 27, 10.5, regular, TEXT);
  drawCenter(page, `Version ${clean(meta.versionLabel || String(template.version))}`, PAGE_W / 2, dividerY - 48, 10.5, regular, TEXT);
  drawCenteredMetadata(page, "Prepared by:", meta.preparedBy, dividerY - 70, regular, bold);
  drawCenteredMetadata(page, "Document Owner:", meta.documentOwner, dividerY - 92, regular, bold);
  drawCenteredMetadata(page, "Document Status:", meta.documentStatus, dividerY - 114, regular, bold);
  drawCenteredMetadata(page, "Effective Date:", meta.effectiveDate ? displayDate(meta.effectiveDate) : "Pending Director approval", dividerY - 136, regular, bold);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 46, color: GREEN });
  drawCenter(page, meta.classification, PAGE_W / 2, 17, 11, bold, rgb(1, 1, 1));
}

function drawFrontTitle(page: PDFPage, title: string, regular: PDFFont, bold: PDFFont) {
  page.drawText(title, { x: MARGIN, y: 713, size: 14, font: bold, color: TEXT });
  page.drawLine({ start: { x: MARGIN, y: 703 }, end: { x: PAGE_W - MARGIN, y: 703 }, thickness: 2, color: GREEN });
  page.drawText("This page forms part of the controlled document record.", { x: MARGIN, y: 681, size: 9, font: regular, color: MUTED });
}

function drawHistory(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  template: ReturnType<typeof parseTemplate>,
  submission: ReturnType<typeof parseSubmission>,
) {
  drawFrontTitle(page, "Document History", regular, bold);
  const rows = [
    ["Version", "Date", "Author", "Change summary"],
    [template.documentMeta.versionLabel || String(template.version), displayDate(submission.updatedAt), template.documentMeta.preparedBy || submission.createdBy, submission.revision ? `Updated record, revision ${submission.revision}` : "Initial controlled output"],
  ];
  const widths = [65, 88, 115, 183];
  let y = 630;
  rows.forEach((row, rowIndex) => {
    let x = MARGIN;
    const height = rowIndex === 0 ? 28 : 46;
    row.forEach((cell, index) => {
      page.drawRectangle({ x, y: y - height, width: widths[index], height, color: rowIndex === 0 ? GREEN : undefined, borderColor: TEXT, borderWidth: 0.7 });
      const font = rowIndex === 0 ? bold : regular;
      const color = rowIndex === 0 ? rgb(1, 1, 1) : TEXT;
      const lines = wrap(cell, font, 8.5, widths[index] - 12).slice(0, 3);
      lines.forEach((line, lineIndex) => page.drawText(line, { x: x + 6, y: y - 17 - lineIndex * 11, size: 8.5, font, color }));
      x += widths[index];
    });
    y -= height;
  });
  page.drawText("Approval details", { x: MARGIN, y: 520, size: 11, font: bold, color: DARK_GREEN });
  const approvals = [
    ["Prepared by", template.documentMeta.preparedBy || "Not set"],
    ["Reviewed by", template.documentMeta.reviewedBy || "Not set"],
    ["Approved by", template.documentMeta.approvedBy || "Not set"],
    ["Document status", template.documentMeta.documentStatus || "Not set"],
  ];
  y = 486;
  approvals.forEach(([label, value]) => {
    page.drawText(label, { x: MARGIN, y, size: 9, font: bold, color: MUTED });
    page.drawText(clean(value), { x: 188, y, size: 9, font: regular, color: TEXT });
    page.drawLine({ start: { x: 188, y: y - 4 }, end: { x: PAGE_W - MARGIN, y: y - 4 }, thickness: 0.5, color: LINE });
    y -= 34;
  });
}

function drawToc(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  entries: Array<{ title: string; page: number }>,
) {
  drawFrontTitle(page, "Table of Contents", regular, bold);
  let y = 646;
  entries.forEach((entry, index) => {
    const number = String(index + 1);
    page.drawText(number, { x: MARGIN, y, size: 10, font: bold, color: DARK_GREEN });
    page.drawText(clean(entry.title), { x: 98, y, size: 10, font: regular, color: TEXT });
    const pageNumber = String(entry.page);
    drawRight(page, pageNumber, PAGE_W - MARGIN, y, 10, regular);
    page.drawLine({ start: { x: 98, y: y - 5 }, end: { x: PAGE_W - MARGIN - 22, y: y - 5 }, thickness: 0.4, color: LINE, dashArray: [1.5, 2.5] });
    y -= 29;
  });
}

function formatFieldValue(field: FormField, raw: string | boolean | undefined) {
  if (field.type === "checkbox") return raw === true ? "Yes" : "No";
  if (field.type === "date" && typeof raw === "string") return displayDate(raw);
  return clean(raw) || "Not provided";
}

function drawBody(
  pdf: PDFDocument,
  regular: PDFFont,
  bold: PDFFont,
  italic: PDFFont,
  template: ReturnType<typeof parseTemplate>,
  submission: ReturnType<typeof parseSubmission>,
) {
  const pages: PDFPage[] = [];
  const entries: Array<{ title: string; page: number }> = [];
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  pages.push(page);
  let y = 720;
  let currentSection = "";
  let sectionNumber = 0;

  const nextPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pages.push(page);
    y = 720;
  };

  for (const field of template.fields) {
    const isNewSection = field.section !== currentSection;
    const value = formatFieldValue(field, submission.data[field.id]);
    const valueFont = field.type === "signature" ? italic : regular;
    const valueLines = wrap(value, valueFont, 10.5, PAGE_W - MARGIN * 2 - 14);
    const needed = (isNewSection ? 31 : 0) + 20 + Math.max(1, valueLines.length) * 15 + 11;
    if (y - needed < 78) {
      nextPage();
    }
    if (field.section !== currentSection) {
      currentSection = field.section;
      sectionNumber += 1;
      entries.push({ title: currentSection || "Form details", page: pages.length });
      page.drawText(String(sectionNumber), { x: MARGIN, y, size: 14, font: bold, color: GREEN });
      page.drawText(clean(currentSection || "Form details"), { x: MARGIN + 22, y, size: 14, font: bold, color: TEXT });
      page.drawLine({ start: { x: MARGIN, y: y - 7 }, end: { x: PAGE_W - MARGIN, y: y - 7 }, thickness: 0.55, color: LINE });
      y -= 25;
    }
    page.drawText(clean(field.label) + (field.required ? " *" : ""), { x: MARGIN + 7, y, size: 9, font: bold, color: MUTED });
    y -= 17;
    if (field.type === "checkbox") {
      page.drawRectangle({ x: MARGIN + 7, y: y - 1, width: 11, height: 11, borderColor: TEXT, borderWidth: 0.8 });
      if (submission.data[field.id] === true) {
        page.drawLine({ start: { x: MARGIN + 9, y: y + 4 }, end: { x: MARGIN + 13, y }, thickness: 1.3, color: GREEN });
        page.drawLine({ start: { x: MARGIN + 13, y }, end: { x: MARGIN + 17, y: y + 8 }, thickness: 1.3, color: GREEN });
      }
      page.drawText(value, { x: MARGIN + 25, y, size: 10.5, font: regular, color: TEXT });
      y -= 17;
    } else {
      for (const line of valueLines) {
        page.drawText(line, { x: MARGIN + 7, y, size: 10.5, font: valueFont, color: TEXT });
        y -= 15;
      }
      page.drawLine({ start: { x: MARGIN + 7, y: y + 6 }, end: { x: PAGE_W - MARGIN - 7, y: y + 6 }, thickness: 0.55, color: LINE });
      y -= 10;
    }
  }

  if (!template.fields.length) {
    page.drawText("No fields are configured for this template.", { x: MARGIN, y, size: 11, font: regular, color: MUTED });
  }
  return { pages, entries };
}

export async function GET(request: Request) {
  try { return await formPDF(request); } catch(e) { return fail(e); }
}
async function formPDF(request: Request) {
  const actor=await requireUser(request);
  await ensureSchema();
  await seedIfEmpty();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Submission ID is required" }, { status: 400 });
  const database = db();
  const submissionRow = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
  await formAccess(actor,id);
  await event(actor,"Form PDF downloaded",id).run();
  if (!submissionRow) return Response.json({ error: "Submission not found" }, { status: 404 });
  const submission = parseSubmission(submissionRow);
  const templateRow = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(submission.templateId).first<TemplateRow>();
  if (!templateRow) return Response.json({ error: "Template not found" }, { status: 404 });
  const template = parseTemplate(templateRow);

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = await pdf.embedPng(fromBase64(CCPL_LOGO_BASE64));
  const controlled = template.documentMeta.outputStyle === "controlled-document";

  const cover = pdf.addPage([PAGE_W, PAGE_H]);
  drawCover(cover, logo, regular, bold, template);
  let historyPage: PDFPage | null = null;
  let tocPage: PDFPage | null = null;
  if (controlled) {
    historyPage = pdf.addPage([PAGE_W, PAGE_H]);
    tocPage = pdf.addPage([PAGE_W, PAGE_H]);
  }

  const body = drawBody(pdf, regular, bold, italic, template, submission);
  if (historyPage && tocPage) {
    drawHistory(historyPage, regular, bold, template, submission);
    drawToc(tocPage, regular, bold, body.entries);
    [historyPage, tocPage].forEach((page, index) => {
      drawBorder(page);
      drawHeader(page, logo, bold, template);
      drawFooter(page, regular, bold, template.documentMeta.versionLabel || String(template.version), template.documentMeta.classification, roman(index + 1));
    });
  }

  body.pages.forEach((page, index) => {
    drawBorder(page);
    drawHeader(page, logo, bold, template);
    drawFooter(
      page,
      regular,
      bold,
      template.documentMeta.versionLabel || String(template.version),
      template.documentMeta.classification,
      `Page ${index + 1} of ${body.pages.length}`,
    );
  });

  pdf.setTitle(clean(template.name));
  pdf.setSubject(clean(`${template.documentMeta.documentType} | ${submission.uniqueNumber}`));
  pdf.setAuthor("Common Criteria Pakistan Lab");
  pdf.setCreator("CCPL FormFlow");
  pdf.setProducer("CCPL FormFlow");
  pdf.setCreationDate(new Date(submission.createdAt));
  pdf.setModificationDate(new Date(submission.updatedAt));

  const bytes = await pdf.save();
  const filename = `${submission.uniqueNumber}${submission.revision ? `-R${submission.revision}` : ""}.pdf`;
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${clean(filename)}"`,
      "cache-control": "no-store",
    },
  });
}
import { requireUser, formAccess, event, fail } from "../../../lib/access";
