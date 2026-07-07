import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LegacyMind — verification dashboard",
  description:
    "Per-module certification status, coverage envelopes, and downloadable verification evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-100 font-sans text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
