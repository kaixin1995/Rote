import type { User } from '../../drizzle/schema';
import type { NotificationConfig } from '../../types/config';
import { getGlobalConfig } from '../config';
import { buildPublicNoteCreatedEnvelope, buildUserRegisteredEnvelope } from './envelope';
import { sendAdminHookEnvelope } from './delivery';

export { buildPublicNoteCreatedEnvelope, buildUserRegisteredEnvelope } from './envelope';
export { sendAdminHookEnvelope } from './delivery';
export { validateAdminHookChannel, validateNotificationConfig } from './validation';
export type {
  AdminHookActor,
  AdminHookDeliveryResult,
  AdminHookDeliverySummary,
  AdminHookEnvelope,
} from './types';

export async function notifyUserRegistered(user: Partial<User>) {
  return await sendAdminHookEnvelope(buildUserRegisteredEnvelope(user));
}

export async function notifyPublicNoteCreated(note: any) {
  return await sendAdminHookEnvelope(buildPublicNoteCreatedEnvelope(note));
}

export async function findAdminHookChannel(channelId: string) {
  const notificationConfig = getGlobalConfig<NotificationConfig>('notification');
  return notificationConfig?.adminHooks?.channels?.find((channel) => channel.id === channelId);
}
