import {
  createOAuthRefreshToken,
  findOAuthAuthorizationRequest,
  findOAuthClient,
} from '../utils/dbMethods';
import type { HonoContext } from '../types/hono';
import { generateMcpAccessToken } from './tokens';
import messages from './messages.json';
import {
  DEFAULT_OAUTH_MCP_SCOPES,
  OAUTH_MCP_SCOPES,
  formatScope,
  parseScope,
  validateOAuthScopes,
} from './scopes';
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS,
  expiresIn,
  getOAuthIssuer,
  randomOAuthToken,
  sha256Hex,
} from './utils';

export function getFrontendAuthorizeUrl(c: HonoContext, requestId: string) {
  const frontendUrl = (c.get('dynamicFrontendUrl') || 'http://localhost:3001').replace(/\/$/, '');
  return frontendUrl + '/oauth/authorize?requestId=' + encodeURIComponent(requestId);
}

export function normalizeClientScopes(rawScope: unknown): string[] {
  const scopes = parseScope(rawScope, [...OAUTH_MCP_SCOPES]);
  return validateOAuthScopes(scopes.length > 0 ? scopes : [...OAUTH_MCP_SCOPES]);
}

export function normalizeRequestedScopes(rawScope: unknown, clientScopes: string[]): string[] {
  const scopes = parseScope(rawScope, DEFAULT_OAUTH_MCP_SCOPES);
  const normalized = validateOAuthScopes(scopes.length > 0 ? scopes : DEFAULT_OAUTH_MCP_SCOPES);
  const unsupported = normalized.filter((scope) => !clientScopes.includes(scope));
  if (unsupported.length > 0) {
    throw new Error(messages.codes.scopeNotAllowedPrefix + unsupported.join(','));
  }
  return normalized;
}

export async function getPendingRequestWithClient(requestId: string) {
  const request = await findOAuthAuthorizationRequest(requestId);
  if (!request) {
    throw new Error(messages.codes.requestIdRequired);
  }
  if (request.expiresAt.getTime() <= Date.now()) {
    throw new Error(messages.markers.invalid);
  }
  if (request.status !== 'pending') {
    throw new Error(messages.markers.invalid);
  }

  const client = await findOAuthClient(request.clientId);
  if (!client) {
    throw new Error(messages.errors.invalidClient);
  }
  return { request, client };
}

export async function issueTokenPair(input: {
  c: HonoContext;
  userId: string;
  clientId: string;
  scopes: string[];
  resource: string;
}) {
  const refreshToken = randomOAuthToken(48);
  const refreshRecord = await createOAuthRefreshToken({
    tokenHash: sha256Hex(refreshToken),
    clientId: input.clientId,
    userId: input.userId,
    scopes: input.scopes,
    resource: input.resource,
    expiresAt: expiresIn(OAUTH_REFRESH_TOKEN_TTL_SECONDS),
  });

  const accessToken = await generateMcpAccessToken({
    issuer: getOAuthIssuer(input.c),
    resource: input.resource,
    userId: input.userId,
    clientId: input.clientId,
    scopes: input.scopes,
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: MCP_ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: formatScope(input.scopes),
    resource: input.resource,
    refresh_token_id: refreshRecord.id,
  };
}
