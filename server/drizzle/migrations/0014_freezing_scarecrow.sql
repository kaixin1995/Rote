CREATE TABLE "document_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid NOT NULL,
	"sourceType" varchar(20) NOT NULL,
	"sourceId" uuid NOT NULL,
	"chunkIndex" integer NOT NULL,
	"contentHash" varchar(64) NOT NULL,
	"embeddingModel" text NOT NULL,
	"embeddingDimensions" integer NOT NULL,
	"embedding" text NOT NULL,
	"text" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_embeddings_source_chunk_unique" UNIQUE("sourceType","sourceId","chunkIndex")
);
--> statement-breakpoint
CREATE TABLE "embedding_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ownerId" uuid NOT NULL,
	"sourceType" varchar(20) NOT NULL,
	"sourceId" uuid NOT NULL,
	"action" varchar(20) DEFAULT 'upsert' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"lockedAt" timestamp (6) with time zone,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_embeddings" ADD CONSTRAINT "document_embeddings_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "embedding_jobs" ADD CONSTRAINT "embedding_jobs_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "document_embeddings_ownerId_idx" ON "document_embeddings" USING btree ("ownerId");--> statement-breakpoint
CREATE INDEX "document_embeddings_source_idx" ON "document_embeddings" USING btree ("sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "document_embeddings_owner_source_idx" ON "document_embeddings" USING btree ("ownerId","sourceType");--> statement-breakpoint
CREATE INDEX "document_embeddings_model_dimensions_idx" ON "document_embeddings" USING btree ("embeddingModel","embeddingDimensions");--> statement-breakpoint
CREATE INDEX "embedding_jobs_status_idx" ON "embedding_jobs" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX "embedding_jobs_source_idx" ON "embedding_jobs" USING btree ("sourceType","sourceId");--> statement-breakpoint
CREATE INDEX "embedding_jobs_ownerId_idx" ON "embedding_jobs" USING btree ("ownerId");