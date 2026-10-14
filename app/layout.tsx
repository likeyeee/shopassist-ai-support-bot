import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ShopAssist — Support workspace',
  description: 'AI customer support with cited answers, a knowledge base, and a human inbox.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
