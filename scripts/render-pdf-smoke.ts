import { writeFile } from "node:fs/promises";
import { GET } from "../app/api/pdf/route";

const controlled = process.argv[3] === "controlled";
const fields = Array.from({ length: 18 }, (_, index) => ({
  id: `field_${index + 1}`,
  label: index % 3 === 2 ? "Detailed requirement and supporting evidence" : `Policy statement ${index + 1}`,
  type: index % 5 === 4 ? "textarea" : index % 7 === 0 ? "date" : "text",
  required: index % 2 === 0,
  section: ["Purpose and Scope", "Policy Requirements", "Responsibilities", "Monitoring and Review"][Math.floor(index / 5)] || "Monitoring and Review",
}));

const template = {
  id: "template-smoke",
  name: controlled ? "Quality Policy" : "Equipment Calibration Request",
  code: controlled ? "CCPL-CB-POL-001" : "CCPL-CB-FRM-001",
  version: 1,
  category: "Quality",
  description: "Controlled quality policy",
  field_schema: JSON.stringify(fields),
  document_meta: JSON.stringify({
    outputStyle: controlled ? "controlled-document" : "operational-form",
    documentType: controlled ? "POLICY" : "FORM",
    versionLabel: controlled ? "0.1" : "1.0",
    classification: "INTERNAL",
    documentOwner: "Quality Management",
    documentStatus: "DRAFT FOR APPROVAL",
    effectiveDate: "2026-08-24",
    preparedBy: "Yasir Khan",
    reviewedBy: "Quality Manager",
    approvedBy: "Director",
    subtitle: "",
  }),
  numbering_pattern: "CCPL-POL-{CODE}-{YYYY}-{SEQ:4}",
  layout_file_path: null,
  status: "Active",
  created_by: "Yasir Khan",
  created_at: "2026-08-24T08:00:00.000Z",
  updated_at: "2026-08-24T08:00:00.000Z",
};

const submission = {
  id: "submission-smoke",
  template_id: template.id,
  unique_number: controlled ? "CCPL-CB-POL-001-2026-0001" : "CCPL-CB-FRM-001-2026-0001",
  data: JSON.stringify(Object.fromEntries(fields.map((field, index) => [
    field.id,
    field.type === "date"
      ? "2025-01-15"
      : index % 5 === 4
        ? "CCPL maintains an effective management system. Objective evidence, responsibilities, controls, and review requirements are retained as controlled information."
        : `Approved policy content for requirement ${index + 1}.`,
  ]))),
  status: "Submitted",
  created_by: "Yasir Khan",
  created_at: "2026-08-24T08:05:00.000Z",
  updated_at: "2026-08-24T08:05:00.000Z",
  revision: 0,
  pdf_path: "/api/pdf?id=submission-smoke",
};

class Statement {
  arguments: unknown[] = [];
  constructor(private sql: string) {}
  bind(...args: unknown[]) { this.arguments = args; return this; }
  async first() {
    if (this.sql.includes("COUNT(*)")) return { total: 1 };
    if (this.sql.includes("FROM submissions")) return submission;
    if (this.sql.includes("FROM templates")) return template;
    return null;
  }
  async all() {
    if (this.sql.includes("PRAGMA table_info")) return { results: [{ name: "document_meta" }] };
    return { results: [] };
  }
  async run() { return { success: true }; }
}

const mockDb = {
  prepare(sql: string) { return new Statement(sql); },
  async batch(statements: unknown[]) { return statements.map(() => ({ success: true })); },
};

(globalThis as unknown as { __FORMFLOW_DB__: unknown }).__FORMFLOW_DB__ = mockDb;

const response = await GET(new Request("http://localhost/api/pdf?id=submission-smoke"));
if (!response.ok) throw new Error(`PDF request failed: ${response.status} ${await response.text()}`);
const output = process.argv[2] || "/tmp/ccpl-formflow-smoke.pdf";
await writeFile(output, new Uint8Array(await response.arrayBuffer()));
console.log(output);
