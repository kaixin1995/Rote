import { Hono } from 'hono';
import serverInfo from '../mcp/serverInfo.json';
import type { HonoContext, HonoVariables } from '../types/hono';
import { OAUTH_MCP_SCOPES } from '../oauth/scopes';
import {
  getMcpResource,
  getOAuthAuthorizeEndpoint,
  getOAuthIssuer,
  getOAuthRegisterEndpoint,
  getOAuthRevokeEndpoint,
  getOAuthTokenEndpoint,
} from '../oauth/utils';

const oauthMetadataRouter = new Hono<{ Variables: HonoVariables }>();

oauthMetadataRouter.get('/oauth-protected-resource', (c: HonoContext) => {
  const resource = getMcpResource(c);
  return c.json({
    resource,
    authorization_servers: [getOAuthIssuer(c)],
    scopes_supported: OAUTH_MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: serverInfo.name,
  });
});

oauthMetadataRouter.get('/oauth-authorization-server', (c: HonoContext) =>
  c.json({
    issuer: getOAuthIssuer(c),
    authorization_endpoint: getOAuthAuthorizeEndpoint(c),
    token_endpoint: getOAuthTokenEndpoint(c),
    registration_endpoint: getOAuthRegisterEndpoint(c),
    revocation_endpoint: getOAuthRevokeEndpoint(c),
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: OAUTH_MCP_SCOPES,
    resource_documentation: getMcpResource(c),
  })
);

export default oauthMetadataRouter;
