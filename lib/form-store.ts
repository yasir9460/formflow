import { env } from "cloudflare:workers";

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "dropdown"
  | "checkbox"
  | "radio"
  | "textarea"
  | "signature"
  | "file";

export type FormField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  section: string;
  placeholder?: string;
  defaultValue?: string | boolean;
  options?: string[];
  keySummary?: boolean;
  validation?: {
    regex?: string;
    min?: number;
    max?: number;
    minDate?: string;
    maxDate?: string;
  };
};

type TemplateRow = {
  id: string;
  name: string;
  code: string;
  version: number;
  category: string;
  description: string;
  field_schema: string;
  numbering_pattern: string;
  layout_file_path: string | null;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type SubmissionRow = {
  id: string;
  template_id: string;
  unique_number: string;
  data: string;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  revision: number;
  pdf_path: string;
};

const templatesSql = `CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  field_schema TEXT NOT NULL,
  numbering_pattern TEXT NOT NULL,
  layout_file_path TEXT,
  status TEXT NOT NULL DEFAULT 'Active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(code, version)
)`;

const submissionsSql = `CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  unique_number TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  pdf_path TEXT NOT NULL
)`;

const auditSql = `CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT NOT NULL
)`;

const sequenceSql = `CREATE TABLE IF NOT EXISTS sequences (
  sequence_key TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
)`;

export function db() {
  if (!env.DB) throw new Error("Database binding is unavailable");
  return env.DB;
}

export async function ensureSchema() {
  const database = db();
  await database.batch([
    database.prepare(templatesSql),
    database.prepare(submissionsSql),
    database.prepare(auditSql),
    database.prepare(sequenceSql),
    database.prepare("CREATE INDEX IF NOT EXISTS submissions_template_idx ON submissions(template_id)"),
    database.prepare("CREATE INDEX IF NOT EXISTS audit_submission_idx ON audit_logs(submission_id)"),
  ]);
}

const calibrationFields: FormField[] = [
  { id: "equipment_name", label: "Equipment name", type: "text", required: true, section: "Equipment details", placeholder: "e.g. Rigol MSO8204", keySummary: true },
  { id: "asset_id", label: "Asset / inventory ID", type: "text", required: true, section: "Equipment details", placeholder: "CCPL-LAB-000" , keySummary: true },
  { id: "manufacturer", label: "Manufacturer", type: "text", required: false, section: "Equipment details" },
  { id: "requested_date", label: "Requested calibration date", type: "date", required: true, section: "Calibration request" },
  { id: "calibration_type", label: "Calibration type", type: "dropdown", required: true, section: "Calibration request", options: ["Scheduled", "Post-repair", "Out-of-tolerance", "New equipment"], keySummary: true },
  { id: "priority", label: "Priority", type: "radio", required: true, section: "Calibration request", options: ["Routine", "Urgent"], defaultValue: "Routine" },
  { id: "notes", label: "Special instructions", type: "textarea", required: false, section: "Calibration request", placeholder: "Range, points, or uncertainty requirements" },
  { id: "requester_signature", label: "Requester signature", type: "signature", required: true, section: "Authorization", placeholder: "Type full name" },
];

const nonconformityFields: FormField[] = [
  { id: "title", label: "Nonconformity title", type: "text", required: true, section: "Finding", keySummary: true },
  { id: "source", label: "Source", type: "dropdown", required: true, section: "Finding", options: ["Internal audit", "External audit", "Client complaint", "Operational review"], keySummary: true },
  { id: "date_identified", label: "Date identified", type: "date", required: true, section: "Finding" },
  { id: "clause", label: "Standard / clause", type: "text", required: true, section: "Finding", placeholder: "e.g. ISO/IEC 17021-1, 9.5.1" },
  { id: "description", label: "Description and objective evidence", type: "textarea", required: true, section: "Finding", validation: { min: 20 } },
  { id: "severity", label: "Classification", type: "radio", required: true, section: "Assessment", options: ["Observation", "Minor", "Major"], keySummary: true },
  { id: "owner", label: "Action owner", type: "text", required: true, section: "Corrective action", keySummary: true },
  { id: "target_date", label: "Target completion date", type: "date", required: true, section: "Corrective action" },
  { id: "correction", label: "Immediate correction", type: "textarea", required: false, section: "Corrective action" },
];

const impartialityFields: FormField[] = [
  { id: "declarant", label: "Name of declarant", type: "text", required: true, section: "Declaration", keySummary: true },
  { id: "role", label: "Role / assignment", type: "text", required: true, section: "Declaration", keySummary: true },
  { id: "client", label: "Client / organization", type: "text", required: true, section: "Assignment", keySummary: true },
  { id: "assignment", label: "Audit or certification activity", type: "text", required: true, section: "Assignment" },
  { id: "financial_interest", label: "I have a financial or commercial interest", type: "checkbox", required: false, section: "Conflict check" },
  { id: "prior_consultancy", label: "I provided consultancy within the last two years", type: "checkbox", required: false, section: "Conflict check" },
  { id: "relationship", label: "I have a personal or professional relationship", type: "checkbox", required: false, section: "Conflict check" },
  { id: "details", label: "Conflict details or safeguards", type: "textarea", required: false, section: "Conflict check" },
  { id: "signature", label: "Electronic signature", type: "signature", required: true, section: "Confirmation", placeholder: "Type full legal name" },
];

export async function seedIfEmpty(actor = "System") {
  const database = db();
  const count = await database.prepare("SELECT COUNT(*) AS total FROM templates").first<{ total: number }>();
  if (Number(count?.total ?? 0) > 0) return;

  const now = new Date().toISOString();
  const rows = [
    { id: "tpl-calibration-v1", name: "Equipment Calibration Request", code: "ECR", category: "Laboratory", description: "Request and authorize calibration of laboratory equipment.", fields: calibrationFields },
    { id: "tpl-ncr-v1", name: "Nonconformity & Corrective Action", code: "NCR", category: "Quality", description: "Record a finding, assign ownership, and track corrective action.", fields: nonconformityFields },
    { id: "tpl-impartiality-v1", name: "Impartiality & Conflict Declaration", code: "ICD", category: "Certification", description: "Document conflicts and safeguards before certification activities.", fields: impartialityFields },
  ];

  await database.batch(
    rows.map((row) => database.prepare(`INSERT INTO templates
      (id, name, code, version, category, description, field_schema, numbering_pattern, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'Active', ?, ?, ?)`)
      .bind(row.id, row.name, row.code, row.category, row.description, JSON.stringify(row.fields), "CCPL-FRM-{CODE}-{YYYY}-{SEQ:4}", actor, now, now)),
  );
}

export function parseTemplate(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    version: row.version,
    category: row.category,
    description: row.description,
    fields: JSON.parse(row.field_schema) as FormField[],
    numberingPattern: row.numbering_pattern,
    layoutFilePath: row.layout_file_path,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseSubmission(row: SubmissionRow) {
  return {
    id: row.id,
    templateId: row.template_id,
    uniqueNumber: row.unique_number,
    data: JSON.parse(row.data) as Record<string, string | boolean>,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
    pdfPath: row.pdf_path,
  };
}

export function getActor(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  const encoding = request.headers.get("oai-authenticated-user-full-name-encoding");
  let name: string | null = null;
  if (encoded && encoding === "percent-encoded-utf-8") {
    try { name = decodeURIComponent(encoded); } catch { name = null; }
  }
  return { name: name || email || "Yasir Khan", email: email || "Local prototype user" };
}

export function validateData(fields: FormField[], data: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = data[field.id];
    const empty = value === undefined || value === null || value === "" || (field.type === "checkbox" && value !== true);
    if (field.required && empty) {
      errors[field.id] = `${field.label} is required`;
      continue;
    }
    if (empty) continue;
    const text = String(value);
    const rules = field.validation || {};
    if (rules.regex) {
      try { if (!new RegExp(rules.regex).test(text)) errors[field.id] = "Value does not match the required format"; }
      catch { errors[field.id] = "Template contains an invalid validation expression"; }
    }
    if (field.type === "number") {
      const number = Number(value);
      if (rules.min !== undefined && number < rules.min) errors[field.id] = `Minimum value is ${rules.min}`;
      if (rules.max !== undefined && number > rules.max) errors[field.id] = `Maximum value is ${rules.max}`;
    } else {
      if (rules.min !== undefined && text.length < rules.min) errors[field.id] = `Enter at least ${rules.min} characters`;
      if (rules.max !== undefined && text.length > rules.max) errors[field.id] = `Enter no more than ${rules.max} characters`;
    }
    if (field.type === "date") {
      if (rules.minDate && text < rules.minDate) errors[field.id] = `Date must be on or after ${rules.minDate}`;
      if (rules.maxDate && text > rules.maxDate) errors[field.id] = `Date must be on or before ${rules.maxDate}`;
    }
  }
  return errors;
}

export async function nextReference(template: ReturnType<typeof parseTemplate>) {
  const database = db();
  const year = new Date().getFullYear();
  const key = `${template.id}:${year}`;
  const row = await database.prepare(`INSERT INTO sequences (sequence_key, last_number)
    VALUES (?, 1)
    ON CONFLICT(sequence_key) DO UPDATE SET last_number = last_number + 1
    RETURNING last_number`).bind(key).first<{ last_number: number }>();
  const sequence = Number(row?.last_number ?? 1);
  const widthMatch = template.numberingPattern.match(/\{SEQ:(\d+)\}/);
  const width = widthMatch ? Number(widthMatch[1]) : 4;
  return template.numberingPattern
    .replaceAll("{CODE}", template.code)
    .replaceAll("{YYYY}", String(year))
    .replace(/\{SEQ(?::\d+)?\}/g, String(sequence).padStart(width, "0"));
}

export type { TemplateRow, SubmissionRow };
