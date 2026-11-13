'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AssistantButton } from './AssistantButton';
import { ModeBadge } from './ModeBadge';
import { PullToRefresh } from './PullToRefresh';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';

/** App-Rahmen: Modus-Etikett, Tab-Leiste mobil, Seitenleiste ab 768px, Assistenten-Knopf (außer im Chat selbst). */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PullToRefresh />
      <Sidebar />
      <main className="shell-main">
        <div className="shell-content"><ModeBadge />{children}</div>
        {/* Schwebt fixiert; steht im main, damit er in einem Landmark liegt. */}
        {pathname !== '/chat' && pathname !== '/assistent' && <AssistantButton />}
      </main>
      <TabBar />
    </>
  );
}
