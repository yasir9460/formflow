import { requireUser, sameOrigin, fail, admin, author, auditReader, formAccess, canRead, event, uuid, type Flow } from "../../../lib/access";
import { saveDocument } from "../../../lib/document-save";
import {
  db,
  defaultDocumentMeta,
  ensureSchema,
  nextReference,
  parseSubmission,
  parseTemplate,
  seedIfEmpty,
  type FormField,
  type DocumentBlock,
  type DocumentMeta,
  type SubmissionRow,
  type TemplateRow,
  validateData,
} from "../../../lib/form-store";

export const dynamic = "force-dynamic";

const responseError = fail;
async function bootstrap(request: Request) { const u=await requireUser(request); await seedIfEmpty(u.name); }

export async function GET(request: Request) {
  try {
    await bootstrap(request);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") || "dashboard";
    const database = db();
    const actor = await requireUser(request);

    if (resource === "me") return Response.json({ user: actor });

    if (resource === "submission") {
      const id = url.searchParams.get("id");
      if (!id) return Response.json({ error: "Submission ID is required" }, { status: 400 });
      const row = await database.prepare("SELECT * FROM submissions WHERE id = ?").bind(id).first<SubmissionRow>();
      if (!row) return Response.json({ error: "Submission not found" }, { status: 404 });
      await formAccess(actor,id);
      const audit = await database.prepare("SELECT * FROM audit_logs WHERE submission_id = ? ORDER BY timestamp DESC").bind(id).all();
      return Response.json({ submission: parseSubmission(row), audit: audit.results });
    }

    const templateRows = await database.prepare("SELECT * FROM templates ORDER BY updated_at DESC").all<TemplateRow>();
    const submissionRows = await database.prepare("SELECT * FROM submissions ORDER BY created_at DESC").all<SubmissionRow>();
    const flows=await database.prepare("SELECT * FROM ac_workflows").all<Flow>();const byId=new Map(flows.results.map(f=>[f.template_id,f]));
    const templates = templateRows.results.map(parseTemplate).filter(t=>t.documentMeta.outputStyle!=="controlled-document" || (byId.has(t.id)?canRead(actor,byId.get(t.id)!):admin(actor))).map(t=>({...t,workflow:byId.get(t.id)}));
    const ownership=await database.prepare("SELECT entity_id FROM ac_ownership WHERE kind='submission' AND user_id=?").bind(actor.id).all<{entity_id:string}>();const owned=new Set(ownership.results.map(r=>r.entity_id));
    const submissions = submissionRows.results.filter(r=>auditReader(actor)||owned.has(r.id)).map(parseSubmission);
    return Response.json({ templates, submissions, user: actor });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    await bootstrap(request);
    const payload = await request.json() as Record<string, unknown>;
    const action = String(payload.action || "");
    const actor = await requireUser(request);
    const database = db();
    const now = new Date().toISOString();

    if ((action === "create-template" || action === "update-document") && ((payload.documentMeta as Partial<DocumentMeta>)?.outputStyle === "controlled-document")) return await saveDocument(actor,payload);
    if (action === "create-template") {
      if(!admin(actor)) return Response.json({error:"Only administrators can manage form templates"},{status:403});
      const name = String(payload.name || "").trim();
      const code = String(payload.code || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      const category = String(payload.category || "General").trim();
      const description = String(payload.description || "").trim();
      const fields = Array.isArray(payload.fields) ? payload.fields as FormField[] : [];
      const contentSchema = Array.isArray(payload.contentSchema) ? payload.contentSchema as DocumentBlock[] : [];
      const incomingMeta = (payload.documentMeta || {}) as Partial<DocumentMeta>;
      const documentMeta: DocumentMeta = {
        ...defaultDocumentMeta,
        ...incomingMeta,
        outputStyle: incomingMeta.outputStyle === "controlled-document" ? "controlled-document" : "operational-form",
        classification: String(incomingMeta.classification || defaultDocumentMeta.classification).toUpperCase(),
        documentType: String(incomingMeta.documentType || defaultDocumentMeta.documentType).toUpperCase(),
      };
      const numberingPattern = String(payload.numberingPattern || "CCPL-FRM-{CODE}-{YYYY}-{SEQ:4}");
      const baseTemplateId = payload.baseTemplateId ? String(payload.baseTemplateId) : null;
      const changeDescription = String(payload.changeDescription || "Initial issue").trim();
      const revisionDate = String(payload.revisionDate || "").trim();
      let sourceImportId = payload.sourceImportId ? String(payload.sourceImportId) : null;
      let sourceFileName = "";
      let sourceFileHash = "";
      const importSummary = payload.importSummary && typeof payload.importSummary === "object" ? payload.importSummary as Record<string, unknown> : {};
      const isDocument = documentMeta.outputStyle === "controlled-document";
      if (!name || !code || (!isDocument && fields.length === 0) || (isDocument && contentSchema.length === 0)) {
        return Response.json({ error: isDocument ? "Name, code, and at least one document content block are required" : "Name, code, and at least one field are required" }, { status: 400 });
      }
      if (baseTemplateId && isDocument && !changeDescription) {
        return Response.json({ error: "Change description is required for a new document version" }, { status: 400 });
      }

      let version = Number(payload.version || 1);
      if (baseTemplateId) {
        const previous = await database.prepare("SELECT code, version, document_meta FROM templates WHERE id = ?").bind(baseTemplateId).first<{ code: string; version: number; document_meta:string }>();
        if(previous && JSON.parse(previous.document_meta).outputStyle==="controlled-document") return Response.json({error:"Use the controlled document builder for document versions"},{status:400});
        if (previous) version = previous.version + 1;
      }
      if (sourceImportId && isDocument) {
        const source = await database.prepare("SELECT file_name, sha256 FROM document_imports WHERE id = ?").bind(sourceImportId).first<{ file_name: string; sha256: string }>();
        if (source) { sourceFileName = source.file_name; sourceFileHash = source.sha256; }
        else sourceImportId = null;
      }
      const id = crypto.randomUUID();
      const statements = [event(actor,"Form template created",id,{code,version}),database.prepare(`INSERT INTO templates
        (id, name, code, version, category, description, field_schema, document_meta, content_schema, change_description, revision_date, base_template_id, source_import_id, source_file_name, source_file_hash, import_summary, numbering_pattern, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?)`)
        .bind(id, name, code, version, category, description, JSON.stringify(fields), JSON.stringify(documentMeta), JSON.stringify(contentSchema), changeDescription || "Initial issue", revisionDate, baseTemplateId, sourceImportId, sourceFileName, sourceFileHash, JSON.stringify(importSummary), numberingPattern, actor.name, now, now)];
      if (sourceImportId) statements.push(database.prepare("UPDATE document_imports SET template_id = ? WHERE id = ?").bind(id, sourceImportId));
      await database.batch(statements);
      const row = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(id).first<TemplateRow>();
      return Response.json({ template: row ? parseTemplate(row) : null }, { status: 201 });
    }

    if (action === "create-submission") {
      if(!author(actor)) return Response.json({error:"This is a read-only account"},{status:403});
      const templateId = String(payload.templateId || "");
      const data = (payload.data || {}) as Record<string, unknown>;
      const status = payload.status === "Draft" ? "Draft" : "Submitted";
      const templateRow = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(templateId).first<TemplateRow>();
      if (!templateRow) return Response.json({ error: "Template not found" }, { status: 404 });
      const template = parseTemplate(templateRow);
      if(template.documentMeta.outputStyle==="controlled-document") return Response.json({error:"Use the document approval workflow"},{status:400});
      const errors = validateData(template.fields, data);
      if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 400 });
      const id = crypto.randomUUID();
      const uniqueNumber = await nextReference(template);
      const pdfPath = `/api/pdf?id=${id}`;
      await database.batch([
        database.prepare("INSERT INTO ac_ownership(id,kind,entity_id,user_id) VALUES(?,'submission',?,?)").bind(uuid(),id,actor.id),
        event(actor,"Form record created",id,{status}),
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
      await formAccess(actor,id,true);
      const current = parseSubmission(currentRow);
      const templateRow = await database.prepare("SELECT * FROM templates WHERE id = ?").bind(current.templateId).first<TemplateRow>();
      if (!templateRow) return Response.json({ error: "Template not found" }, { status: 404 });
      const template = parseTemplate(templateRow);
      const data = (payload.data || current.data) as Record<string, unknown>;
      const status = String(payload.status || current.status);
      if(!admin(actor) && (current.status==="Approved" || !["Draft","Submitted"].includes(status))) return Response.json({error:"Only an administrator may change approved form records"},{status:403});
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
        event(actor,"Form record updated",id,{status,changes}),
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
