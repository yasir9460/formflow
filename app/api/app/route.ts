import {
  db,
  ensureSchema,
  getActor,
  nextReference,
  parseSubmission,
  parseTemplate,
  seedIfEmpty,
  type FormField,
  type SubmissionRow,
  type TemplateRow,
  validateData,
} from "../../../lib/form-store";

export const dynamic = "force-dynamic";

function responseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}

async function bootstrap(request: Request) {
  await ensureSchema();
  await seedIfEmpty(getActor(request).name);
}

export async function GET(request: Request) {
  try {
    await bootstrap(request);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") || "dashboard";
    const database = db();
    const actor = getActor(request);

    if (resource === "me") return Response.json({ user: actor });

    if (resource === "submission") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "Submission ID is required" }, { status: 400 });
      const row = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
      if (!row) return Response.json({ error: "Submission not found" }, { status: 404 });
      const audit = await database.prepare("SELECT * FROM audit_logs WHERE submission_id = ? ORDER BY timestamp DESC").bind(id).all();
      return Response.json({ submission: parseSubmission(row), audit: audit.results });
    }

    const templateRows = await database.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all<TemplateRow>();
    const submissionRows = await database.prepare("SELECT * FROM submissions ORDER BY created_at DESC").all<SubmissionRow>();
    const templates = templateRows.results.map(parseTemplate);
    const submissions = submissionRows.results.map(parseSubmission);
    return Response.json({ templates, submissions, user: actor });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    await bootstrap(request);
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action || "");
    const actor = getActor(request);
    const database = db();
    const now = new Date().toISOString();

    if (action === "create-template") {
      const name = String(payload.name || "").trim();
      const code = String(payload.code || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      const category = String(payload.category || "General").trim();
      const description = String(payload.description || "").trim();
      const fields = Array.isArray(payload.fields) ? payload.fields as FormField[] : [];
      const numberingPattern = String(payload.numberingPattern || "CCPL-FRM-{CODE}-{YYYY}-{SEQ:4}");
      const baseTemplateId = payload.baseTemplateId ? String(payload.baseTemplateId) : null;
      if (!name || !code || fields.length === 0) return Response.json({ error: "Name, code, and at least one field are required" }, { status: 400 });

      let version = Number(payload.version || 1);
      if (baseTemplateId) {
        const previous = await database.prepare("SELECT code, version FROM templates WHERE id = ?").bind(baseTemplateId).first<{ code: string; version: number }>();
        if (previous) version = previous.version + 1;
      }
      const id = crypto.randomUUID();
      await database.prepare(`INSERT INTO templates
        (id, name, code, version, category, description, field_schema, numbering_pattern, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)`)
        .bind(id, name, code, version, category, description, JSON.stringify(fields), numberingPattern, actor.name, now, now).run();
      const row = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first<TemplateRow>();
      return Response.json({ template: row ? parseTemplate(row) : null }, { status: 201 });
    }

    if (action === "create-submission") {
      const templateId = String(payload.templateId || "");
      const data = (payload.data || {}) as Record<string, unknown>;
      const status = String(payload.status || "Submitted");
      const templateRow = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(templateId).first<TemplateRow>();
      if (!templateRow) return Response.json({ error: "Template not found" }, { status: 404 });
      const template = parseTemplate(templateRow);
      const errors = validateData(template.fields, data);
      if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 400 });
      const id = crypto.randomUUID();
      const uniqueNumber = await nextReference(template);
      const pdfPath = `/api/pdf?id=${id}`;
      await database.batch([
        database.prepare(`INSERT INTO submissions
          (id, template_id, unique_number, data, status, created_by, created_at, updated_at, revision, pdf_path)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
          .bind(id, templateId, uniqueNumber, JSON.stringify(data), status, actor.name, now, now, pdfPath),
        database.prepare(`INSERT INTO audit_logs
          (id, submission_id, changed_by, timestamp, summary, diff_json)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), id, actor.name, now, `Created as ${status}`, JSON.stringify([{ field: "status", after: status }])),
      ]);
      const row = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
      return Response.json({ submission: row ? parseSubmission(row) : null }, { status: 201 });
    }

    if (action === "update-submission") {
      const id = String(payload.id || "");
      const currentRow = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
      if (!currentRow) return Response.json({ error: "Submission not found" }, { status: 404 });
      const current = parseSubmission(currentRow);
      const templateRow = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(current.templateId).first<TemplateRow>();
      if (!templateRow) return Response.json({ error: "Template not found" }, { status: 404 });
      const template = parseTemplate(templateRow);
      const data = (payload.data || current.data) as Record<string, unknown>;
      const status = String(payload.status || current.status);
      const errors = validateData(template.fields, data);
      if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 400 });

      const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
      for (const field of template.fields) {
        if (JSON.stringify(current.data[field.id]) !== JSON.stringify(data[field.id])) {
          changes.push({ field: field.label, before: current.data[field.id] ?? "", after: data[field.id] ?? "" });
        }
      }
      if (status !== current.status) changes.push({ field: "Status", before: current.status, after: status });
      const revision = current.revision + 1;
      const summary = changes.length ? `Revision ${revision}: ${changes.map((change) => change.field).join(", ")} updated` : `Revision ${revision}: saved without field changes`;
      await database.batch([
        database.prepare("UPDATE submissions SET data = ?, status = ?, updated_at = ?, revision = ? WHERE id = ?")
          .bind(JSON.stringify(data), status, now, revision, id),
        database.prepare(`INSERT INTO audit_logs
          (id, submission_id, changed_by, timestamp, summary, diff_json)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), id, actor.name, now, summary, JSON.stringify(changes)),
      ]);
      const row = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
      return Response.json({ submission: row ? parseSubmission(row) : null });
    }

    return Response.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    return responseError(error);
  }
}
