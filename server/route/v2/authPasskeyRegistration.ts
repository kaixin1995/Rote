import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono } from 'hono';
import { eq, or } from 'drizzle-orm';
import { users, userPasskeys } from '../../drizzle/schema';
import type { SecurityConfig, SiteConfig, UiConfig } from '../../types/config';
import type { HonoContext, HonoVariables } from '../../types/hono';
import { notifyUserRegistered } from '../../utils/adminHooks';
import { trackBackgroundTask } from '../../utils/backgroundTask';
import { getConfig, getGlobalConfig } from '../../utils/config';
import db from '../../utils/drizzle';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt';
import { createResponse, sanitizeUserData } from '../../utils/main';
import { RegisterDataZod } from '../../utils/zod';

const passkeyRegistrationRouter = new Hono<{ Variables: HonoVariables }>();

interface PendingRegistration {
  userData: { username: string; email: string; nickname: string; tempUserId: string };
  challenge: string;
  expiresAt: number;
}

const pendingRegistrations = new Map<string, PendingRegistration>();

function storePendingRegistration(
  token: string,
  userData: PendingRegistration['userData'],
  challenge: string
) {
  if (pendingRegistrations.size > 500) {
    const now = Date.now();
    for (const [k, v] of pendingRegistrations) {
      if (now > v.expiresAt) pendingRegistrations.delete(k);
    }
  }
  pendingRegistrations.set(token, { userData, challenge, expiresAt: Date.now() + 300_000 });
}

function getAndDeletePendingRegistration(token: string) {
  const entry = pendingRegistrations.get(token);
  if (!entry || Date.now() > entry.expiresAt) {
    pendingRegistrations.delete(token);
    return null;
  }
  pendingRegistrations.delete(token);
  return entry;
}

// 无密码注册 - Step 1: 验证用户数据，生成 passkey 注册 options
passkeyRegistrationRouter.post('/options', async (c: HonoContext) => {
  const uiConfig = await getConfig<UiConfig>('ui');
  if (uiConfig && uiConfig.allowRegistration === false) {
    return c.json(createResponse(null, 'Registration is currently disabled'), 403);
  }

  const securityConfig = getGlobalConfig<SecurityConfig>('security');
  if (securityConfig?.passkey?.enabled === false) {
    return c.json(createResponse(null, 'Passkey is disabled', 400), 400);
  }

  const body = await c.req.json();
  const { username, email, nickname } = body;

  // Validate user data (no password)
  RegisterDataZod.parse({ username, email, nickname, password: undefined });

  // Check username/email uniqueness early
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.username, username), eq(users.email, email)))
    .limit(1);
  if (existing.length > 0) {
    return c.json(createResponse(null, 'Username or email already exists', 409), 409);
  }

  // Generate temp user ID for WebAuthn
  const tempUserId = crypto.randomUUID();

  // Get passkey config
  const origin = c.req.header('origin');
  const siteConfig = await getConfig<SiteConfig>('site');
  const passkeyCfg = securityConfig?.passkey;
  const frontendUrl = origin || siteConfig?.frontendUrl || 'http://localhost:3001';
  const url = new URL(frontendUrl);
  const rpId = passkeyCfg?.rpId || url.hostname;
  const rpName = passkeyCfg?.rpName || siteConfig?.name || 'Rote';

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: email || username,
    userDisplayName: nickname || username,
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  // Store pending registration
  const registrationToken = crypto.randomUUID();
  storePendingRegistration(
    registrationToken,
    { username, email, nickname, tempUserId },
    options.challenge
  );

  return c.json(
    createResponse({
      options,
      registrationToken,
    }),
    200
  );
});

// 无密码注册 - Step 2: 验证 passkey，创建账号
passkeyRegistrationRouter.post('/verify', async (c: HonoContext) => {
  const body = await c.req.json();
  const { credential, registrationToken, deviceName } = body as {
    credential: RegistrationResponseJSON;
    registrationToken: string;
    deviceName?: string;
  };

  const pending = getAndDeletePendingRegistration(registrationToken);
  if (!pending) {
    return c.json(createResponse(null, 'Registration expired or invalid', 400), 400);
  }

  // Get passkey config for origin/RP verification
  const origin = c.req.header('origin');
  const siteConfig = await getConfig<SiteConfig>('site');
  const securityConfig = getGlobalConfig<SecurityConfig>('security');
  const passkeyCfg = securityConfig?.passkey;
  const frontendUrl = origin || siteConfig?.frontendUrl || 'http://localhost:3001';
  const url = new URL(frontendUrl);
  const rpId = passkeyCfg?.rpId || url.hostname;
  const expectedOrigin = passkeyCfg?.origin || frontendUrl;

  // Verify passkey
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: pending.challenge,
    expectedOrigin,
    expectedRPID: rpId,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return c.json(createResponse(null, 'Passkey verification failed', 400), 400);
  }

  const { credential: regCredential } = verification.registrationInfo;
  const { userData } = pending;

  // Create user + passkey atomically in a transaction
  const { defaultUserRole } = (await getConfig<UiConfig>('ui')) || {};

  const result = await db.transaction(async (tx) => {
    // Create user (no password)
    const salt = crypto.randomBytes(16);
    const userId = crypto.randomUUID();
    const [user] = await tx
      .insert(users)
      .values({
        id: userId,
        username: userData.username,
        email: userData.email,
        nickname: userData.nickname,
        passwordhash: null,
        salt,
        role: defaultUserRole || 'user',
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Create passkey
    const [passkey] = await tx
      .insert(userPasskeys)
      .values({
        userid: user.id,
        credentialId: regCredential.id,
        publicKey: Buffer.from(regCredential.publicKey),
        counter: regCredential.counter,
        transports: credential.response?.transports as string[] | undefined,
        deviceName: deviceName || '',
      })
      .returning();

    return { user, passkey };
  });

  trackBackgroundTask(notifyUserRegistered(result.user), 'admin_hook_user_registered_failed');

  // Generate JWT tokens
  const accessToken = await generateAccessToken({
    userId: result.user.id,
    username: result.user.username,
  });
  const refreshToken = await generateRefreshToken({
    userId: result.user.id,
    username: result.user.username,
  });

  return c.json(
    createResponse({
      user: sanitizeUserData(result.user),
      accessToken,
      refreshToken,
    }),
    201
  );
});

export default passkeyRegistrationRouter;
