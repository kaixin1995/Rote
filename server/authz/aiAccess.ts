import type { AiConfig } from '../types/config';
import { getPgvectorStatus, getStoredAiConfig } from '../utils/dbMethods/ai';
import { getEffectiveCapabilitiesForUser } from './capabilityService';

export const AI_CERTIFICATION_REQUIRED_MESSAGE = 'AI features require a certified account';
export const AI_MEMORY_UNAVAILABLE_MESSAGE = 'AI memory tools are not available';

type AiAccessUser = {
  id: string;
  certified?: boolean;
  // TODO: 下下次更新移除 emailVerified 入参兼容，调用方统一传 certified。
  emailVerified?: boolean;
};

export async function getUserAiAccess(user: AiAccessUser) {
  const effective = await getEffectiveCapabilitiesForUser(user.id);
  return {
    certified: user.certified === true || user.emailVerified === true,
    siteChatAllowed: effective.capabilities['ai.site.chat'].allowed,
  };
}

type AiAccess = Awaited<ReturnType<typeof getUserAiAccess>>;
type PgvectorStatus = Awaited<ReturnType<typeof getPgvectorStatus>>;

export function getAiAccessErrorFromAccess(access: AiAccess): string | null {
  if (!access.certified) return AI_CERTIFICATION_REQUIRED_MESSAGE;
  if (!access.siteChatAllowed) return 'capability_required:ai.site.chat';
  return null;
}

export async function getAiAccessError(user: AiAccessUser): Promise<string | null> {
  return getAiAccessErrorFromAccess(await getUserAiAccess(user));
}

export function isAiMemoryAvailableForAccess(params: {
  access: AiAccess;
  config: AiConfig;
  vectorStatus: PgvectorStatus;
}): boolean {
  return (
    getAiAccessErrorFromAccess(params.access) === null &&
    params.config.enabled === true &&
    params.config.vectorEnabled === true &&
    params.vectorStatus.installed === true
  );
}

export async function getAiMemoryAccessError(user: AiAccessUser): Promise<string | null> {
  const [access, config, vectorStatus] = await Promise.all([
    getUserAiAccess(user),
    getStoredAiConfig(),
    getPgvectorStatus(),
  ]);
  const accessError = getAiAccessErrorFromAccess(access);
  if (accessError) return accessError;
  return isAiMemoryAvailableForAccess({ access, config, vectorStatus })
    ? null
    : AI_MEMORY_UNAVAILABLE_MESSAGE;
}
