import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { oauthRefreshTokens } from '../../drizzle/oauthMcpSchema';
import db from '../drizzle';
import { DatabaseError } from './common';

export async function createOAuthRefreshToken(data: {
  tokenHash: string;
  clientId: string;
  userId: string;
  scopes: string[];
  resource: string;
  expiresAt: Date;
}) {
  try {
    const [token] = await db
      .insert(oauthRefreshTokens)
      .values({
        tokenHash: data.tokenHash,
        clientId: data.clientId,
        userid: data.userId,
        scopes: data.scopes,
        resource: data.resource,
        expiresAt: data.expiresAt,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .returning();
    return token;
  } catch (error) {
    throw new DatabaseError('oauth_refresh_token_create_failed', error);
  }
}

export async function findOAuthRefreshToken(tokenHash: string) {
  try {
    const [token] = await db
      .select()
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, tokenHash))
      .limit(1);
    return token || null;
  } catch (error) {
    throw new DatabaseError('oauth_refresh_token_find_failed', error);
  }
}

export async function rotateOAuthRefreshToken(data: {
  tokenHash: string;
  clientId: string;
  resource: string;
  newTokenHash: string;
  expiresAt: Date;
}) {
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const [oldToken] = await tx
        .update(oauthRefreshTokens)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(oauthRefreshTokens.tokenHash, data.tokenHash),
            eq(oauthRefreshTokens.clientId, data.clientId),
            eq(oauthRefreshTokens.resource, data.resource),
            isNull(oauthRefreshTokens.revokedAt),
            gt(oauthRefreshTokens.expiresAt, now)
          )
        )
        .returning();
      if (!oldToken) return null;

      const [newToken] = await tx
        .insert(oauthRefreshTokens)
        .values({
          tokenHash: data.newTokenHash,
          clientId: oldToken.clientId,
          userid: oldToken.userid,
          scopes: oldToken.scopes,
          resource: oldToken.resource,
          expiresAt: data.expiresAt,
          createdAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .returning();

      await tx
        .update(oauthRefreshTokens)
        .set({ replacedByTokenId: newToken.id, updatedAt: new Date() })
        .where(eq(oauthRefreshTokens.id, oldToken.id));
      return { oldToken, newToken };
    });
  } catch (error) {
    throw new DatabaseError('oauth_refresh_token_rotate_failed', error);
  }
}

export async function revokeOAuthRefreshToken(id: string, replacedByTokenId?: string) {
  try {
    const [token] = await db
      .update(oauthRefreshTokens)
      .set({
        revokedAt: new Date(),
        replacedByTokenId,
        updatedAt: new Date(),
      })
      .where(eq(oauthRefreshTokens.id, id))
      .returning();
    return token || null;
  } catch (error) {
    throw new DatabaseError('oauth_refresh_token_revoke_failed:' + id, error);
  }
}
