import { Button } from '@/components/ui/button';
import { Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type PasskeySetupPromptProps = {
  isRegistering: boolean;
  onSetup: () => Promise<void>;
  onSkip: () => void;
};

export function PasskeySetupPrompt({ isRegistering, onSetup, onSkip }: PasskeySetupPromptProps) {
  const { t } = useTranslation('translation', {
    keyPrefix: 'pages.login',
  });

  return (
    <div className="bg-muted w-full rounded-lg p-6 text-center">
      <Fingerprint className="mx-auto mb-4 size-12" />
      <h2 className="mb-2 text-lg font-semibold">{t('passkey.promptTitle')}</h2>
      <p className="text-muted-foreground mb-6 text-sm">{t('passkey.promptDescription')}</p>
      <div className="space-y-2">
        <Button onClick={onSetup} disabled={isRegistering} className="w-full">
          {isRegistering ? t('passkey.settingUp') : t('passkey.setup')}
        </Button>
        <Button variant="ghost" onClick={onSkip} className="w-full">
          {t('passkey.skip')}
        </Button>
      </div>
    </div>
  );
}
