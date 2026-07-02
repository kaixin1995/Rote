import { SlidingNumber } from '@/components/animate-ui/text/sliding-number';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTimeAgo } from '@/utils/main';
import { Eye, GitFork, MessageCircleQuestionIcon, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

type GithubRepoData = {
  forks_count?: number;
  open_issues_count?: number;
  pushed_at?: string;
  stargazers_count?: number;
  watchers_count?: number;
};

function getTimeColor(pushedAt: string) {
  const now = new Date();
  const pushDate = new Date(pushedAt);
  const diffInDays = Math.floor((now.getTime() - pushDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffInDays <= 7) return 'text-green-600';
  if (diffInDays <= 30) return 'text-yellow-600';
  if (diffInDays <= 365) return 'text-orange-600';
  return 'text-red-600';
}

export function GithubStatsSection() {
  const { t } = useTranslation('translation', { keyPrefix: 'pages.landing' });
  const { data: roteGithubData, isLoading } = useSWR<GithubRepoData>(
    'https://api.github.com/repos/rabithua/rote',
    (url: string) => fetch(url).then((res) => res.json())
  );
  const dataRender = [
    {
      key: 'stargazers_count' as const,
      icon: <Star className="size-4" />,
      title: t('star'),
    },
    {
      key: 'forks_count' as const,
      icon: <GitFork className="size-4" />,
      title: t('fork'),
    },
    {
      key: 'open_issues_count' as const,
      icon: <MessageCircleQuestionIcon className="size-4" />,
      title: t('issues'),
    },
    {
      key: 'watchers_count' as const,
      icon: <Eye className="size-4" />,
      title: t('watch'),
    },
  ];

  return (
    <div className="bg-background divide-y border-x sm:mx-4">
      <div className="space-y-2 divide-y-[0.5px] p-2">
        <p className="text-theme/20 pb-2 font-mono text-xs font-light uppercase">
          {t('construction.tagline')}
        </p>
        <h2 className="text-3xl font-bold">{t('construction.title')}</h2>
        <p className="text-info text-lg font-light">{t('construction.subtitle')}</p>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2 p-2">
          <div className="flex gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="flex items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <div className="flex items-center gap-1">
                  <Skeleton className="h-4 w-8" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
            ))}
          </div>
          <Skeleton className="h-3 w-32" />
        </div>
      ) : (
        <div className="flex flex-col gap-2 divide-y-[0.5px] p-2">
          <div className="flex flex-wrap gap-2 pb-2 text-sm font-thin">
            {dataRender.map((item) => (
              <div key={item.key} className="flex items-center gap-2">
                {item.icon}
                <div className="flex items-center gap-1 text-sm">
                  <SlidingNumber number={roteGithubData?.[item.key] || 0} /> {item.title}
                </div>
              </div>
            ))}
          </div>
          {roteGithubData?.pushed_at && (
            <div className={`text-xs opacity-40 ${getTimeColor(roteGithubData.pushed_at)}`}>
              {t('lastPushTime')}
              {formatTimeAgo(roteGithubData.pushed_at)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
