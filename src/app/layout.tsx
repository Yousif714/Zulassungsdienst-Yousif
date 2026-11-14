import type { Metadata, Viewport } from 'next';
import Script from 'next/script';

import { RootChrome } from '@/components/RootChrome';
import { registerServiceWorkerScript } from '@/components/sw-register-script';

import './globals.css';
import './motion.css';
import './messages.css';

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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="de">
      <body>
        <RootChrome>{children}</RootChrome>
        {process.env.NODE_ENV === 'production' && (
          <Script id="sw-register" strategy="afterInteractive">{registerServiceWorkerScript}</Script>
        )}
      </body>
    </html>
  );
}
