import type { ElementType } from 'react';

export type LandingFeature = {
  description: string;
  icon: ElementType<{ className?: string }>;
  title: string;
};

type FeatureGridSectionProps = {
  features: LandingFeature[];
  subtitle: string;
  tagline: string;
  title: string;
};

export function FeatureGridSection({
  features,
  subtitle,
  tagline,
  title,
}: FeatureGridSectionProps) {
  return (
    <div className="bg-background divide-y border-x sm:mx-4">
      <div className="space-y-2 divide-y-[0.5px] p-2">
        <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">{tagline}</p>
        <h2 className="text-3xl font-bold">{title}</h2>
        <p className="text-info text-lg font-light">{subtitle}</p>
      </div>

      <div className="gap-6 p-2 md:grid md:grid-cols-2">
        {features.map((feature) => (
          <div key={feature.title}>
            <div className="hover:bg-accent/5 group flex flex-row items-start gap-6 py-8 transition-all duration-300">
              <div className="border-theme bg-theme/10 group-hover:bg-theme/20 flex size-16 shrink-0 items-center justify-center rounded-md border-[0.5px] border-dashed transition-all duration-300">
                <feature.icon className="text-theme size-8" />
              </div>

              <div className="flex-1">
                <h3 className="mb-3 text-xl font-semibold">{feature.title}</h3>
                <p className="text-info leading-relaxed font-light">{feature.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
