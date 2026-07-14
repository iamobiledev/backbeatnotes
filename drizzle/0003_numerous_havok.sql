CREATE TYPE "public"."document_activity_action" AS ENUM('created', 'edited', 'renamed', 'moved', 'trashed', 'restored', 'published', 'unpublished', 'version_restored', 'locked', 'unlocked');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('doc', 'wiki');--> statement-breakpoint
CREATE TABLE "document_activity" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"user_id" text,
	"action" "document_activity_action" NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_id" text NOT NULL,
	"document_id" text,
	"type" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "doc_type" "document_type" DEFAULT 'doc' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "locked_by_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'developer' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "email_notifications" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_activity" ADD CONSTRAINT "document_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_activity_doc_created_idx" ON "document_activity" USING btree ("document_id","updated_at");--> statement-breakpoint
CREATE INDEX "document_activity_user_idx" ON "document_activity" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notification_log_recipient_doc_idx" ON "notification_log" USING btree ("recipient_id","document_id","type","sent_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_locked_by_id_user_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;