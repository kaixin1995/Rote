import {
  Tabs,
  TabsContent,
  TabsContents,
  TabsList,
  TabsTrigger,
} from '@/components/animate-ui/radix/tabs';
import { AppleIcon } from '@/components/icons/Apple';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Fingerprint, Github } from 'lucide-react';
import type { ComponentProps, ComponentType, KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { LoginData, OAuthProviders, RegisterData } from '../types';

type IconComponent = ComponentType<ComponentProps<'svg'>>;

type AuthTabsProps = {
  activeTab: string;
  allowRegistration: boolean;
  disabled: boolean;
  isAuthenticating: boolean;
  loginData: LoginData;
  oauthProviders?: OAuthProviders;
  passkeyEnabled: boolean;
  registerData: RegisterData;
  onActiveTabChange: (value: string) => void;
  onLogin: () => void;
  onLoginFieldChange: (key: keyof LoginData, value: string) => void;
  onOAuthLogin: (provider: string) => void;
  onPasskeyLogin: () => Promise<void>;
  onRegister: () => void;
  onRegisterFieldChange: (key: keyof RegisterData, value: string) => void;
};

function getOAuthProviderInfo(provider: string): { icon: IconComponent | null; labelKey: string } {
  const providerInfo: Record<string, { icon: IconComponent; labelKey: string }> = {
    github: {
      icon: Github,
      labelKey: 'buttons.loginWithGitHub',
    },
    apple: {
      icon: AppleIcon,
      labelKey: 'buttons.loginWithApple',
    },
  };

  return (
    providerInfo[provider] || {
      icon: null,
      labelKey: `buttons.loginWith${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
    }
  );
}

export function AuthTabs({
  activeTab,
  allowRegistration,
  disabled,
  isAuthenticating,
  loginData,
  oauthProviders,
  passkeyEnabled,
  registerData,
  onActiveTabChange,
  onLogin,
  onLoginFieldChange,
  onOAuthLogin,
  onPasskeyLogin,
  onRegister,
  onRegisterFieldChange,
}: AuthTabsProps) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'pages.login',
  });

  const hasEnabledOAuthProviders =
    oauthProviders && Object.values(oauthProviders).some((provider) => provider?.enabled);

  function handleLoginKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      onLogin();
    }
  }

  function handleRegisterKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      onRegister();
    }
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={onActiveTabChange}
      className="bg-muted w-full rounded-lg"
    >
      <TabsList className={`grid w-full ${allowRegistration ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <TabsTrigger value="login">{t('buttons.login')}</TabsTrigger>
        {allowRegistration && <TabsTrigger value="register">{t('buttons.register')}</TabsTrigger>}
      </TabsList>

      <TabsContents className="bg-background mx-1 -mt-2 mb-1 h-full rounded-sm">
        <div className="space-y-4 p-4">
          <TabsContent value="login" className="space-y-4 py-4">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="login-username">{t('fields.usernameOrEmail')}</Label>
                <Input
                  id="login-username"
                  placeholder={t('fields.usernameOrEmailPlaceholder')}
                  className="text-md rounded-md font-mono"
                  maxLength={255}
                  value={loginData.username}
                  onInput={(e) =>
                    onLoginFieldChange('username', (e.target as HTMLInputElement).value)
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">{t('fields.password')}</Label>
                <Input
                  id="login-password"
                  placeholder="password"
                  type="password"
                  className="text-md rounded-md font-mono"
                  maxLength={30}
                  value={loginData.password}
                  onInput={(e) =>
                    onLoginFieldChange('password', (e.target as HTMLInputElement).value)
                  }
                  onKeyDown={handleLoginKeyDown}
                />
              </div>
            </div>
            <Button disabled={disabled} onClick={onLogin} className="w-full">
              {disabled ? t('messages.loggingIn') : t('buttons.login')}
            </Button>
            {passkeyEnabled && (
              <Button
                variant="outline"
                disabled={disabled || isAuthenticating}
                onClick={onPasskeyLogin}
                className="w-full"
              >
                <Fingerprint className="mr-2 size-4" />
                {isAuthenticating ? t('messages.loggingIn') : t('passkey.loginWithPasskey')}
              </Button>
            )}
            {hasEnabledOAuthProviders && (
              <>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background text-muted-foreground px-2">
                      {t('oauth.or')}
                    </span>
                  </div>
                </div>
                {Object.entries(oauthProviders).map(([provider, config]) => {
                  if (!config?.enabled) return null;
                  const providerInfo = getOAuthProviderInfo(provider);
                  const ProviderIcon = providerInfo.icon;
                  return (
                    <Button
                      key={provider}
                      type="button"
                      variant="outline"
                      onClick={() => onOAuthLogin(provider)}
                      className="w-full"
                      disabled={disabled}
                    >
                      {ProviderIcon && <ProviderIcon className="mr-2 size-4" />}
                      {t(providerInfo.labelKey)}
                    </Button>
                  );
                })}
              </>
            )}
          </TabsContent>

          {allowRegistration && (
            <TabsContent value="register" className="space-y-4 py-4">
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="register-username">{t('fields.username')}</Label>
                  <Input
                    id="register-username"
                    placeholder={t('fields.usernamePlaceholder')}
                    className="text-md rounded-md font-mono"
                    maxLength={20}
                    value={registerData.username}
                    onInput={(e) =>
                      onRegisterFieldChange('username', (e.target as HTMLInputElement).value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">{t('fields.email')}</Label>
                  <Input
                    id="register-email"
                    placeholder={t('fields.emailPlaceholder')}
                    className="text-md rounded-md font-mono"
                    maxLength={30}
                    value={registerData.email}
                    onInput={(e) =>
                      onRegisterFieldChange('email', (e.target as HTMLInputElement).value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-nickname">{t('fields.nickname')}</Label>
                  <Input
                    id="register-nickname"
                    placeholder={t('fields.nicknamePlaceholder')}
                    className="text-md rounded-md font-mono"
                    maxLength={20}
                    value={registerData.nickname}
                    onInput={(e) =>
                      onRegisterFieldChange('nickname', (e.target as HTMLInputElement).value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">{t('fields.password')}</Label>
                  <Input
                    id="register-password"
                    placeholder={t('fields.passwordOptional')}
                    type="password"
                    className="text-md rounded-md font-mono"
                    maxLength={30}
                    value={registerData.password}
                    onInput={(e) =>
                      onRegisterFieldChange('password', (e.target as HTMLInputElement).value)
                    }
                    onKeyDown={handleRegisterKeyDown}
                  />
                  {passkeyEnabled && (
                    <p className="text-muted-foreground text-xs">
                      {t('passkey.passwordOptionalHint')}
                    </p>
                  )}
                </div>
              </div>
              <Button disabled={disabled} onClick={onRegister} className="w-full">
                {disabled ? t('messages.registering') : t('buttons.register')}
              </Button>
            </TabsContent>
          )}

          <div className="my-4 flex cursor-pointer items-center justify-center gap-1 text-sm duration-300 active:scale-95">
            <Link to="/explore">
              <div className="duration-300 hover:opacity-60">{t('nav.explore')}</div>
            </Link>
            <span className="px-2">/</span>
            <Link to="/landing">
              <div className="duration-300 hover:opacity-60">{t('nav.home')}</div>
            </Link>
          </div>
        </div>
      </TabsContents>
    </Tabs>
  );
}
