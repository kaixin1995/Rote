CREATE TABLE "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codeHash" text NOT NULL,
	"requestId" uuid NOT NULL,
	"clientId" varchar(255) NOT NULL,
	"userid" uuid NOT NULL,
	"redirectUri" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"resource" text NOT NULL,
	"codeChallenge" text NOT NULL,
	"codeChallengeMethod" varchar(20) NOT NULL,
	"consumedAt" timestamp (6) with time zone,
	"expiresAt" timestamp (6) with time zone NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_codes_codeHash_unique" UNIQUE("codeHash")
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clientId" varchar(255) NOT NULL,
	"redirectUri" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"state" text,
	"resource" text NOT NULL,
	"codeChallenge" text NOT NULL,
	"codeChallengeMethod" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"userid" uuid,
	"expiresAt" timestamp (6) with time zone NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clientId" varchar(255) NOT NULL,
	"clientName" varchar(255) NOT NULL,
	"clientUri" text,
	"logoUri" text,
	"redirectUris" text[] NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"grantTypes" text[] DEFAULT '{"authorization_code","refresh_token"}' NOT NULL,
	"responseTypes" text[] DEFAULT '{"code"}' NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_clientId_unique" UNIQUE("clientId")
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userid" uuid NOT NULL,
	"clientId" varchar(255) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"resource" text NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_oauth_grant_user_client_resource" UNIQUE("userid","clientId","resource")
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tokenHash" text NOT NULL,
	"clientId" varchar(255) NOT NULL,
	"userid" uuid NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"resource" text NOT NULL,
	"revokedAt" timestamp (6) with time zone,
	"replacedByTokenId" uuid,
	"expiresAt" timestamp (6) with time zone NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_refresh_tokens_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_clientId_oauth_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_clients"("clientId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_requestId_oauth_authorization_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."oauth_authorization_requests"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_clientId_oauth_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_clients"("clientId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_clientId_oauth_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_clients"("clientId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_clientId_oauth_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_clients"("clientId") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_codeHash_idx" ON "oauth_authorization_codes" USING btree ("codeHash");--> statement-breakpoint
CREATE INDEX "oauth_authorization_codes_requestId_idx" ON "oauth_authorization_codes" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "oauth_authorization_requests_clientId_idx" ON "oauth_authorization_requests" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauth_authorization_requests_expiresAt_idx" ON "oauth_authorization_requests" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "oauth_clients_clientId_idx" ON "oauth_clients" USING btree ("clientId");--> statement-breakpoint
CREATE INDEX "oauth_grants_userid_idx" ON "oauth_grants" USING btree ("userid");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_tokenHash_idx" ON "oauth_refresh_tokens" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_client_user_idx" ON "oauth_refresh_tokens" USING btree ("clientId","userid");