import type { LucideIcon } from 'lucide-react';
import type { RefObject } from 'react';

type AiMemoryFeature = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type AiMemoryFeatureListProps = {
  featureListRef: RefObject<HTMLDivElement | null>;
  features: AiMemoryFeature[];
};

export function AiMemoryFeatureList({ featureListRef, features }: AiMemoryFeatureListProps) {
  return (
    <div ref={featureListRef} className="divide-y-[0.5px] self-start px-2">
      {features.map((feature) => (
        <div
          key={feature.title}
          className="hover:bg-accent/5 group flex flex-row items-start gap-5 py-6 transition-all duration-300"
        >
          <div className="border-theme bg-theme/10 group-hover:bg-theme/20 flex size-12 shrink-0 items-center justify-center rounded-md border-[0.5px] border-dashed transition-all duration-300">
            <feature.icon className="text-theme size-6" />
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
            <p className="text-info leading-relaxed font-light">{feature.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
