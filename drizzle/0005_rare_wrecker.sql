CREATE TYPE "public"."document_permission_level" AS ENUM('full_access', 'edit', 'view');--> statement-breakpoint
ALTER TYPE "public"."document_activity_action" ADD VALUE 'shared';--> statement-breakpoint
ALTER TYPE "public"."document_activity_action" ADD VALUE 'unshared';--> statement-breakpoint
ALTER TYPE "public"."document_activity_action" ADD VALUE 'general_access_changed';--> statement-breakpoint
CREATE TABLE "document_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"email" text NOT NULL,
	"level" "document_permission_level" DEFAULT 'view' NOT NULL,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"invited_by_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text NOT NULL,
	"level" "document_permission_level" DEFAULT 'view' NOT NULL,
	"invited_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_invitations" ADD CONSTRAINT "document_invitations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_invitations" ADD CONSTRAINT "document_invitations_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_permissions" ADD CONSTRAINT "document_permissions_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_invitations_token_uidx" ON "document_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "document_invitations_email_idx" ON "document_invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "document_invitations_doc_idx" ON "document_invitations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_invitations_expires_idx" ON "document_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_permissions_doc_user_uidx" ON "document_permissions" USING btree ("document_id","user_id");--> statement-breakpoint
CREATE INDEX "document_permissions_user_idx" ON "document_permissions" USING btree ("user_id");--> statement-breakpoint
-- Data migration: publish state is now tracked by published_at/public_slug
-- alone ("Publish" tab), while visibility only models in-app General access
-- ("Only people invited" = private vs "Everyone at {workspace}" = workspace).
-- Convert legacy published rows; their published_at/public_slug are kept.
UPDATE "documents" SET "visibility" = 'workspace' WHERE "visibility" = 'public';