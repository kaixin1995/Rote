import {
  API_BASE,
  MCP_RESOURCE,
  REDIRECT_URI,
  assert,
  assertStatus,
  registerClient,
  request,
  randomToken,
  sha256Base64Url,
} from './common.test';
import {
  authorizeAndExchange,
  createApprovedCode,
  extractRequestId,
  startAuthorization,
} from './flow.test';

export async function testRefreshAndRevoke(clientId: string, refreshToken: string) {
  const refresh = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource: MCP_RESOURCE,
    }),
  });
  assertStatus(refresh.status, 200, 'refresh token exchange');
  assert(refresh.data.access_token, 'refreshed access token missing');
  assert(refresh.data.refresh_token, 'rotated refresh token missing');
  assert(refresh.data.refresh_token !== refreshToken, 'refresh token was not rotated');

  const reuseOld = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource: MCP_RESOURCE,
    }),
  });
  assertStatus(reuseOld.status, 400, 'old refresh token reuse');
  const revoke = await request('POST', '/oauth/revoke', {
    form: new URLSearchParams({ token: refresh.data.refresh_token, client_id: clientId }),
  });
  assertStatus(revoke.status, 200, 'refresh token revoke');
  const revokedUse = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refresh.data.refresh_token,
      resource: MCP_RESOURCE,
    }),
  });
  assertStatus(revokedUse.status, 400, 'revoked refresh token use');
}

export async function testSingleUseTokenConcurrency(appAccessToken: string, clientId: string) {
  const { code, verifier } = await createApprovedCode({
    appAccessToken,
    clientId,
    scopes: ['notes:read'],
  });
  const exchangeForm = () =>
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
      resource: MCP_RESOURCE,
    });
  const codeResults = await Promise.all([
    request('POST', '/oauth/token', { form: exchangeForm() }),
    request('POST', '/oauth/token', { form: exchangeForm() }),
  ]);
  const codeSuccesses = codeResults.filter((result) => result.status === 200);
  const codeFailures = codeResults.filter(
    (result) => result.status === 400 && result.data.error === 'invalid_grant'
  );
  assert(codeSuccesses.length === 1, 'authorization code concurrent exchange must succeed once');
  assert(
    codeFailures.length === 1,
    'authorization code concurrent exchange must reject reuse once'
  );

  const refreshToken = codeSuccesses[0].data.refresh_token;
  assert(refreshToken, 'concurrent exchange refresh token missing');
  const refreshForm = () =>
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource: MCP_RESOURCE,
    });
  const refreshResults = await Promise.all([
    request('POST', '/oauth/token', { form: refreshForm() }),
    request('POST', '/oauth/token', { form: refreshForm() }),
  ]);
  const refreshSuccesses = refreshResults.filter((result) => result.status === 200);
  const refreshFailures = refreshResults.filter(
    (result) => result.status === 400 && result.data.error === 'invalid_grant'
  );
  assert(refreshSuccesses.length === 1, 'refresh token concurrent rotation must succeed once');
  assert(refreshFailures.length === 1, 'refresh token concurrent rotation must reject reuse once');
}

export async function testPkceReuseAndAudience(appAccessToken: string, clientId: string) {
  const verifier = randomToken(48);
  const codeChallenge = await sha256Base64Url(verifier);
  const authorize = await startAuthorization({ clientId, scopes: ['notes:read'], codeChallenge });
  assertStatus(authorize.status, 302, 'PKCE authorization redirect');
  const requestId = extractRequestId(authorize.headers.get('location') || '');
  const approve = await request('POST', '/oauth/authorize/approve', {
    headers: { Authorization: 'Bearer ' + appAccessToken },
    body: { requestId, decision: 'approve' },
  });
  assertStatus(approve.status, 200, 'PKCE approval');
  const code = new URL(approve.data.data.redirectUrl).searchParams.get('code');
  assert(code, 'PKCE code missing');

  const wrongVerifier = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: 'wrong-verifier',
      resource: MCP_RESOURCE,
    }),
  });
  assertStatus(wrongVerifier.status, 400, 'wrong PKCE verifier');
  const secondUse = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier,
      resource: MCP_RESOURCE,
    }),
  });
  assertStatus(secondUse.status, 400, 'authorization code reuse after failed PKCE');

  const badAudienceClient = await registerClient(['notes:read']);
  const badAudience = await authorizeAndExchange({
    appAccessToken,
    clientId: badAudienceClient.client_id,
    scopes: ['notes:read'],
    resource: MCP_RESOURCE,
  });
  const wrongResource = await request('POST', '/oauth/token', {
    form: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: badAudienceClient.client_id,
      refresh_token: badAudience.refreshToken,
      resource: API_BASE + '/wrong-resource',
    }),
  });
  assertStatus(wrongResource.status, 400, 'wrong refresh resource');
}
