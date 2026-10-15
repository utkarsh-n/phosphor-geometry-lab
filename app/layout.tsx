import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Space Age Orbital Dynamics: Decomposing the Frequencies',
  description:
    'An interactive orbital geometry console. Tune frequencies, explore projected four-dimensional motion, and inspect recorded and forecast paths in a time cylinder and torus.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
