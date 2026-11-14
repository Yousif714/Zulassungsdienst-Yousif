import type { Metadata } from 'next';
import '../zahlung.css';

export const metadata: Metadata = { title: 'NEXUS – Abgebrochen', robots: { index: false, follow: false } };

const TOKEN = /^[0-9a-f]{64}$/;

export default async function AbbruchPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams;
  const token = typeof t === 'string' && TOKEN.test(t) ? t : null;
  return (
    <main className="pay-page">
      <p>Abgebrochen. Es wurde nichts eingerichtet.</p>
      {token && <p><a href={`/zahlung/${token}`}>Erneut versuchen</a></p>}
    </main>
  );
}
