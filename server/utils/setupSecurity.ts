import type { NotificationConfig, SecurityConfig } from '../types/config';

const MASKED_GENERATED_SECRET = '***generated***';

export function buildSetupGeneratedKeysResponse(
  securityConfig: SecurityConfig | null,
  notificationConfig: NotificationConfig | null
) {
  return {
    jwtSecret: securityConfig?.jwtSecret ? MASKED_GENERATED_SECRET : '',
    jwtRefreshSecret: securityConfig?.jwtRefreshSecret ? MASKED_GENERATED_SECRET : '',
    sessionSecret: securityConfig?.sessionSecret ? MASKED_GENERATED_SECRET : '',
    vapidPublicKey: notificationConfig?.vapidPublicKey || '',
    vapidPrivateKey: notificationConfig?.vapidPrivateKey ? MASKED_GENERATED_SECRET : '',
  };
}
