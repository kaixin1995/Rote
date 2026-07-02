import { BookOpen, Code, Shield, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FeatureGridSection, type LandingFeature } from './FeatureGridSection';

export function CoreFeaturesSection() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const features: LandingFeature[] = [
    {
      icon: BookOpen,
      title: t('coreFeatures.features.restraint.title'),
      description: t('coreFeatures.features.restraint.description'),
    },
    {
      icon: Sparkles,
      title: t('coreFeatures.features.simple.title'),
      description: t('coreFeatures.features.simple.description'),
    },
    {
      icon: Code,
      title: t('coreFeatures.features.openApi.title'),
      description: t('coreFeatures.features.openApi.description'),
    },
    {
      icon: Shield,
      title: t('coreFeatures.features.freedom.title'),
      description: t('coreFeatures.features.freedom.description'),
    },
  ];

  return (
    <FeatureGridSection
      tagline={t('coreFeatures.tagline')}
      title={t('coreFeatures.title')}
      subtitle={t('coreFeatures.subtitle')}
      features={features}
    />
  );
}
