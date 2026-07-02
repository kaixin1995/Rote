import { get, post } from './api';

export type OAuthAuthorizeSession = {
  requestId: string;
  client: {
    clientId: string;
    clientName: string;
    clientUri?: string | null;
    logoUri?: string | null;
  };
  scopes: string[];
  resource: string;
  redirectUri: string;
  expiresAt: string;
};

export function getOAuthAuthorizeSession(requestId: string) {
  return get<{
    data: OAuthAuthorizeSession;
  }>('/oauth/authorize/session', { requestId }).then((response) => response.data);
}

export function submitOAuthAuthorizeDecision(requestId: string, decision: 'approve' | 'deny') {
  return post<{
    data: {
      redirectUrl: string;
    };
  }>('/oauth/authorize/approve', { requestId, decision }).then((response) => response.data);
}
