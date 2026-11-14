'use client';

import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { AppShell } from '@/components/AppShell';
import { ModeProvider } from '@/data/mode';
import { AppStoreProvider } from '@/data/store';

function AppChrome({ children }: { children: ReactNode }) {
  return (
    <ModeProvider>
      <AppStoreProvider>
        <AppShell>{children}</AppShell>
      </AppStoreProvider>
    </ModeProvider>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/zahlung' || pathname.startsWith('/zahlung/')) return <>{children}</>;
  return <AppChrome>{children}</AppChrome>;
}

/**
 * Öffentliche Zahlungsseiten (`/zahlung…`) ohne App-Provider und Shell; alles andere wie bisher.
 * Der Pfad ist erst zur Laufzeit bekannt (Suspense nötig); der Platzhalter ist der App-Rahmen, damit sich für App-Seiten nichts ändert.
 * Folge: Die Antwort startet als Stream, der HTTP-Status der Zahlungsseite bleibt 200 (notFound setzt nur noindex).
 */
export function RootChrome({ children }: { children: ReactNode }) {
  return <Suspense fallback={<AppChrome>{children}</AppChrome>}><Chrome>{children}</Chrome></Suspense>;
}
