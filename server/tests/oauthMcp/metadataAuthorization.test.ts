import {
  API_BASE,
  MCP_RESOURCE,
  REDIRECT_URI,
  assert,
  assertStatus,
  publicRequest,
  request,
} from './common.test';
import { extractRequestId, startAuthorization } from './flow.test';

export async function testMetadata() {
  const protectedResource = await publicRequest('/.well-known/oauth-protected-resource');
  assertStatus(protectedResource.status, 200, 'protected resource metadata');
  assert(protectedResource.data.resource === MCP_RESOURCE, 'protected resource mismatch');
  const authServer = await publicRequest('/.well-known/oauth-authorization-server');
  assertStatus(authServer.status, 200, 'authorization server metadata');
  assert(
    authServer.data.authorization_endpoint?.endsWith('/v2/api/oauth/authorize'),
    'missing auth endpoint'
  );
  assert(authServer.data.token_endpoint?.endsWith('/v2/api/oauth/token'), 'missing token endpoint');
}

export async function testAuthorizeValidation(clientId: string, codeChallenge: string) {
  const badResponseTypeParams = new URLSearchParams({
    response_type: 'token',
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: 'notes:read',
    resource: MCP_RESOURCE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  const badResponseType = await request('GET', '/oauth/authorize?' + badResponseTypeParams, {
    redirect: 'manual',
  });
  assertStatus(badResponseType.status, 400, 'unsupported response_type');
  assert(
    badResponseType.data.error === 'unsupported_response_type',
    'unsupported response_type should return OAuth error'
  );

  const badRedirect = await startAuthorization({
    clientId,
    scopes: ['notes:read'],
    codeChallenge,
    redirectUri: 'http://localhost:9999/wrong',
  });
  assertStatus(badRedirect.status, 400, 'bad redirect_uri should be rejected');
  assert(badRedirect.data.error === 'invalid_request', 'bad redirect should return OAuth error');

  const badScope = await startAuthorization({
    clientId,
    scopes: ['notes:read', 'unknown:scope'],
    codeChallenge,
  });
  assertStatus(badScope.status, 400, 'bad scope should be rejected');
  assert(badScope.data.error === 'invalid_scope', 'bad scope should return OAuth error');

  const badResource = await startAuthorization({
    clientId,
    scopes: ['notes:read'],
    codeChallenge,
    resource: API_BASE + '/not-mcp',
  });
  assertStatus(badResource.status, 400, 'bad resource should be rejected');
  assert(badResource.data.error === 'invalid_target', 'bad resource should return OAuth error');
}

export async function testDenyFlow(
  appAccessToken: string,
  clientId: string,
  codeChallenge: string
) {
  const authorize = await startAuthorization({
    clientId,
    scopes: ['notes:read'],
    codeChallenge,
    state: 'deny-state',
  });
  assertStatus(authorize.status, 302, 'deny flow authorization redirect');
  const requestId = extractRequestId(authorize.headers.get('location') || '');
  const deny = await request('POST', '/oauth/authorize/approve', {
    headers: { Authorization: 'Bearer ' + appAccessToken },
    body: { requestId, decision: 'deny' },
  });
  assertStatus(deny.status, 200, 'authorization denial');
  const redirectUrl = new URL(deny.data.data.redirectUrl);
  assert(redirectUrl.searchParams.get('error') === 'access_denied', 'deny redirect error mismatch');
  assert(redirectUrl.searchParams.get('state') === 'deny-state', 'deny redirect state mismatch');
}
