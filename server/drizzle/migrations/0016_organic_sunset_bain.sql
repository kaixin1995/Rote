CREATE TABLE "role_permission_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" varchar(50) NOT NULL,
	"permission" varchar(100) NOT NULL,
	"effect" varchar(10) NOT NULL,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_role_permission" UNIQUE("role","permission")
);
--> statement-breakpoint
CREATE TABLE "user_permission_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userid" uuid NOT NULL,
	"permission" varchar(100) NOT NULL,
	"effect" varchar(10) NOT NULL,
	"expiresAt" timestamp (6) with time zone,
	"reason" text,
	"updatedBy" uuid,
	"createdAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp (6) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_user_permission" UNIQUE("userid","permission")
);
--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_userid_users_id_fk" FOREIGN KEY ("userid") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_updatedBy_users_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "role_permission_policies_role_idx" ON "role_permission_policies" USING btree ("role");--> statement-breakpoint
CREATE INDEX "user_permission_overrides_userid_idx" ON "user_permission_overrides" USING btree ("userid");--> statement-breakpoint
INSERT INTO "role_permission_policies" ("role", "permission", "effect")
VALUES
	('user', 'attachment.upload', 'allow'),
	(
		'user',
		'attachment.video.upload',
		CASE WHEN EXISTS (
			SELECT 1
			FROM "settings"
			WHERE "group" = 'ui'
				AND COALESCE(("config"->>'allowUserVideoUpload')::boolean, false) = true
		) THEN 'allow' ELSE 'deny' END
	),
	('user', 'ai.site.chat', 'deny'),
	('moderator', 'attachment.upload', 'allow'),
	(
		'moderator',
		'attachment.video.upload',
		CASE WHEN EXISTS (
			SELECT 1
			FROM "settings"
			WHERE "group" = 'ui'
				AND COALESCE(("config"->>'allowUserVideoUpload')::boolean, false) = true
		) THEN 'allow' ELSE 'deny' END
	),
	('moderator', 'ai.site.chat', 'deny'),
	('admin', 'attachment.upload', 'allow'),
	('admin', 'attachment.video.upload', 'allow'),
	('admin', 'ai.site.chat', 'allow'),
	('super_admin', 'attachment.upload', 'allow'),
	('super_admin', 'attachment.video.upload', 'allow'),
	('super_admin', 'ai.site.chat', 'allow');
