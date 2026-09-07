import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db, ensureSchema, parseSubmission, parseTemplate, seedIfEmpty, type SubmissionRow, type TemplateRow } from "../../../lib/form-store";

export const dynamic = "force-dynamic";

function wrap(text: string, max: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max) {
      if (line) lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function GET(request: Request) {
  await ensureSchema();
  await seedIfEmpty();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Submission ID is required" }, { status: 400 });
  const database = db();
  const submissionRow = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
  if (!submissionRow) return Response.json({ error: "Submission not found" }, { status: 404 });
  const submission = parseSubmission(submissionRow);
  const templateRow = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(submission.templateId).first<TemplateRow>();
  if (!templateRow) return Response.json({ error: "Template not found" }, { status: 404 });
  const template = parseTemplate(templateRow);

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  let y = 760;
  const navy = rgb(0.07, 0.13, 0.23);
  const teal = rgb(0.05, 0.47, 0.49);
  const gray = rgb(0.38, 0.42, 0.47);

  const header = () => {
    page.drawRectangle({ x: 0, y: 792, width: 595.28, height: 49.89, color: navy });
    page.drawText("CCPL", { x: 40, y: 812, size: 14, font: bold, color: rgb(1, 1, 1) });
    page.drawText("CONTROLLED FORM", { x: 446, y: 812, size: 8, font: bold, color: rgb(0.66, 0.88, 0.86) });
    page.drawText(submission.uniqueNumber, { x: 40, y: 24, size: 8, font: bold, color: navy });
    page.drawText(`Version ${template.version}  •  Revision ${submission.revision}`, { x: 395, y: 24, size: 8, font: regular, color: gray });
    page.drawLine({ start: { x: 40, y: 38 }, end: { x: 555, y: 38 }, thickness: 0.6, color: rgb(0.84, 0.86, 0.88) });
  };
  header();
  page.drawText(template.name, { x: 40, y, size: 20, font: bold, color: navy });
  y -= 24;
  page.drawText(`${template.category}  •  ${template.code}  •  Status: ${submission.status}`, { x: 40, y, size: 9, font: regular, color: teal });
  y -= 30;

  let section = "";
  for (const field of template.fields) {
    const value = submission.data[field.id];
    const valueText = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value ?? "—");
    const valueLines = wrap(valueText, 78);
    const needed = (valueLines.length * 13) + (field.section !== section ? 34 : 22);
    if (y - needed < 58) {
      page = pdf.addPage(pageSize);
      header();
      y = 760;
      section = "";
    }
    if (field.section !== section) {
      section = field.section;
      page.drawRectangle({ x: 40, y: y - 5, width: 515, height: 21, color: rgb(0.91, 0.96, 0.96) });
      page.drawText(section.toUpperCase(), { x: 49, y: y + 2, size: 8, font: bold, color: teal });
      y -= 30;
    }
    page.drawText(field.label, { x: 46, y, size: 8, font: bold, color: gray });
    y -= 13;
    for (const line of valueLines) {
      page.drawText(line, { x: 46, y, size: 10, font: regular, color: navy });
      y -= 13;
    }
    page.drawLine({ start: { x: 46, y: y + 5 }, end: { x: 549, y: y + 5 }, thickness: 0.4, color: rgb(0.88, 0.89, 0.9) });
    y -= 9;
  }

  const bytes = await pdf.save();
  return new Response(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${submission.uniqueNumber}${submission.revision ? `-R${submission.revision}` : ""}.pdf"`,
    },
  });
}
