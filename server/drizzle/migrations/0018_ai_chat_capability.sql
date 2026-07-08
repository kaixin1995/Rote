INSERT INTO "role_permission_policies" ("role", "permission", "effect", "createdAt", "updatedAt")
SELECT old_policy."role", 'ai.chat', old_policy."effect", old_policy."createdAt", now()
FROM "role_permission_policies" old_policy
WHERE old_policy."permission" = 'ai.site.chat'
  AND NOT EXISTS (
    SELECT 1
    FROM "role_permission_policies" existing
    WHERE existing."role" = old_policy."role"
      AND existing."permission" = 'ai.chat'
  );
--> statement-breakpoint
INSERT INTO "role_permission_policies" ("role", "permission", "effect")
VALUES
  ('user', 'ai.chat', 'deny'),
  ('moderator', 'ai.chat', 'deny'),
  ('admin', 'ai.chat', 'allow'),
  ('super_admin', 'ai.chat', 'allow')
ON CONFLICT ("role", "permission") DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_permission_overrides" (
  "userid",
  "permission",
  "effect",
  "expiresAt",
  "reason",
  "updatedBy",
  "createdAt",
  "updatedAt"
)
SELECT
  old_override."userid",
  'ai.chat',
  old_override."effect",
  old_override."expiresAt",
  old_override."reason",
  old_override."updatedBy",
  old_override."createdAt",
  now()
FROM "user_permission_overrides" old_override
WHERE old_override."permission" = 'ai.site.chat'
  AND NOT EXISTS (
    SELECT 1
    FROM "user_permission_overrides" existing
    WHERE existing."userid" = old_override."userid"
      AND existing."permission" = 'ai.chat'
  );
--> statement-breakpoint
DELETE FROM "role_permission_policies" WHERE "permission" = 'ai.site.chat';
--> statement-breakpoint
DELETE FROM "user_permission_overrides" WHERE "permission" = 'ai.site.chat';
