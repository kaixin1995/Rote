import { TypingText } from '@/components/animate-ui/text/typing';
import Logo from '@/components/others/logo';
import { useTranslation } from 'react-i18next';
import type { LoginData, OAuthProviders, RegisterData } from '../types';
import { AuthTabs } from './AuthTabs';
import { PasskeySetupPrompt } from './PasskeySetupPrompt';

type StandardLoginPanelProps = {
  activeTab: string;
  allowRegistration: boolean;
  backendStatusOk?: unknown;
  disabled: boolean;
  isAuthenticating: boolean;
  isRegistering: boolean;
  loginData: LoginData;
  oauthProviders?: OAuthProviders;
  passkeyEnabled: boolean;
  registerData: RegisterData;
  showPasskeyPrompt: boolean;
  onActiveTabChange: (value: string) => void;
  onLogin: () => void;
  onLoginFieldChange: (key: keyof LoginData, value: string) => void;
  onOAuthLogin: (provider: string) => void;
  onPasskeyLogin: () => Promise<void>;
  onRegister: () => void;
  onRegisterFieldChange: (key: keyof RegisterData, value: string) => void;
  onSetupPasskey: () => Promise<void>;
  onSkipPasskey: () => void;
};

export function StandardLoginPanel({
  activeTab,
  allowRegistration,
  backendStatusOk,
  disabled,
  isAuthenticating,
  isRegistering,
  loginData,
  oauthProviders,
  passkeyEnabled,
  registerData,
  showPasskeyPrompt,
  onActiveTabChange,
  onLogin,
  onLoginFieldChange,
  onOAuthLogin,
  onPasskeyLogin,
  onRegister,
  onRegisterFieldChange,
  onSetupPasskey,
  onSkipPasskey,
}: StandardLoginPanelProps) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'pages.login',
  });

  return (
    <>
      <div className="mb-4">
        <Logo className="w-32" color="#3ECF4A" />
      </div>

      {backendStatusOk ? (
        showPasskeyPrompt ? (
          <PasskeySetupPrompt
            isRegistering={isRegistering}
            onSetup={onSetupPasskey}
            onSkip={onSkipPasskey}
          />
        ) : (
          <AuthTabs
            activeTab={activeTab}
            allowRegistration={allowRegistration}
            disabled={disabled}
            isAuthenticating={isAuthenticating}
            loginData={loginData}
            oauthProviders={oauthProviders}
            passkeyEnabled={passkeyEnabled}
            registerData={registerData}
            onActiveTabChange={onActiveTabChange}
            onLogin={onLogin}
            onLoginFieldChange={onLoginFieldChange}
            onOAuthLogin={onOAuthLogin}
            onPasskeyLogin={onPasskeyLogin}
            onRegister={onRegister}
            onRegisterFieldChange={onRegisterFieldChange}
          />
        )
      ) : (
        <div>
          <div className=" ">{t('error.backendIssue')}</div>
          <div>{JSON.stringify(backendStatusOk)}</div>
          <TypingText className="text-sm opacity-60" text={t('error.dockerDeployment')} />
        </div>
      )}
    </>
  );
}
