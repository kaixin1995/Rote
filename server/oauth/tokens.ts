import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { SecurityConfig } from '../types/config';
import { getGlobalConfig } from '../utils/config';
import messages from './messages.json';
import { MCP_ACCESS_TOKEN_TTL_SECONDS } from './utils';

export interface McpAccessTokenPayload extends JWTPayload {
  typ: 'mcp_access';
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
}

function getJwtSecret(): Uint8Array {
  const config = getGlobalConfig<SecurityConfig>('security');
  if (!config?.jwtSecret) {
    throw new Error(messages.codes.jwtNotConfigured);
  }
  return new TextEncoder().encode(config.jwtSecret);
}

export async function generateMcpAccessToken(input: {
  issuer: string;
  resource: string;
  userId: string;
  clientId: string;
  scopes: string[];
}): Promise<string> {
  return await new SignJWT({
    typ: 'mcp_access',
    userId: input.userId,
    clientId: input.clientId,
    scope: input.scopes.join(' '),
    resource: input.resource,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(input.issuer)
    .setAudience(input.resource)
    .setExpirationTime(`${MCP_ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifyMcpAccessToken(
  token: string,
  issuer: string,
  resource: string
): Promise<McpAccessTokenPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer,
    audience: resource,
  });

  if (payload.typ !== 'mcp_access') {
    throw new Error(messages.codes.tokenTypeInvalid);
  }

  if (payload.resource !== resource) {
    throw new Error(messages.codes.tokenResourceInvalid);
  }

  if (
    typeof payload.userId !== 'string' ||
    typeof payload.clientId !== 'string' ||
    typeof payload.scope !== 'string'
  ) {
    throw new Error(messages.codes.tokenPayloadInvalid);
  }

  return payload as McpAccessTokenPayload;
}
