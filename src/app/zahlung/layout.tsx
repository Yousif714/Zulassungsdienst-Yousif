import type { Metadata } from 'next';

/** Öffentliche Zahlungsseiten: neutrale Metadaten, nichts vom internen Werkzeug (keine App-Beschreibung, kein Manifest, keine Web-App-Tags). */
export const metadata: Metadata = {
  title: 'NEXUS – Ratenplan',
  description: null,
  applicationName: null,
  manifest: null,
  appleWebApp: null,
  other: { 'apple-mobile-web-app-capable': '' },
  formatDetection: null,
  icons: null,
  robots: { index: false, follow: false },
};

export default function ZahlungLayout({ children }: LayoutProps<'/zahlung'>) {
  return children;
}
