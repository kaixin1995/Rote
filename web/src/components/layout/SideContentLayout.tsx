import type { ReactNode } from 'react';

export function SideContentLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative hidden w-72 min-w-0 shrink-0 overflow-hidden md:block">
      <div className="noScrollBar sticky top-0 hidden h-dvh w-full min-w-0 divide-y overflow-x-hidden overflow-y-scroll md:block">
        {children}
      </div>
    </div>
  );
}
