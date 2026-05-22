CREATE TABLE "user_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userid" uuid NOT NULL,
	"credentialId" text NOT NULL,
	"publicKey" "bytea" NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"deviceName" varchar(255) DEFAULT '',
	"deviceType" varchar(50) DEFAULT '',
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_passkeys_credentialId_unique" UNIQUE("credentialId")
);
--> statement-breakpoint
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "user_passkeys_userid_idx" ON "user_passkeys" USING btree ("userid");--> statement-breakpoint
CREATE INDEX "user_passkeys_credentialId_idx" ON "user_passkeys" USING btree ("credentialId");