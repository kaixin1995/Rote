import type {
  AdminHookChannel,
  AdminHookEvent,
  AdminHooksConfig,
  NotificationConfig,
} from '../../types/config';
import { normalizeUrlBase, validateHttpUrl } from './network';
import { ADMIN_HOOK_EVENTS, DEFAULT_BARK_SERVER_URL } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateEvents(events: unknown): AdminHookEvent[] {
  if (!Array.isArray(events)) {
    throw new Error('Hook channel events must be an array');
  }
  const uniqueEvents = [...new Set(events)];
  uniqueEvents.forEach((event) => {
    if (!ADMIN_HOOK_EVENTS.includes(event as AdminHookEvent)) {
      throw new Error(`Unsupported hook event: ${String(event)}`);
    }
  });
  return uniqueEvents as AdminHookEvent[];
}

export function validateAdminHookChannel(channel: unknown): AdminHookChannel {
  if (!isRecord(channel)) {
    throw new Error('Hook channel must be an object');
  }
  const type = channel.type;
  if (type !== 'bark' && type !== 'http' && type !== 'admin_pwa') {
    throw new Error('Unsupported hook channel type');
  }
  const id = typeof channel.id === 'string' ? channel.id.trim() : '';
  const name = typeof channel.name === 'string' ? channel.name.trim() : '';
  if (!id) throw new Error('Hook channel id is required');
  if (!name) throw new Error('Hook channel name is required');

  const base = {
    id,
    name,
    enabled: channel.enabled !== false,
    events: validateEvents(channel.events),
  };

  if (type === 'bark') {
    const key = typeof channel.key === 'string' ? channel.key.trim() : '';
    const serverUrl =
      typeof channel.serverUrl === 'string' && channel.serverUrl.trim()
        ? channel.serverUrl.trim()
        : DEFAULT_BARK_SERVER_URL;
    if (!key) throw new Error('Bark key is required');
    validateHttpUrl(serverUrl, 'Bark server URL');
    return {
      ...base,
      type,
      key,
      serverUrl: normalizeUrlBase(serverUrl),
      group: typeof channel.group === 'string' ? channel.group.trim() : undefined,
      icon: typeof channel.icon === 'string' ? channel.icon.trim() : undefined,
      sound: typeof channel.sound === 'string' ? channel.sound.trim() : undefined,
    };
  }

  if (type === 'http') {
    const url = typeof channel.url === 'string' ? channel.url.trim() : '';
    if (!url) throw new Error('HTTP hook URL is required');
    validateHttpUrl(url, 'HTTP hook URL');

    let headers: Record<string, string> | undefined;
    if (channel.headers !== undefined) {
      if (!isRecord(channel.headers)) {
        throw new Error('HTTP hook headers must be an object');
      }
      headers = {};
      Object.entries(channel.headers).forEach(([key, value]) => {
        if (typeof value !== 'string') {
          throw new Error('HTTP hook header values must be strings');
        }
        if (key.trim()) headers![key.trim()] = value;
      });
    }

    return {
      ...base,
      type,
      url,
      headers,
    };
  }

  return {
    ...base,
    type,
  };
}

export function validateNotificationConfig(config: NotificationConfig): NotificationConfig {
  if (!config.adminHooks) return config;

  const adminHooks = config.adminHooks as AdminHooksConfig;
  if (!Array.isArray(adminHooks.channels)) {
    throw new Error('Admin hook channels must be an array');
  }

  const seenIds = new Set<string>();
  const channels = adminHooks.channels.map((channel) => {
    const normalized = validateAdminHookChannel(channel);
    if (seenIds.has(normalized.id)) {
      throw new Error(`Duplicate hook channel id: ${normalized.id}`);
    }
    seenIds.add(normalized.id);
    return normalized;
  });

  return {
    ...config,
    adminHooks: {
      enabled: adminHooks.enabled === true,
      channels,
    },
  };
}
