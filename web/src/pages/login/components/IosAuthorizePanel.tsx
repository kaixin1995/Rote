import Logo from '@/components/others/logo';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import type { LoginProfile } from '../types';

type IosAuthorizePanelProps = {
  profile: LoginProfile;
  onAuthorize: () => void;
  onSwitchAccount: () => void;
};

export function IosAuthorizePanel({
  profile,
  onAuthorize,
  onSwitchAccount,
}: IosAuthorizePanelProps) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'pages.login',
  });

  return (
    <>
      <div className="mb-4">
        <Logo className="w-32" color="#3ECF4A" />
      </div>
      <div className="bg-muted/50 w-full rounded-lg p-6">
        <h2 className="mb-4 text-lg"> {t('authorize.title')}</h2>
        <p className="mb-6 text-sm font-light">
          {t('authorize.message', {
            username: profile.nickname || profile.username,
          })}
        </p>
        <Button onClick={onAuthorize} className="w-full">
          {t('authorize.button')}
        </Button>
        <Button variant="ghost" onClick={onSwitchAccount} className="mt-2 w-full">
          {t('authorize.switchAccount')}
        </Button>
      </div>
    </>
  );
}
