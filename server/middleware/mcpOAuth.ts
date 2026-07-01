import messages from '../oauth/messages.json';
import type { HonoContext } from '../types/hono';
import { getSafeUser } from '../utils/dbMethods';
import { verifyMcpAccessToken } from '../oauth/tokens';
import { getMcpResource, getOAuthIssuer } from '../oauth/utils';

function setAuthChallenge(c: HonoContext, error?: string, scope?: string) {
  const resourceMetadata = `${getOAuthIssuer(c)}/.well-known/oauth-protected-resource`;
  const parts = [`resource_metadata="${resourceMetadata}"`];
  if (error) {
    parts.push(`error="${error}"`);
  }
  if (scope) {
    parts.push(`scope="${scope}"`);
  }
  c.header('WWW-Authenticate', `Bearer ${parts.join(', ')}`);
}

export async function authenticateMcpOAuth(c: HonoContext, next: () => Promise<void>) {
  const authHeader = c.req.header('authorization') || '';
  const [scheme, token] = authHeader.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    setAuthChallenge(c);
    return c.json({ error: messages.errors.authorizationRequired }, 401);
  }

  try {
    const payload = await verifyMcpAccessToken(token, getOAuthIssuer(c), getMcpResource(c));
    const user = await getSafeUser(payload.userId);
    if (!user) {
      setAuthChallenge(c, messages.errors.invalidToken);
      return c.json({ error: messages.errors.invalidToken }, 401);
    }

    c.set('user', user);
    c.set('mcpAuth', {
      token,
      userId: payload.userId,
      clientId: payload.clientId,
      scopes: payload.scope.split(/\s+/).filter(Boolean),
      resource: payload.resource,
    });
    await next();
  } catch (_error) {
    setAuthChallenge(c, messages.errors.invalidToken);
    return c.json({ error: messages.errors.invalidToken }, 401);
  }
}

export function requireMcpScopes(requiredScopes: string[]) {
  return async (c: HonoContext, next: () => Promise<void>) => {
    const auth = c.get('mcpAuth');
    if (!auth) {
      setAuthChallenge(c);
      return c.json({ error: messages.errors.authorizationRequired }, 401);
    }

    const missing = requiredScopes.filter((scope) => !auth.scopes.includes(scope));
    if (missing.length > 0) {
      setAuthChallenge(c, messages.errors.insufficientScope, requiredScopes.join(' '));
      return c.json(
        { error: messages.errors.insufficientScope, scope: requiredScopes.join(' ') },
        403
      );
    }

    await next();
  };
}
