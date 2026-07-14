CREATE TABLE "slack_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_team_name" text NOT NULL,
	"encrypted_bot_token" text NOT NULL,
	"bot_user_id" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"installed_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_events" (
	"event_key" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_user_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connections" ADD CONSTRAINT "slack_connections_installed_by_id_user_id_fk" FOREIGN KEY ("installed_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_user_links" ADD CONSTRAINT "slack_user_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_connections_workspace_uidx" ON "slack_connections" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_connections_team_idx" ON "slack_connections" USING btree ("slack_team_id");--> statement-breakpoint
CREATE INDEX "slack_events_received_idx" ON "slack_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_links_team_slack_user_uidx" ON "slack_user_links" USING btree ("slack_team_id","slack_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_user_links_user_team_uidx" ON "slack_user_links" USING btree ("user_id","slack_team_id");