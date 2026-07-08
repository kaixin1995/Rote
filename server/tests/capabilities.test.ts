import { describe, expect, it } from 'bun:test';
import { UserRole } from '../types/main';
import { resolveEffectiveCapabilities } from '../authz/capabilities';

describe('capability resolution', () => {
  it('keeps AI chat denied for users and allowed for admins by default', () => {
    const userCapabilities = resolveEffectiveCapabilities({ role: UserRole.USER });
    const moderatorCapabilities = resolveEffectiveCapabilities({ role: UserRole.MODERATOR });
    const adminCapabilities = resolveEffectiveCapabilities({ role: UserRole.ADMIN });

    expect(userCapabilities['ai.chat'].allowed).toBe(false);
    expect(moderatorCapabilities['ai.chat'].allowed).toBe(false);
    expect(adminCapabilities['ai.chat'].allowed).toBe(true);
  });

  it('uses user overrides before role policies', () => {
    const capabilities = resolveEffectiveCapabilities({
      role: UserRole.USER,
      rolePolicies: { 'ai.chat': 'deny' },
      userOverrides: { 'ai.chat': 'allow' },
    });

    expect(capabilities['ai.chat']).toEqual({
      allowed: true,
      source: 'user_override',
      role: UserRole.USER,
    });
  });

  it('denies video upload when attachment upload is denied', () => {
    const capabilities = resolveEffectiveCapabilities({
      role: UserRole.USER,
      userOverrides: {
        'attachment.upload': 'deny',
        'attachment.video.upload': 'allow',
      },
    });

    expect(capabilities['attachment.video.upload']).toEqual({
      allowed: false,
      source: 'dependency',
      role: UserRole.USER,
    });
  });

  it('does not allow policies or overrides to reduce super admin permissions', () => {
    const capabilities = resolveEffectiveCapabilities({
      role: UserRole.SUPER_ADMIN,
      rolePolicies: { 'ai.chat': 'deny' },
      userOverrides: { 'attachment.upload': 'deny' },
    });

    expect(Object.values(capabilities).every((capability) => capability.allowed)).toBe(true);
  });
});
