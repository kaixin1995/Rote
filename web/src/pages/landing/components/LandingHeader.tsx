import LanguageSwitcher from '@/components/others/languageSwitcher';
import Logo from '@/components/others/logo';
import { useTranslation } from 'react-i18next';

export function LandingHeader() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });

  return (
    <div className="bg-background/90 sticky top-0 z-10 w-full px-6 py-4 backdrop-blur-md">
      <div className="flex w-full items-end gap-4">
        <div className="flex shrink-0 justify-center">
          <Logo className="h-6 w-auto opacity-90" color="#3ECF4A" />
        </div>

        <div className="flex min-w-0 flex-1 gap-2">
          <span className="text-info truncate text-sm font-light tracking-wide" title={t('poem')}>
            {t('poem')}
          </span>
        </div>

        <LanguageSwitcher className="ml-auto shrink-0" />
      </div>
    </div>
  );
}
