import { and, count, eq } from 'drizzle-orm';
import { users, userOAuthBindings, userPasskeys } from '../../drizzle/schema';
import db from '../drizzle';
import { DatabaseError } from './common';

export async function createUserPasskey(data: {
  userid: string;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  transports?: string[];
  deviceName?: string;
}) {
  try {
    const [passkey] = await db
      .insert(userPasskeys)
      .values({
        userid: data.userid,
        credentialId: data.credentialId,
        publicKey: data.publicKey,
        counter: data.counter,
        transports: data.transports || [],
        deviceName: data.deviceName || '',
      })
      .returning();
    return passkey;
  } catch (error: any) {
    throw new DatabaseError(`Failed to create passkey: ${error.message}`, error);
  }
}

export async function getUserPasskeys(userId: string) {
  try {
    return await db
      .select({
        id: userPasskeys.id,
        deviceName: userPasskeys.deviceName,
        credentialId: userPasskeys.credentialId,
        transports: userPasskeys.transports,
        createdAt: userPasskeys.createdAt,
        updatedAt: userPasskeys.updatedAt,
      })
      .from(userPasskeys)
      .where(eq(userPasskeys.userid, userId));
  } catch (error: any) {
    throw new DatabaseError(`Failed to get passkeys for user: ${userId}`, error);
  }
}

export async function getPasskeyByCredentialId(credentialId: string) {
  try {
    const [passkey] = await db
      .select()
      .from(userPasskeys)
      .where(eq(userPasskeys.credentialId, credentialId))
      .limit(1);
    return passkey || null;
  } catch (error: any) {
    throw new DatabaseError(`Failed to get passkey by credential ID`, error);
  }
}

export async function updatePasskeyCounter(credentialId: string, newCounter: number) {
  try {
    await db
      .update(userPasskeys)
      .set({ counter: newCounter, updatedAt: new Date() })
      .where(eq(userPasskeys.credentialId, credentialId));
  } catch (error: any) {
    throw new DatabaseError(`Failed to update passkey counter`, error);
  }
}

export async function deleteUserPasskey(id: string, userId: string) {
  try {
    const result = await db
      .delete(userPasskeys)
      .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userid, userId)))
      .returning();
    if (result.length === 0) {
      throw new DatabaseError('Passkey not found or access denied');
    }
    return result[0];
  } catch (error: any) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(`Failed to delete passkey`, error);
  }
}

export async function getUserPasskeyCount(userId: string): Promise<number> {
  try {
    const [result] = await db
      .select({ count: count() })
      .from(userPasskeys)
      .where(eq(userPasskeys.userid, userId));
    return result?.count || 0;
  } catch (error: any) {
    throw new DatabaseError(`Failed to count passkeys for user: ${userId}`, error);
  }
}

export async function hasOtherLoginMethods(userId: string): Promise<boolean> {
  try {
    const [fullUser] = await db
      .select({ passwordhash: users.passwordhash, salt: users.salt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const hasPassword = Boolean(fullUser?.passwordhash && fullUser?.salt);

    const [oauthBinding] = await db
      .select({ id: userOAuthBindings.id })
      .from(userOAuthBindings)
      .where(eq(userOAuthBindings.userid, userId))
      .limit(1);

    const hasOAuth = Boolean(oauthBinding);

    const passkeyCount = await getUserPasskeyCount(userId);

    return hasPassword || hasOAuth || passkeyCount > 1;
  } catch (error: any) {
    throw new DatabaseError(`Failed to check login methods for user: ${userId}`, error);
  }
}
