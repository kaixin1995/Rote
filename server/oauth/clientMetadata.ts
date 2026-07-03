import { findOAuthClient, upsertOAuthClient } from '../utils/dbMethods';
import { assertValidRedirectUri, isPrivateUseRedirectUri } from './utils';
import { normalizeClientScopes } from './flow';
import messages from './messages.json';

const CLIENT_METADATA_MAX_BYTES = 64 * 1024;
const CLIENT_METADATA_FETCH_TIMEOUT_MS = 5000;

type OAuthClientMetadata = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  client_uri?: string;
  logo_uri?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
};

function oauthClientMetadataError(message: string): never {
  throw new Error(messages.codes.clientMetadataInvalidPrefix + message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === 'string')
  ) {
    oauthClientMetadataError(field);
  }
  return value;
}

function assertOptionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') oauthClientMetadataError(field);
  return value;
}

function assertClientMetadataDocumentUrl(clientId: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(clientId);
  } catch {
    oauthClientMetadataError('client_id_url');
  }

  if (parsed.protocol !== 'https:') oauthClientMetadataError('client_id_scheme');
  if (parsed.username || parsed.password) oauthClientMetadataError('client_id_userinfo');
  if (parsed.hash) oauthClientMetadataError('client_id_fragment');
  if (!parsed.pathname || parsed.pathname === '/') oauthClientMetadataError('client_id_path');

  const rawPath = clientId.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '').split(/[?#]/)[0];
  const hasDotSegment = rawPath.split('/').some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    return decoded === '.' || decoded === '..';
  });
  if (hasDotSegment) {
    oauthClientMetadataError('client_id_path_segments');
  }

  return parsed;
}

function isNativePublicClientId(clientId: string): boolean {
  if (clientId.length > 255) return false;
  if (clientId.includes('://')) return false;
  const segments = clientId.split('.');
  if (segments.length < 3) return false;
  return segments.every((segment) => /^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(segment));
}

function nativeClientName(clientId: string): string {
  const segments = clientId.split('.');
  return segments[segments.length - 1] || clientId;
}

function validateClientMetadata(clientId: string, raw: unknown): OAuthClientMetadata {
  if (!isRecord(raw)) oauthClientMetadataError('document');
  if (raw.client_id !== clientId) oauthClientMetadataError('client_id_mismatch');
  if (typeof raw.client_name !== 'string' || raw.client_name.trim().length === 0) {
    oauthClientMetadataError('client_name');
  }

  const redirectUris = assertStringArray(raw.redirect_uris, 'redirect_uris');
  redirectUris.forEach((uri) => assertValidRedirectUri(uri));

  if (
    raw.grant_types !== undefined &&
    !assertStringArray(raw.grant_types, 'grant_types').includes('authorization_code')
  ) {
    oauthClientMetadataError('grant_types');
  }
  if (
    raw.response_types !== undefined &&
    !assertStringArray(raw.response_types, 'response_types').includes('code')
  ) {
    oauthClientMetadataError('response_types');
  }
  if (raw.token_endpoint_auth_method !== undefined && raw.token_endpoint_auth_method !== 'none') {
    oauthClientMetadataError('token_endpoint_auth_method');
  }
  if (raw.scope !== undefined && typeof raw.scope !== 'string') {
    oauthClientMetadataError('scope');
  }

  return {
    client_id: clientId,
    client_name: raw.client_name.trim(),
    redirect_uris: redirectUris,
    client_uri: assertOptionalString(raw.client_uri, 'client_uri') || undefined,
    logo_uri: assertOptionalString(raw.logo_uri, 'logo_uri') || undefined,
    grant_types: Array.isArray(raw.grant_types) ? (raw.grant_types as string[]) : undefined,
    response_types: Array.isArray(raw.response_types)
      ? (raw.response_types as string[])
      : undefined,
    scope: typeof raw.scope === 'string' ? raw.scope : undefined,
    token_endpoint_auth_method:
      typeof raw.token_endpoint_auth_method === 'string'
        ? raw.token_endpoint_auth_method
        : undefined,
  };
}

async function readClientMetadataJson(response: Response): Promise<unknown> {
  if (!response.ok) oauthClientMetadataError('fetch_status');
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > CLIENT_METADATA_MAX_BYTES) {
    oauthClientMetadataError('document_too_large');
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > CLIENT_METADATA_MAX_BYTES) {
    oauthClientMetadataError('document_too_large');
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    oauthClientMetadataError('json');
  }
}

export function isClientMetadataDocumentClientId(clientId: string): boolean {
  try {
    assertClientMetadataDocumentUrl(clientId);
    return true;
  } catch {
    return false;
  }
}

export async function fetchOAuthClientMetadataDocument(clientId: string) {
  assertClientMetadataDocumentUrl(clientId);
  const response = await fetch(clientId, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(CLIENT_METADATA_FETCH_TIMEOUT_MS),
  });
  return validateClientMetadata(clientId, await readClientMetadataJson(response));
}

export async function resolveOAuthClient(clientId: string) {
  const existing = await findOAuthClient(clientId);
  if (existing) return existing;
  if (!isClientMetadataDocumentClientId(clientId)) return null;

  const metadata = await fetchOAuthClientMetadataDocument(clientId);
  return await upsertOAuthClient({
    clientId: metadata.client_id,
    clientName: metadata.client_name,
    redirectUris: metadata.redirect_uris,
    scopes: normalizeClientScopes(metadata.scope),
    clientUri: metadata.client_uri || null,
    logoUri: metadata.logo_uri || null,
  });
}

export async function resolveClientInitiatedOAuthClient(
  clientId: string,
  options: { redirectUri?: string } = {}
) {
  const existing = await resolveOAuthClient(clientId);
  if (existing) return existing;

  if (
    !options.redirectUri ||
    !isNativePublicClientId(clientId) ||
    !isPrivateUseRedirectUri(options.redirectUri)
  ) {
    return null;
  }

  assertValidRedirectUri(options.redirectUri);
  return await upsertOAuthClient({
    clientId,
    clientName: nativeClientName(clientId),
    redirectUris: [options.redirectUri],
    scopes: normalizeClientScopes(undefined),
    clientUri: null,
    logoUri: null,
  });
}

export const clientMetadataTestExports = {
  validateClientMetadata,
  assertClientMetadataDocumentUrl,
  isNativePublicClientId,
};
