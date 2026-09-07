import { writeFile } from "node:fs/promises";
import { GET as getDocx } from "../app/api/document/docx/route";
import { GET as getPdf } from "../app/api/document/pdf/route";

const blocks = [
  { id: "purpose", type: "heading1", text: "Purpose" },
  { id: "purpose-text", type: "paragraph", align: "justify", text: "This policy establishes Common Criteria Pakistan Lab's commitment to a credible and effective management system. It defines the controls used to maintain impartiality, competence, confidentiality, consistent decisions, and continual improvement." },
  { id: "scope", type: "heading1", text: "Scope" },
  { id: "scope-text", type: "paragraph", align: "justify", text: "This policy applies to personnel, contractors, technical activities, certification support functions, and controlled records maintained by CCPL." },
  { id: "requirements", type: "heading1", text: "Policy Requirements" },
  { id: "governance", type: "heading2", text: "Governance and accountability" },
  { id: "governance-text", type: "paragraph", align: "justify", text: "Top management assigns responsibilities, provides resources, reviews performance, and ensures that required corrective actions are completed." },
  { id: "controls", type: "heading3", text: "Documented controls" },
  { id: "bullets", type: "bullets", items: ["Controlled documents are reviewed before approval.", "Obsolete versions remain identifiable in the document register.", "Changes are described in the Document History table."] },
  { id: "roles", type: "table", caption: "Roles and responsibilities", headerRow: true, cells: [["Role", "Responsibility"], ["Director", "Approves controlled policies and provides resources."], ["Document Owner", "Maintains content and initiates revisions."], ["Quality Manager", "Coordinates review and monitors implementation."]] },
  { id: "records", type: "heading1", text: "Records and Retention" },
  { id: "records-table", type: "table", caption: "Records and retention", headerRow: true, cells: [["Record", "Owner", "Retention period", "Disposition"], ["Approval record", "Quality Manager", "Seven years", "Secure disposal"], ["Superseded version", "Document Owner", "Permanent", "Archive"]] },
  { id: "approval", type: "signature", text: "Prepared by\nReviewed by\nApproved by" },
];

const base = {
  name: "Quality Policy",
  code: "CCPL-CB-POL-001",
  category: "Quality",
  description: "Controlled quality policy",
  field_schema: "[]",
  content_schema: JSON.stringify(blocks),
  numbering_pattern: "CCPL-DOC-{CODE}-{YYYY}-{SEQ:4}",
  layout_file_path: null,
  status: "Active",
  created_by: "Yasir Khan",
  created_at: "2026-08-24T08:00:00.000Z",
  updated_at: "2026-08-24T08:00:00.000Z",
  base_template_id: null,
};

const meta = {
  outputStyle: "controlled-document",
  documentType: "POLICY",
  versionLabel: "0.2",
  classification: "PUBLIC",
  documentOwner: "Top Management",
  documentStatus: "DRAFT FOR APPROVAL",
  effectiveDate: "",
  preparedBy: "Yasir Khan",
  reviewedBy: "M. Saim Malik",
  approvedBy: "Director (pending)",
  subtitle: "",
};

const previous = { ...base, id: "document-v1", version: 1, document_meta: JSON.stringify({ ...meta, versionLabel: "0.1" }), change_description: "Initial issue", revision_date: "2026-08-01" };
const current = { ...base, id: "document-v2", version: 2, document_meta: JSON.stringify(meta), change_description: "Added document content blocks and controlled outputs", revision_date: "2026-08-24", base_template_id: previous.id };

class Statement {
  arguments: unknown[] = [];
  constructor(private sql: string) {}
  bind(...args: unknown[]) { this.arguments = args; return this; }
  async first() {
    if (this.sql.includes("COUNT(*)")) return { total: 1 };
    if (this.sql.includes("FROM templates")) return current;
    return null;
  }
  async all() {
    if (this.sql.includes("PRAGMA table_info")) return { results: ["document_meta", "content_schema", "change_description", "revision_date", "base_template_id"].map((name) => ({ name })) };
    if (this.sql.includes("WHERE code")) return { results: [previous, current] };
    return { results: [] };
  }
  async run() { return { success: true }; }
}

const mockDb = { prepare(sql: string) { return new Statement(sql); }, async batch(statements: unknown[]) { return statements.map(() => ({ success: true })); } };
(globalThis as unknown as { __FORMFLOW_DB__: unknown }).__FORMFLOW_DB__ = mockDb;

const pdfOutput = process.argv[2] || "/tmp/ccpl-document-smoke.pdf";
const docxOutput = process.argv[3] || "/tmp/ccpl-document-smoke.docx";
const pdfResponse = await getPdf(new Request("http://localhost/api/document/pdf?id=document-v2"));
if (!pdfResponse.ok) throw new Error(`PDF failed: ${pdfResponse.status} ${await pdfResponse.text()}`);
await writeFile(pdfOutput, new Uint8Array(await pdfResponse.arrayBuffer()));
const docxResponse = await getDocx(new Request("http://localhost/api/document/docx?id=document-v2"));
if (!docxResponse.ok) throw new Error(`DOCX failed: ${docxResponse.status} ${await docxResponse.text()}`);
await writeFile(docxOutput, new Uint8Array(await docxResponse.arrayBuffer()));
console.log(`${pdfOutput}\n${docxOutput}`);
