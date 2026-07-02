import { eq, sql } from 'drizzle-orm';
import { oauthClients } from '../../drizzle/oauthMcpSchema';
import db from '../drizzle';
import { DatabaseError } from './common';

export async function createOAuthClient(data: {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  clientUri?: string | null;
  logoUri?: string | null;
}) {
  try {
    const [client] = await db
      .insert(oauthClients)
      .values({
        clientId: data.clientId,
        clientName: data.clientName,
        clientUri: data.clientUri || null,
        logoUri: data.logoUri || null,
        redirectUris: data.redirectUris,
        scopes: data.scopes,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .returning();
    return client;
  } catch (error) {
    throw new DatabaseError('oauth_client_create_failed', error);
  }
}

export async function findOAuthClient(clientId: string) {
  try {
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1);
    return client || null;
  } catch (error) {
    throw new DatabaseError('oauth_client_find_failed:' + clientId, error);
  }
}
