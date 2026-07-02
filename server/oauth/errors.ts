import type { HonoContext } from '../types/hono';
import messages from './messages.json';

export class OAuthProtocolError extends Error {
  constructor(
    public oauthError: string,
    message: string,
    public status = 400
  ) {
    super(message);
    this.name = 'OAuthProtocolError';
  }
}

export function oauthError(error: string, description: string, status = 400): never {
  throw new OAuthProtocolError(error, description, status);
}

function toOAuthError(error: unknown): OAuthProtocolError {
  if (error instanceof OAuthProtocolError) {
    return error;
  }

  const message = error instanceof Error ? error.message : messages.requestFailed;
  if (
    message.includes(messages.markers.oauthScopeInvalid) ||
    message.includes(messages.markers.scopeNotAllowed)
  ) {
    return new OAuthProtocolError(messages.errors.invalidScope, message, 400);
  }
  if (message.includes(messages.markers.redirectUri)) {
    return new OAuthProtocolError(messages.errors.invalidRequest, message, 400);
  }
  if (message.includes(messages.markers.resource)) {
    return new OAuthProtocolError(messages.errors.invalidTarget, message, 400);
  }
  if (message.includes(messages.markers.client)) {
    return new OAuthProtocolError(messages.errors.invalidClient, message, 400);
  }
  if (
    message.includes(messages.markers.required) ||
    message.includes(messages.markers.missing) ||
    message.includes(messages.markers.invalid)
  ) {
    return new OAuthProtocolError(messages.errors.invalidRequest, message, 400);
  }

  return new OAuthProtocolError(messages.errors.invalidRequest, message, 400);
}

export async function withOAuthErrors(c: HonoContext, action: () => Promise<Response> | Response) {
  try {
    return await action();
  } catch (error: any) {
    if (error?.name === 'DatabaseError') {
      throw error;
    }

    const protocolError = toOAuthError(error);
    return c.json(
      {
        error: protocolError.oauthError,
        error_description: protocolError.message,
      },
      protocolError.status as any
    );
  }
}
