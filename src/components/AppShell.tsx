'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { AssistantButton } from './AssistantButton';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';

/** App-Rahmen: Tab-Leiste mobil, Seitenleiste ab 768px, Assistenten-Knopf (außer im Chat selbst). */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <Sidebar />
      <main className="shell-main">
        <div className="shell-content">{children}</div>
        {/* Schwebt fixiert; steht im main, damit er in einem Landmark liegt. */}
        {pathname !== '/chat' && pathname !== '/assistent' && <AssistantButton />}
      </main>
      <TabBar />
    </>
  );
}
