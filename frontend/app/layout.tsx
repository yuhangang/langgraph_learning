import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LangGraph Control Center',
  description: 'Send queries, stream responses, and run LangGraph pipelines.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
