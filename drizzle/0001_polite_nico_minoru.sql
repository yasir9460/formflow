CREATE TABLE `ac_approvals` (
	`template_id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`approver_id` text NOT NULL,
	`pdf_hash` text NOT NULL,
	`docx_hash` text NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_assert` (
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`user_id` text NOT NULL,
	`actor` text NOT NULL,
	`roles` text NOT NULL,
	`action` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_files` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`format` text NOT NULL,
	`part` integer NOT NULL,
	`bytes` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`message` text NOT NULL,
	`at` text NOT NULL,
	`read` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_ownership` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ac_ownership_entity_id_unique` ON `ac_ownership` (`entity_id`);--> statement-breakpoint
CREATE TABLE `ac_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`at` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`content` text NOT NULL,
	`sha256` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ac_users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`roles` text NOT NULL,
	`password` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`must_change` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ac_users_username_unique` ON `ac_users` (`username`);--> statement-breakpoint
CREATE TABLE `ac_workflows` (
	`template_id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`reviewer_id` text,
	`approver_id` text,
	`status` text DEFAULT 'Draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_import_chunks` (
	`import_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_data` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`file_data` blob NOT NULL,
	`imported_by` text NOT NULL,
	`imported_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `templates` ADD `document_meta` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `content_schema` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `change_description` text DEFAULT 'Initial issue' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `revision_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `templates` ADD `base_template_id` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `source_import_id` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `source_file_name` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `source_file_hash` text;--> statement-breakpoint
ALTER TABLE `templates` ADD `import_summary` text DEFAULT '{}' NOT NULL;