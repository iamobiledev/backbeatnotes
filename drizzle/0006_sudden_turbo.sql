CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "document_search_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"block_id" text NOT NULL,
	"block_type" text NOT NULL,
	"position" integer NOT NULL,
	"text_content" text NOT NULL,
	"input_hash" text NOT NULL,
	"embedding" vector(512),
	"embedded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_search_blocks" ADD CONSTRAINT "document_search_blocks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_search_blocks_doc_block_uidx" ON "document_search_blocks" USING btree ("document_id","block_id");--> statement-breakpoint
CREATE INDEX "document_search_blocks_doc_position_idx" ON "document_search_blocks" USING btree ("document_id","position");--> statement-breakpoint
CREATE INDEX "document_search_blocks_embedding_hnsw_idx" ON "document_search_blocks" USING hnsw ("embedding" vector_cosine_ops) WHERE "document_search_blocks"."embedding" IS NOT NULL;