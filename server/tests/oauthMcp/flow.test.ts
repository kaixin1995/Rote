import {
  MCP_RESOURCE,
  REDIRECT_URI,
  assert,
  assertStatus,
  randomToken,
  request,
  sha256Base64Url,
  type Json,
} from './common.test';

export async function startAuthorization(input: {
  clientId: string;
  scopes: string[];
  codeChallenge: string;
  state?: string;
  resource?: string;
  redirectUri?: string;
}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri || REDIRECT_URI,
    scope: input.scopes.join(' '),
    resource: input.resource || MCP_RESOURCE,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (input.state) params.set('state', input.state);
  return await request('GET', '/oauth/authorize?' + params, { redirect: 'manual' });
}

export function extractRequestId(location: string): string {
  const url = new URL(location);
  const requestId = url.searchParams.get('requestId');
  assert(requestId, 'authorization redirect missing requestId: ' + location);
  return requestId;
}

export async function authorizeAndExchange(input: {
  appAccessToken: string;
  clientId: string;
  scopes: string[];
  resource?: string;
}) {
  const verifier = randomToken(48);
  const codeChallenge = await sha256Base64Url(verifier);
  const state = randomToken(12);
  const authorize = await startAuthorization({
    clientId: input.clientId,
    scopes: input.scopes,
    codeChallenge,
    state,
    resource: input.resource,
  });
  assertStatus(authorize.status, 302, 'authorization redirect');
  const requestId = extractRequestId(authorize.headers.get('location') || '');

  const session = await request('GET', '/oauth/authorize/session?requestId=' + requestId, {
    headers: { Authorization: 'Bearer ' + input.appAccessToken },
  });
  assertStatus(session.status, 200, 'authorization session');
  assert(session.data.data?.client?.clientId === input.clientId, 'session client mismatch');
  assert(Array.isArray(session.data.data?.scopes), 'session scopes missing');

  const approve = await request('POST', '/oauth/authorize/approve', {
    headers: { Authorization: 'Bearer ' + input.appAccessToken },
    body: { requestId, decision: 'approve' },
  });
  assertStatus(approve.status, 200, 'authorization approval');
  const redirectUrl = approve.data.data?.redirectUrl;
  assert(redirectUrl, 'approval redirectUrl missing');
  const redirect = new URL(redirectUrl);
  assert(redirect.searchParams.get('state') === state, 'approval state mismatch');
  const code = redirect.searchParams.get('code');
  assert(code, 'authorization code missing');

  const token = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: input.clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
      resource: input.resource || MCP_RESOURCE,
    }),
  });
  assertStatus(token.status, 200, 'authorization code exchange');
  assert(token.data.access_token, 'access token missing');
  assert(token.data.refresh_token, 'refresh token missing');
  assert(token.data.token_type === 'Bearer', 'token type mismatch');
  return {
    accessToken: token.data.access_token as string,
    refreshToken: token.data.refresh_token as string,
    code,
    verifier,
  };
}

export async function createApprovedCode(input: {
  appAccessToken: string;
  clientId: string;
  scopes: string[];
  resource?: string;
}) {
  const verifier = randomToken(48);
  const codeChallenge = await sha256Base64Url(verifier);
  const state = randomToken(12);
  const authorize = await startAuthorization({
    clientId: input.clientId,
    scopes: input.scopes,
    codeChallenge,
    state,
    resource: input.resource,
  });
  assertStatus(authorize.status, 302, 'approved code authorization redirect');
  const requestId = extractRequestId(authorize.headers.get('location') || '');
  const approve = await request('POST', '/oauth/authorize/approve', {
    headers: { Authorization: 'Bearer ' + input.appAccessToken },
    body: { requestId, decision: 'approve' },
  });
  assertStatus(approve.status, 200, 'approved code authorization approval');
  const redirect = new URL(approve.data.data.redirectUrl);
  assert(redirect.searchParams.get('state') === state, 'approved code state mismatch');
  const code = redirect.searchParams.get('code');
  assert(code, 'approved authorization code missing');
  return { code, verifier };
}

export async function mcp(
  accessToken: string,
  method: string,
  params?: Json,
  id: string | number | null = randomToken(4)
) {
  return await request('POST', '/mcp', {
    headers: { Authorization: 'Bearer ' + accessToken },
    body: { jsonrpc: '2.0', id, method, params },
  });
}

export async function callTool(
  accessToken: string,
  name: string,
  args: Json = {},
  expectOk = true
) {
  const response = await mcp(accessToken, 'tools/call', { name, arguments: args });
  if (expectOk) {
    assertStatus(response.status, 200, 'MCP tool ' + name);
    assert(
      !response.data.error,
      'MCP tool ' + name + ' returned error: ' + JSON.stringify(response.data.error)
    );
    const text = response.data.result?.content?.[0]?.text;
    assert(typeof text === 'string', 'MCP tool ' + name + ' missing text content');
    return JSON.parse(text).data;
  }
  assert(
    response.status >= 400 || response.data.error || response.data.result,
    'MCP tool ' + name + ' should return a result or a clear JSON-RPC error'
  );
  return response.data;
}
