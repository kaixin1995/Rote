import { Button } from '@/components/ui/button';
import { useSiteStatus } from '@/hooks/useSiteStatus';
import { cn } from '@/utils/cn';
import { ArrowUpRight, Github, Globe2, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

export function QuickLinksSection() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const { data: siteStatus } = useSiteStatus();
  const quickLinks = [
    {
      name: t('quickLinks.selfHosted'),
      href: '/doc/selfhosted',
      icon: <Server className="size-5 transition-transform" />,
      external: false,
    },
    {
      name: t('quickLinks.github'),
      href: 'https://github.com/Rabithua/Rote',
      icon: <Github className="size-5 transition-transform" />,
      external: true,
    },
    {
      name: t('quickLinks.explore'),
      href: '/explore',
      icon: <Globe2 className="size-5 transition-transform" />,
      external: false,
    },
    {
      name: t('quickLinks.rabithua'),
      href: 'https://rote.ink/rabithua',
      icon: (
        <img
          src="https://avatars.githubusercontent.com/u/34543831?v=4&size=64"
          alt="Rabithua"
          className="size-6 rounded-full border"
        />
      ),
      external: true,
    },
  ];

  return (
    <div className="bg-background/80 divide-y-[0.5px] p-2 backdrop:blur-xl sm:p-6">
      <div className="space-y-2 divide-y-[0.5px]">
        <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
          {t('exploreMore.tagline')}
        </p>
        <h3 className="text-3xl font-bold">{t('exploreMore.title')}</h3>
        <p className="text-info text-lg font-light">{t('exploreMore.subtitle')}</p>
      </div>

      <div className="flex flex-row flex-wrap items-center gap-4 py-8">
        {quickLinks.map((link) => (
          <div key={link.name} className="group">
            <Button variant={link.external ? 'outline' : 'default'} asChild>
              <Link
                to={link.href}
                target={link.external ? '_blank' : undefined}
                rel={link.external ? 'noopener noreferrer' : undefined}
                className={cn(
                  'flex items-center justify-center gap-3 py-3',
                  link.external
                    ? 'text-foreground hover:text-foreground'
                    : 'text-background hover:text-background'
                )}
              >
                {link.icon}
                <span className="font-medium">{link.name}</span>
                {link.external && <ArrowUpRight className="inline-block size-5" />}
              </Link>
            </Button>
          </div>
        ))}
      </div>

      {siteStatus?.site?.icpRecord && (
        <div className="bg-background/60 border-muted/20 border-t py-4">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs"
          >
            {siteStatus.site.icpRecord}
          </a>
          <ArrowUpRight className="inline-block size-3" />
        </div>
      )}
    </div>
  );
}
