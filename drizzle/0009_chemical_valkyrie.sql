CREATE TABLE "document_import_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_url" text NOT NULL,
	"external_title" text NOT NULL,
	"imported_by_id" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"google_account_email" text NOT NULL,
	"google_account_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_import_sources" ADD CONSTRAINT "document_import_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import_sources" ADD CONSTRAINT "document_import_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import_sources" ADD CONSTRAINT "document_import_sources_imported_by_id_user_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_import_sources_document_uidx" ON "document_import_sources" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_import_sources_workspace_provider_external_uidx" ON "document_import_sources" USING btree ("workspace_id","provider","external_id");--> statement-breakpoint
CREATE INDEX "document_import_sources_workspace_idx" ON "document_import_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_user_uidx" ON "google_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "google_connections_account_idx" ON "google_connections" USING btree ("google_account_id");