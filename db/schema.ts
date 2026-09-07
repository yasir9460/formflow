import { blob, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export const acUsers = sqliteTable("ac_users", {
 id:text("id").primaryKey(), username:text("username").notNull().unique(), name:text("name").notNull(), email:text("email").notNull().default(""),
 roles:text("roles").notNull(), password:text("password").notNull(), active:integer("active").notNull().default(1), mustChange:integer("must_change").notNull().default(1), createdAt:text("created_at").notNull()
});
export const acSessions = sqliteTable("ac_sessions", { tokenHash:text("token_hash").primaryKey(), userId:text("user_id").notNull(), expiresAt:text("expires_at").notNull(), lastSeen:text("last_seen").notNull() });
export const acAttempts = sqliteTable("ac_attempts", { id:text("id").primaryKey(), username:text("username").notNull(), at:text("at").notNull() });
export const acWorkflows = sqliteTable("ac_workflows", {
 templateId:text("template_id").primaryKey(), authorId:text("author_id").notNull(), reviewerId:text("reviewer_id"), approverId:text("approver_id"),
 status:text("status").notNull().default("Draft"), revision:integer("revision").notNull().default(0), round:integer("round").notNull().default(0), updatedAt:text("updated_at").notNull()
});
export const acOwnership = sqliteTable("ac_ownership", { id:text("id").primaryKey(),kind:text("kind").notNull(),entityId:text("entity_id").notNull().unique(),userId:text("user_id").notNull() });
export const acAudit = sqliteTable("ac_audit", { id:text("id").primaryKey(),at:text("at").notNull(),userId:text("user_id").notNull(),actor:text("actor").notNull(),roles:text("roles").notNull(),action:text("action").notNull(),entityId:text("entity_id").notNull(),detail:text("detail").notNull() });
export const acNotifications = sqliteTable("ac_notifications", { id:text("id").primaryKey(),userId:text("user_id").notNull(),entityId:text("entity_id").notNull(),message:text("message").notNull(),at:text("at").notNull(),read:integer("read").notNull().default(0) });
export const acSnapshots = sqliteTable("ac_snapshots", { id:text("id").primaryKey(),templateId:text("template_id").notNull(),at:text("at").notNull(),userId:text("user_id").notNull(),action:text("action").notNull(),content:text("content").notNull(),sha256:text("sha256").notNull() });
export const acFiles = sqliteTable("ac_files", { id:text("id").primaryKey(),templateId:text("template_id").notNull(),format:text("format").notNull(),part:integer("part").notNull(),bytes:blob("bytes").notNull() });
export const acApprovals = sqliteTable("ac_approvals", { templateId:text("template_id").primaryKey(),at:text("at").notNull(),approverId:text("approver_id").notNull(),pdfHash:text("pdf_hash").notNull(),docxHash:text("docx_hash").notNull(),contentHash:text("content_hash").notNull() });
export const acAssert = sqliteTable("ac_assert", { value:integer("value").notNull() });

export const templates = sqliteTable(
  "templates",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    version: integer("version").notNull().default(1),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    fieldSchema: text("field_schema").notNull(),
    documentMeta: text("document_meta").notNull().default("{}"),
    contentSchema: text("content_schema").notNull().default("[]"),
    changeDescription: text("change_description").notNull().default("Initial issue"),
    revisionDate: text("revision_date").notNull().default(""),
    baseTemplateId: text("base_template_id"),
    sourceImportId: text("source_import_id"),
    sourceFileName: text("source_file_name"),
    sourceFileHash: text("source_file_hash"),
    importSummary: text("import_summary").notNull().default("{}"),
    numberingPattern: text("numbering_pattern").notNull(),
    layoutFilePath: text("layout_file_path"),
    status: text("status").notNull().default("Active"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("templates_code_version_idx").on(table.code, table.version)],
);

export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    uniqueNumber: text("unique_number").notNull().unique(),
    data: text("data").notNull(),
    status: text("status").notNull().default("Draft"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    revision: integer("revision").notNull().default(0),
    pdfPath: text("pdf_path").notNull(),
  },
  (table) => [uniqueIndex("submissions_reference_idx").on(table.uniqueNumber)],
);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  submissionId: text("submission_id").notNull(),
  changedBy: text("changed_by").notNull(),
  timestamp: text("timestamp").notNull(),
  summary: text("summary").notNull(),
  diffJson: text("diff_json").notNull(),
});

export const sequences = sqliteTable("sequences", {
  sequenceKey: text("sequence_key").primaryKey(),
  lastNumber: integer("last_number").notNull().default(0),
});

export const documentImports = sqliteTable("document_imports", {
  id: text("id").primaryKey(),
  templateId: text("template_id"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  sha256: text("sha256").notNull(),
  fileData: blob("file_data").notNull(),
  importedBy: text("imported_by").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const documentImportChunks = sqliteTable("document_import_chunks", {
  importId: text("import_id").notNull(),
  chunkIndex: integer("chunk_index").notNull(),
  chunkData: blob("chunk_data").notNull(),
});
