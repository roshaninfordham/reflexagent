import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reflex — Autonomous Pharmacovigilance Agent',
  description:
    "Reflex is an always-on agent swarm that turns FDA drug recalls into verified, cited, routed operational deliverables — in seconds, not weeks.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
