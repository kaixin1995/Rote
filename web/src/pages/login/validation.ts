import { z } from 'zod';

type LoginTranslator = (key: string) => string;

type LoginSiteStatus = {
  frontendConfig?: {
    safeRoutes?: string[];
  };
} | null;

export function createLoginDataSchema(t: LoginTranslator) {
  return z.object({
    username: z
      .string()
      .min(1, t('usernameOrEmailRequired'))
      .superRefine((val, ctx) => {
        if (val.includes('@')) {
          const emailResult = z.string().email().safeParse(val);
          if (!emailResult.success) {
            ctx.addIssue({
              code: 'custom',
              message: t('emailFormat'),
            });
          }
        } else if (val.length > 20) {
          ctx.addIssue({
            code: 'custom',
            message: t('usernameMaxLength'),
          });
        }
      }),
    password: z
      .string()
      .refine((val) => val.length > 0, { message: t('passwordRequired') })
      .refine((val) => val.length >= 6, { message: t('passwordMin') })
      .max(128, t('passwordMaxLength')),
  });
}

export function createRegisterDataSchema({
  t,
  siteStatus,
  passkeyEnabled,
}: {
  t: LoginTranslator;
  siteStatus: LoginSiteStatus;
  passkeyEnabled: boolean;
}) {
  return z.object({
    username: z
      .string()
      .min(1, t('usernameRequired'))
      .max(20, t('usernameMaxLength'))
      .regex(/^[A-Za-z0-9_-]+$/, t('usernameFormat'))
      .refine((value) => !siteStatus?.frontendConfig?.safeRoutes?.includes(value), {
        message: t('usernameConflict'),
      }),
    password: passkeyEnabled
      ? z
          .string()
          .max(128, t('passwordMaxLength'))
          .optional()
          .refine((val) => !val || val.length >= 6, { message: t('passwordMin') })
      : z
          .string()
          .min(1, t('passwordRequired'))
          .refine((val) => val.length >= 6, { message: t('passwordMin') })
          .max(128, t('passwordMaxLength')),
    email: z
      .string()
      .min(1, t('emailRequired'))
      .max(30, t('emailMaxLength'))
      .email(t('emailFormat')),
    nickname: z.string().min(1, t('nicknameRequired')).max(20, t('nicknameMaxLength')),
  });
}

export function getZodErrorMessage(err: any, fallbackMessage: string): string {
  if (Array.isArray(err.issues) && err.issues.length > 0) {
    const firstIssue = err.issues[0];
    if (firstIssue?.message && typeof firstIssue.message === 'string') {
      return firstIssue.message;
    }
  }

  if (err.message && typeof err.message === 'string') {
    try {
      const parsed = JSON.parse(err.message);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.message) {
        return parsed[0].message;
      }
    } catch {
      // Keep the original error message fallback below.
    }

    if (err.message.length > 0) {
      return err.message;
    }
  }

  return fallbackMessage || 'Validation failed';
}
