import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { oauthAuthorizationCodes, oauthAuthorizationRequests } from '../../drizzle/oauthMcpSchema';
import db from '../drizzle';
import { DatabaseError } from './common';

export async function createOAuthAuthorizationRequest(data: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state?: string | null;
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: Date;
}) {
  try {
    const [request] = await db
      .insert(oauthAuthorizationRequests)
      .values({
        clientId: data.clientId,
        redirectUri: data.redirectUri,
        scopes: data.scopes,
        state: data.state || null,
        resource: data.resource,
        codeChallenge: data.codeChallenge,
        codeChallengeMethod: data.codeChallengeMethod,
        expiresAt: data.expiresAt,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .returning();
    return request;
  } catch (error) {
    throw new DatabaseError('oauth_authorization_request_create_failed', error);
  }
}

export async function findOAuthAuthorizationRequest(id: string) {
  try {
    const [request] = await db
      .select()
      .from(oauthAuthorizationRequests)
      .where(eq(oauthAuthorizationRequests.id, id))
      .limit(1);
    return request || null;
  } catch (error) {
    throw new DatabaseError('oauth_authorization_request_find_failed:' + id, error);
  }
}

export async function updateOAuthAuthorizationRequestStatus(
  id: string,
  status: 'approved' | 'denied' | 'expired',
  userId?: string
) {
  try {
    const [request] = await db
      .update(oauthAuthorizationRequests)
      .set({
        status,
        userid: userId,
        updatedAt: new Date(),
      })
      .where(eq(oauthAuthorizationRequests.id, id))
      .returning();
    return request || null;
  } catch (error) {
    throw new DatabaseError('oauth_authorization_request_update_failed:' + id, error);
  }
}

export async function createOAuthAuthorizationCode(data: {
  codeHash: string;
  requestId: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  scopes: string[];
  resource: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: Date;
}) {
  try {
    const [code] = await db
      .insert(oauthAuthorizationCodes)
      .values({
        codeHash: data.codeHash,
        requestId: data.requestId,
        clientId: data.clientId,
        userid: data.userId,
        redirectUri: data.redirectUri,
        scopes: data.scopes,
        resource: data.resource,
        codeChallenge: data.codeChallenge,
        codeChallengeMethod: data.codeChallengeMethod,
        expiresAt: data.expiresAt,
        createdAt: sql`now()`,
      })
      .returning();
    return code;
  } catch (error) {
    throw new DatabaseError('oauth_authorization_code_create_failed', error);
  }
}

export async function consumeOAuthAuthorizationCode(codeHash: string) {
  try {
    const [code] = await db
      .update(oauthAuthorizationCodes)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oauthAuthorizationCodes.codeHash, codeHash),
          isNull(oauthAuthorizationCodes.consumedAt),
          gt(oauthAuthorizationCodes.expiresAt, new Date())
        )
      )
      .returning();
    return code || null;
  } catch (error) {
    throw new DatabaseError('oauth_authorization_code_consume_failed', error);
  }
}
