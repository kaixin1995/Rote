import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(import.meta.dir, '../drizzle/migrations/0018_ai_chat_capability.sql'),
  'utf8'
);

describe('AI capability migration', () => {
  it('migrates role policies and user overrides from ai.site.chat to ai.chat', () => {
    expect(migrationSql).toContain('"role_permission_policies"');
    expect(migrationSql).toContain('"user_permission_overrides"');
    expect(migrationSql).toContain("'ai.site.chat'");
    expect(migrationSql).toContain("'ai.chat'");
    expect(migrationSql).toContain('ON CONFLICT ("role", "permission") DO NOTHING');
    expect(migrationSql).toContain('DELETE FROM "role_permission_policies"');
    expect(migrationSql).toContain('DELETE FROM "user_permission_overrides"');
  });
});
