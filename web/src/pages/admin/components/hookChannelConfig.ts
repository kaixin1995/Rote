import type { AdminHookChannel, AdminHookEvent } from '../types';

export const HOOK_EVENTS: AdminHookEvent[] = ['user.registered', 'note.public.created'];

export const EVENT_TRANSLATION_KEYS: Record<AdminHookEvent, string> = {
  'note.public.created': 'notePublicCreated',
  'user.registered': 'userRegistered',
};

export const DEFAULT_EVENT_SELECTION: AdminHookEvent[] = ['user.registered', 'note.public.created'];

export const BARK_SOUND_DEFAULT_VALUE = '__default__';

export const BARK_SOUND_OPTIONS = [
  { translationKey: 'alarm', value: 'alarm' },
  { translationKey: 'anticipate', value: 'anticipate' },
  { translationKey: 'bell', value: 'bell' },
  { translationKey: 'birdsong', value: 'birdsong' },
  { translationKey: 'bloom', value: 'bloom' },
  { translationKey: 'calypso', value: 'calypso' },
  { translationKey: 'chime', value: 'chime' },
  { translationKey: 'choo', value: 'choo' },
  { translationKey: 'descent', value: 'descent' },
  { translationKey: 'electronic', value: 'electronic' },
  { translationKey: 'fanfare', value: 'fanfare' },
  { translationKey: 'glass', value: 'glass' },
  { translationKey: 'gotosleep', value: 'gotosleep' },
  { translationKey: 'healthnotification', value: 'healthnotification' },
  { translationKey: 'horn', value: 'horn' },
  { translationKey: 'ladder', value: 'ladder' },
  { translationKey: 'mailsent', value: 'mailsent' },
  { translationKey: 'minuet', value: 'minuet' },
  { translationKey: 'multiwayinvitation', value: 'multiwayinvitation' },
  { translationKey: 'newmail', value: 'newmail' },
  { translationKey: 'newsflash', value: 'newsflash' },
  { translationKey: 'noir', value: 'noir' },
  { translationKey: 'paymentsuccess', value: 'paymentsuccess' },
  { translationKey: 'shake', value: 'shake' },
  { translationKey: 'sherwoodforest', value: 'sherwoodforest' },
  { translationKey: 'silence', value: 'silence' },
  { translationKey: 'spell', value: 'spell' },
  { translationKey: 'suspense', value: 'suspense' },
  { translationKey: 'telegraph', value: 'telegraph' },
  { translationKey: 'tiptoes', value: 'tiptoes' },
  { translationKey: 'typewriters', value: 'typewriters' },
  { translationKey: 'update', value: 'update' },
] as const;

export const BARK_SOUND_VALUES = BARK_SOUND_OPTIONS.map((option) => option.value);

export function normalizeChannel<T extends AdminHookChannel>(channel: T): T {
  return {
    ...channel,
    events: channel.events.filter((event) => HOOK_EVENTS.includes(event)),
  };
}

export function normalizeChannels(channels: AdminHookChannel[]) {
  return channels.map(normalizeChannel);
}
