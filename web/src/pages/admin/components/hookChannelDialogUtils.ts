import type { AdminHookChannel, AdminHookEvent } from '../types';
import {
  BARK_SOUND_OPTIONS,
  BARK_SOUND_VALUES,
  DEFAULT_EVENT_SELECTION,
} from './hookChannelConfig';

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultChannel(
  type: AdminHookChannel['type'],
  name: string
): AdminHookChannel {
  const base = {
    enabled: true,
    events: DEFAULT_EVENT_SELECTION,
    id: newId(),
    name,
  };
  if (type === 'bark') {
    return { ...base, key: '', serverUrl: 'https://api.day.app', type };
  }
  if (type === 'http') {
    return { ...base, type, url: '' };
  }
  return { ...base, type };
}

export function headersToText(headers?: Record<string, string>) {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

export function parseHeaders(value: string) {
  const headers: Record<string, string> = {};
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separator = line.indexOf(':');
      if (separator <= 0) return;
      const key = line.slice(0, separator).trim();
      const headerValue = line.slice(separator + 1).trim();
      if (key) headers[key] = headerValue;
    });
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function toggleEvent(events: AdminHookEvent[], event: AdminHookEvent, checked: boolean) {
  return checked ? [...new Set([...events, event])] : events.filter((item) => item !== event);
}

export function getBarkSoundOptions(sound?: string) {
  if (!sound || (BARK_SOUND_VALUES as readonly string[]).includes(sound)) {
    return BARK_SOUND_OPTIONS;
  }
  return [{ customLabel: sound, value: sound }, ...BARK_SOUND_OPTIONS];
}
