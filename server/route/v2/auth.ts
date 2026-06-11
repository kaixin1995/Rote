import crypto from 'crypto';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { users, userPasskeys, userOAuthBindings } from '../../drizzle/schema';
import type { User } from '../../drizzle/schema';
import { requireSecurityConfig } from '../../middleware/configCheck';
import { authenticateJWT } from '../../middleware/jwtAuth';
import type { SecurityConfig, UiConfig } from '../../types/config';
import type { HonoContext, HonoVariables } from '../../types/hono';
import { getConfig, getGlobalConfig } from '../../utils/config';
import db from '../../utils/drizzle';
import { changeUserPassword, createUser, oneUser, passportCheckUser } from '../../utils/dbMethods';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { createResponse, sanitizeUserData } from '../../utils/main';
import { passwordChangeZod, RegisterDataZod } from '../../utils/zod';
import passkeyRegistrationRouter from './authPasskeyRegistration';

// 认证相关路由
const authRouter = new Hono<{ Variables: HonoVariables }>();

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

authRouter.route('/register/passkey', passkeyRegistrationRouter);

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

// 清除密码 (切换为纯无密码模式)
authRouter.delete('/password', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const body = await c.req.json().catch(() => ({}));
  const { password } = body;

  // 1. 获取完整用户信息
  const fullUser = await oneUser(user.id);
  if (!fullUser) {
    return c.json(createResponse(null, 'User not found', 404), 404);
  }

  // 2. 如果当前有密码，则必须验证密码
  if (fullUser.passwordhash && fullUser.salt) {
    if (!password) {
      return c.json(
        createResponse(null, 'Current password is required to clear password', 400),
        400
      );
    }
    // 验证密码
    const saltBuffer = Buffer.isBuffer(fullUser.salt)
      ? fullUser.salt
      : Buffer.from(fullUser.salt as unknown as string);
    const passwordhashBuffer = Buffer.isBuffer(fullUser.passwordhash)
      ? fullUser.passwordhash
      : Buffer.from(fullUser.passwordhash as unknown as string);

    const isMatch = await new Promise<boolean>((resolve) => {
      crypto.pbkdf2(password, saltBuffer, 310000, 32, 'sha256', (err, hashedPassword) => {
        if (err) return resolve(false);
        try {
          resolve(crypto.timingSafeEqual(passwordhashBuffer, hashedPassword));
        } catch {
          resolve(false);
        }
      });
    });

    if (!isMatch) {
      return c.json(createResponse(null, 'Incorrect password', 400), 400);
    }
  }

  // 3. 核心防锁死校验
  const oauthBindings = await db
    .select()
    .from(userOAuthBindings)
    .where(eq(userOAuthBindings.userid, user.id));

  const passkeys = await db.select().from(userPasskeys).where(eq(userPasskeys.userid, user.id));

  const securityConfig = getGlobalConfig<SecurityConfig>('security');
  const passkeyEnabled = securityConfig?.passkey?.enabled !== false;

  const hasOAuth = oauthBindings.length > 0;
  const hasUsablePasskey = passkeys.length > 0 && passkeyEnabled;

  if (!hasOAuth && !hasUsablePasskey) {
    return c.json(
      createResponse(
        null,
        passkeyEnabled
          ? 'Must bind at least one OAuth provider or Passkey before clearing password'
          : 'Must bind at least one OAuth provider before clearing password (Passkey login is disabled)',
        400
      ),
      400
    );
  }

  // 4. 清除密码
  await db
    .update(users)
    .set({
      passwordhash: null,
      salt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // 获取更新后的用户信息并返回
  const updatedUser = await oneUser(user.id);
  if (!updatedUser) {
    return c.json(createResponse(null, 'User not found after update', 404), 404);
  }

  // 注入 hasPassword: false 并序列化返回
  const sanitizedUser = sanitizeUserData(updatedUser);
  const profileResponse = {
    ...sanitizedUser,
    hasPassword: false,
  };

  return c.json(createResponse(profileResponse, 'Password cleared successfully'), 200);
});

// 设置密码 (适用于无密码账户设置密码)
authRouter.post('/password/set', authenticateJWT, async (c: HonoContext) => {
  const user = c.get('user') as User;
  const body = await c.req.json().catch(() => ({}));
  const { newpassword } = body;

  // 1. 获取完整用户信息
  const fullUser = await oneUser(user.id);
  if (!fullUser) {
    return c.json(createResponse(null, 'User not found', 404), 404);
  }

  // 2. 检查当前是否已经有密码
  if (fullUser.passwordhash && fullUser.salt) {
    return c.json(
      createResponse(
        null,
        'Account already has a password. Please use change password endpoint instead.',
        400
      ),
      400
    );
  }

  // 3. 验证新密码强度/格式
  const zodData = passwordChangeZod.safeParse({ newpassword, oldpassword: 'placeholder_not_used' });
  if (zodData.success === false) {
    const errorMessages = zodData.error.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .filter((msg): msg is string => typeof msg === 'string' && msg.length > 0);

    const message =
      errorMessages.length === 1
        ? errorMessages[0]
        : errorMessages.join('; ') || 'Password validation failed';
    return c.json(createResponse(null, message, 400), 400);
  }

  // 4. 生成 hash 并更新数据库
  const salt = crypto.randomBytes(16);
  const passwordhash = crypto.pbkdf2Sync(newpassword, salt, 310000, 32, 'sha256');

  await db
    .update(users)
    .set({
      passwordhash,
      salt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // 获取更新后的用户信息并返回
  const updatedUser = await oneUser(user.id);
  if (!updatedUser) {
    return c.json(createResponse(null, 'User not found after update', 404), 404);
  }

  const sanitizedUser = sanitizeUserData(updatedUser);
  const profileResponse = {
    ...sanitizedUser,
    hasPassword: true,
  };

  return c.json(createResponse(profileResponse, 'Password set successfully'), 200);
});

export default authRouter;
