import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

export default function ErrorPage() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.error' });
  const navigate = useNavigate();
  const location = useLocation();

  function back() {
    if (location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/home');
    }
  }

  return (
    <>
      <main className="bg-background flex h-dvh place-items-center items-center justify-center px-6">
        <div className="flex flex-col gap-2">
          <p className="text-primary bg-black bg-clip-text font-mono text-[100px] font-semibold lg:text-[200px] dark:text-white">
            40X
          </p>
          <h1 className="text-primary/90 text-base font-bold tracking-tight lg:text-2xl dark:text-white/90">
            {t('pageNotFound')}
          </h1>
          <p className="text-primary/50 text-xs font-light dark:text-white/50">
            {t('pageNotFoundDesc')}
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={back}>
              {t('back')}
            </Button>
            <Button onClick={() => navigate('/')}>{t('goHome')}</Button>
          </div>
        </div>
      </main>
    </>
  );
}
