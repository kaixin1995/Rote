import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono } from 'hono';
import { eq, or } from 'drizzle-orm';
import { users, userPasskeys } from '../../drizzle/schema';
import type { User } from '../../drizzle/schema';
import { requireSecurityConfig } from '../../middleware/configCheck';
import { authenticateJWT } from '../../middleware/jwtAuth';
import type { SecurityConfig, SiteConfig, UiConfig } from '../../types/config';
import type { HonoContext, HonoVariables } from '../../types/hono';
import { getConfig, getGlobalConfig } from '../../utils/config';
import db from '../../utils/drizzle';
import { changeUserPassword, createUser, oneUser, passportCheckUser } from '../../utils/dbMethods';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { createResponse, sanitizeUserData } from '../../utils/main';
import { passwordChangeZod, RegisterDataZod } from '../../utils/zod';

// 认证相关路由
const authRouter = new Hono<{ Variables: HonoVariables }>();

// 无密码注册 - 临时存储 (registrationToken → { userData, challenge, expiresAt })
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

// 注册
authRouter.post('/register', async (c: HonoContext) => {
  // 检查是否允许注册
  const uiConfig = await getConfig<UiConfig>('ui');
  if (uiConfig && uiConfig.allowRegistration === false) {
    return c.json(createResponse(null, 'Registration is currently disabled'), 403);
  }

  const body = await c.req.json();
  const { username, password, email, nickname } = body;

  // If passkey is disabled, password is required
  const securityConfig = getGlobalConfig<SecurityConfig>('security');
  const passkeyEnabled = securityConfig?.passkey?.enabled !== false;
  if (!passkeyEnabled && !password) {
    return c.json(createResponse(null, 'Password is required when passkey is disabled', 400), 400);
  }

  RegisterDataZod.parse(body);

  // 使用配置中的默认用户角色，如果没有配置则使用 'user'
  const defaultRole = uiConfig?.defaultUserRole || 'user';

  const user = await createUser({
    username,
    password,
    email,
    nickname,
    role: defaultRole,
  });

  if (!user.id) {
    throw new Error('Registration failed, username or email already exists');
  }

  // Generate JWT tokens so the user is immediately logged in (supports passkey registration during signup)
  const accessToken = await generateAccessToken({
    userId: user.id,
    username: user.username,
  });
  const refreshToken = await generateRefreshToken({
    userId: user.id,
    username: user.username,
  });

  const sanitizedUser = sanitizeUserData(user);
  return c.json(
    createResponse(
      {
        user: sanitizedUser,
        accessToken,
        refreshToken,
      },
      'Registration successful'
    ),
    201
  );
});

// 无密码注册 - Step 1: 验证用户数据，生成 passkey 注册 options
authRouter.post('/register/passkey/options', async (c: HonoContext) => {
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
      userVerification: 'preferred',
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
authRouter.post('/register/passkey/verify', async (c: HonoContext) => {
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

// 登录 (手动实现，不再使用 Passport)
authRouter.post('/login', requireSecurityConfig, async (c: HonoContext) => {
  const body = await c.req.json();
  const { username, password } = body;

  if (!username || !password) {
    throw new Error('Username or email and password are required');
  }

  // 查找用户（支持用户名或邮箱）
  const { user, err } = await passportCheckUser({ usernameOrEmail: username });
  if (err || !user) {
    throw new Error('User not found.');
  }

  // 检查用户是否有密码（只要有密码，无论 authProvider 是什么，都允许密码登录）
  // 这样支持账号密码用户绑定 GitHub 后仍可用密码登录
  if (!user.passwordhash || !user.salt) {
    throw new Error('This account uses OAuth login. Please use GitHub to sign in.');
  }

  // 验证密码
  // 此时 TypeScript 仍认为 passwordhash 和 salt 可能为 null，需要明确断言
  const passwordhash = user.passwordhash;
  const salt = user.salt;
  if (!passwordhash || !salt) {
    throw new Error('Password hash or salt is missing');
  }

  // TypeScript 类型守卫：确保类型正确
  const saltBuffer: Buffer = Buffer.isBuffer(salt)
    ? salt
    : Buffer.from(salt as unknown as string | ArrayLike<number>);
  const passwordhashBuffer: Buffer = Buffer.isBuffer(passwordhash)
    ? passwordhash
    : Buffer.from(passwordhash as unknown as string | ArrayLike<number>);

  return new Promise<Response>((resolve, reject) => {
    crypto.pbkdf2(
      password,
      saltBuffer,
      310000,
      32,
      'sha256',
      async (err: any, hashedPassword: Buffer) => {
        if (err || !user) {
          return reject(new Error('Authentication failed'));
        }

        try {
          const isEqual = crypto.timingSafeEqual(passwordhashBuffer, hashedPassword);

          if (!isEqual) {
            return reject(new Error('Incorrect username/email or password.'));
          }

          // 生成 JWT tokens (完全无状态，不存储到数据库)
          const accessToken = await generateAccessToken({
            userId: user.id,
            username: user.username,
          });
          const refreshToken = await generateRefreshToken({
            userId: user.id,
            username: user.username,
          });

          const response = c.json(
            createResponse(
              {
                user: sanitizeUserData(user as User),
                accessToken,
                refreshToken,
              },
              'Login successful'
            ),
            200
          );
          resolve(response);
        } catch (_tokenError) {
          return reject(new Error('Token generation failed'));
        }
      }
    );
  });
});

// 修改密码
authRouter.put('/password', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const body = await c.req.json();
  const { newpassword, oldpassword } = body;

  // 检查用户是否有密码（只有有密码的用户才能修改密码）
  const fullUser = await oneUser(user.id);
  if (!fullUser) {
    throw new Error('User not found');
  }
  if (!fullUser.passwordhash || !fullUser.salt) {
    throw new Error('OAuth users cannot change password. Please use OAuth login.');
  }

  const zodData = passwordChangeZod.safeParse(body);
  if (zodData.success === false) {
    // 提取所有错误消息，合并显示（最多显示前 3 个）
    const errorMessages = zodData.error.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .filter((msg): msg is string => typeof msg === 'string' && msg.length > 0);

    if (errorMessages.length > 0) {
      const message = errorMessages.length === 1 ? errorMessages[0] : errorMessages.join('; ');
      throw new Error(message);
    } else {
      throw new Error('Password validation failed');
    }
  }

  const updatedUser = await changeUserPassword(oldpassword, newpassword, user.id);
  const sanitizedUser = sanitizeUserData(updatedUser);
  return c.json(createResponse(sanitizedUser), 200);
});

// Token 刷新端点
authRouter.post('/refresh', requireSecurityConfig, async (c: HonoContext) => {
  const body = await c.req.json();
  const { refreshToken } = body;

  if (!refreshToken) {
    return c.json(createResponse(null, 'Refresh token required', 401), 401);
  }

  try {
    const payload = await verifyRefreshToken(refreshToken);
    const newAccessToken = await generateAccessToken({
      userId: payload.userId,
      username: payload.username,
    });
    const newRefreshToken = await generateRefreshToken({
      userId: payload.userId,
      username: payload.username,
    });

    return c.json(
      createResponse(
        {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
        'Token refreshed successfully'
      ),
      200
    );
  } catch (_error) {
    return c.json(createResponse(null, 'Invalid refresh token', 401), 401);
  }
});

export default authRouter;
