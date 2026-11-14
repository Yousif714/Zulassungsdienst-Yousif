import type { Metadata } from 'next';
import '../zahlung.css';

export const metadata: Metadata = { title: 'NEXUS – Danke', robots: { index: false, follow: false } };

export default function DankePage() {
  return (
    <main className="pay-page">
      <p>Danke! Dein Zahlungsmittel ist hinterlegt. Die Raten werden ab jetzt automatisch abgebucht. Bitte lösche deinen Dauerauftrag für NEXUS.</p>
    </main>
  );
}
