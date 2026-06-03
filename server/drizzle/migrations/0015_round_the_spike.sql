CREATE TABLE "ai_token_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userid" uuid NOT NULL,
	"model" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"promptTokens" integer DEFAULT 0 NOT NULL,
	"completionTokens" integer DEFAULT 0 NOT NULL,
	"totalTokens" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_token_usage_logs" ADD CONSTRAINT "ai_token_usage_logs_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ai_token_usage_logs_userid_idx" ON "ai_token_usage_logs" USING btree ("userid");--> statement-breakpoint
CREATE INDEX "ai_token_usage_logs_createdAt_idx" ON "ai_token_usage_logs" USING btree ("createdAt");