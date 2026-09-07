CREATE TRIGGER ac_check_cas BEFORE INSERT ON ac_assert WHEN NEW.value<>1 BEGIN SELECT RAISE(ABORT,'Stale document revision'); END;
--> statement-breakpoint
CREATE INDEX ac_sessions_user ON ac_sessions(user_id);
--> statement-breakpoint
CREATE INDEX ac_attempts_account_at ON ac_attempts(username,at);
--> statement-breakpoint
CREATE INDEX ac_workflows_author ON ac_workflows(author_id);
--> statement-breakpoint
CREATE INDEX ac_notifications_user_read ON ac_notifications(user_id,read,at);
--> statement-breakpoint
CREATE INDEX ac_audit_entity ON ac_audit(entity_id,at);
--> statement-breakpoint
CREATE INDEX ac_snapshots_template ON ac_snapshots(template_id,at);
--> statement-breakpoint
CREATE UNIQUE INDEX ac_files_part ON ac_files(template_id,format,part);
--> statement-breakpoint
CREATE TRIGGER ac_single_super_insert BEFORE INSERT ON ac_users WHEN (json_array_length(NEW.roles)=0 OR (EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value='super_admin') AND NEW.id<>'super-admin') OR (NEW.id='super-admin' AND (NEW.active<>1 OR NEW.roles<>'["super_admin"]'))) BEGIN SELECT RAISE(ABORT,'Invalid protected account'); END;
--> statement-breakpoint
CREATE TRIGGER ac_single_super_update BEFORE UPDATE ON ac_users WHEN NEW.id<>OLD.id OR NEW.username<>OLD.username OR json_array_length(NEW.roles)=0 OR (EXISTS(SELECT 1 FROM json_each(NEW.roles) WHERE value='super_admin') AND NEW.id<>'super-admin') OR (OLD.id='super-admin' AND (NEW.active<>1 OR NEW.roles<>'["super_admin"]')) BEGIN SELECT RAISE(ABORT,'Protected account'); END;
--> statement-breakpoint
CREATE TRIGGER ac_users_no_delete BEFORE DELETE ON ac_users BEGIN SELECT RAISE(ABORT,'Deactivate users; do not delete identities'); END;
--> statement-breakpoint
CREATE TRIGGER ac_template_lock BEFORE UPDATE ON templates WHEN EXISTS(SELECT 1 FROM ac_workflows WHERE template_id=OLD.id AND status NOT IN ('Draft','Changes Requested')) AND (NEW.content_schema<>OLD.content_schema OR NEW.name<>OLD.name OR NEW.code<>OLD.code OR NEW.version<>OLD.version OR NEW.source_import_id IS NOT OLD.source_import_id OR NEW.description<>OLD.description) BEGIN SELECT RAISE(ABORT,'Document is locked'); END;
--> statement-breakpoint
CREATE TRIGGER ac_approved_metadata_lock BEFORE UPDATE ON templates WHEN EXISTS(SELECT 1 FROM ac_approvals WHERE template_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Approved versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER ac_template_no_delete BEFORE DELETE ON templates WHEN EXISTS(SELECT 1 FROM ac_workflows WHERE template_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Archive documents; do not delete versions'); END;
--> statement-breakpoint
CREATE TRIGGER ac_audit_no_update BEFORE UPDATE ON ac_audit BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_audit_no_delete BEFORE DELETE ON ac_audit BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_snapshots_no_update BEFORE UPDATE ON ac_snapshots BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_snapshots_no_delete BEFORE DELETE ON ac_snapshots BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_approvals_no_update BEFORE UPDATE ON ac_approvals BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_approvals_no_delete BEFORE DELETE ON ac_approvals BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_files_no_update BEFORE UPDATE ON ac_files BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER ac_files_no_delete BEFORE DELETE ON ac_files BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Immutable history'); END;
