import { sql } from 'drizzle-orm';
import { oauthGrants } from '../../drizzle/oauthMcpSchema';
import db from '../drizzle';
import { DatabaseError } from './common';

export async function upsertOAuthGrant(data: {
  userId: string;
  clientId: string;
  scopes: string[];
  resource: string;
}) {
  try {
    const [grant] = await db
      .insert(oauthGrants)
      .values({
        userid: data.userId,
        clientId: data.clientId,
        scopes: data.scopes,
        resource: data.resource,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [oauthGrants.userid, oauthGrants.clientId, oauthGrants.resource],
        set: { scopes: data.scopes, updatedAt: sql`now()` },
      })
      .returning();
    return grant;
  } catch (error) {
    throw new DatabaseError('oauth_grant_upsert_failed', error);
  }
}
