import type { Metadata, Viewport } from 'next';
import Script from 'next/script';

import { AppShell } from '@/components/AppShell';
import { AppStoreProvider } from '@/data/store';

import './globals.css';

export const metadata: Metadata = {
  title: 'Nexus Assistent',
  description: 'Persönlicher Assistent für NEXUS und den Zulassungsdienst',
  applicationName: 'Nexus Assistent',
  appleWebApp: { capable: true, title: 'Nexus', statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png', icon: '/icons/icon-192.png' },
  formatDetection: { telephone: false },
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
};

const registerServiceWorker = `(function () {
  if (!('serviceWorker' in navigator)) return;
  var register = function () { navigator.serviceWorker.register('/sw.js').catch(function (err) { console.error('Service Worker konnte nicht registriert werden:', err); }); };
  if (document.readyState === 'complete') register(); else window.addEventListener('load', register, { once: true });
})();`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="de">
      <body>
        <AppStoreProvider>
          <AppShell>{children}</AppShell>
        </AppStoreProvider>
        {process.env.NODE_ENV === 'production' && (
          <Script id="sw-register" strategy="afterInteractive">{registerServiceWorker}</Script>
        )}
      </body>
    </html>
  );
}
