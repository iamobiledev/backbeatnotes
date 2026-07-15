CREATE INDEX "document_activity_coalesce_idx" ON "document_activity" USING btree ("document_id","user_id","action","updated_at");--> statement-breakpoint
CREATE INDEX "document_invitations_doc_status_expiry_idx" ON "document_invitations" USING btree ("document_id","status","expires_at","created_at");--> statement-breakpoint
CREATE INDEX "documents_active_ws_title_idx" ON "documents" USING btree ("workspace_id","title") WHERE "documents"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "documents_active_ws_updated_idx" ON "documents" USING btree ("workspace_id","updated_at") WHERE "documents"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "documents_active_parent_title_idx" ON "documents" USING btree ("workspace_id","parent_id","title") WHERE "documents"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "documents_trash_ws_archived_idx" ON "documents" USING btree ("workspace_id","archived_at") WHERE "documents"."archived_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_invitations_ws_status_created_idx" ON "workspace_invitations" USING btree ("workspace_id","status","created_at");