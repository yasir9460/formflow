import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
