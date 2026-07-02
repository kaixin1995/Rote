import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AiMemorySection } from './components/AiMemorySection';
import { AndMoreSection } from './components/AndMoreSection';
import { CoreFeaturesSection } from './components/CoreFeaturesSection';
import { GithubStatsSection } from './components/GithubStatsSection';
import { LandingHeader } from './components/LandingHeader';
import { LandingHero } from './components/LandingHero';
import { QuickLinksSection } from './components/QuickLinksSection';

function Landing() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const { isInitialized, isLoading, error } = useSystemStatus();
  const toastShownRef = useRef(false);

  useEffect(() => {
    if (!isLoading && (!isInitialized || error) && !toastShownRef.current) {
      toastShownRef.current = true;
      if (error) {
        toast.error(t('redirectingToSetup.error'));
      } else {
        toast.info(t('redirectingToSetup.notInitialized'));
      }
    }
  }, [isLoading, isInitialized, error, t]);

  if (!isLoading && (!isInitialized || error)) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <div className="bg-pattern min-h-dvh divide-y font-sans">
      <LandingHeader />
      <LandingHero />
      <CoreFeaturesSection />
      <AiMemorySection />
      <AndMoreSection />
      <GithubStatsSection />
      <QuickLinksSection />
    </div>
  );
}

export default Landing;
