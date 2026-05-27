import { AppleIcon } from '@/components/icons/Apple';
import { API_URL } from '@/utils/api';
import { Rss } from 'lucide-react';

type UserSidebarLinksProps = {
  username?: string;
  appLabel: string;
};

export default function UserSidebarLinks({ username, appLabel }: UserSidebarLinksProps) {
  return (
    <div className="flex flex-col divide-y border-b">
      <div className="grid grid-cols-3 divide-x">
        <a
          href={`${API_URL}/rss/${username ?? ''}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-foreground/3 flex cursor-pointer items-center justify-center gap-2 py-4"
        >
          <Rss className="size-5" />
          <div className="text-xl">RSS</div>
        </a>
        <div className="flex items-center justify-center gap-2 py-4">
          <div className="text-xl">☝️</div>
        </div>
        <div className="flex items-center justify-center gap-2 py-4">
          <div className="text-xl">🤓</div>
        </div>
      </div>
      <a
        href="https://apps.apple.com/app/rote/id6755513897"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:bg-foreground/5 flex cursor-pointer items-center justify-center gap-2 py-4 duration-200"
      >
        <AppleIcon className="size-5" />
        <div className="text-xl">{appLabel}</div>
      </a>
    </div>
  );
}
