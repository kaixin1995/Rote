import { AppStoreIcon } from '@/components/icons/Apple';
import { Server, Split, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeatureGridSection, type LandingFeature } from './FeatureGridSection';

export function AndMoreSection() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const features: LandingFeature[] = [
    {
      icon: Server,
      title: t('andMore.features.selfHosted.title'),
      description: t('andMore.features.selfHosted.description'),
    },
    {
      icon: Wrench,
      title: t('andMore.features.tools.title'),
      description: t('andMore.features.tools.description'),
    },
    {
      icon: Split,
      title: t('andMore.features.architecture.title'),
      description: t('andMore.features.architecture.description'),
    },
    {
      icon: AppStoreIcon,
      title: t('andMore.features.iosClient.title'),
      description: t('andMore.features.iosClient.description'),
    },
  ];

  return (
    <FeatureGridSection
      tagline={t('andMore.tagline')}
      title={t('andMore.title')}
      subtitle={t('andMore.subtitle')}
      features={features}
    />
  );
}
