CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`changed_by` text NOT NULL,
	`timestamp` text NOT NULL,
	`summary` text NOT NULL,
	`diff_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`sequence_key` text PRIMARY KEY NOT NULL,
	`last_number` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`unique_number` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`pdf_path` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_unique_number_unique` ON `submissions` (`unique_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_reference_idx` ON `submissions` (`unique_number`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`category` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`field_schema` text NOT NULL,
	`numbering_pattern` text NOT NULL,
	`layout_file_path` text,
	`status` text DEFAULT 'Active' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_code_version_idx` ON `templates` (`code`,`version`);