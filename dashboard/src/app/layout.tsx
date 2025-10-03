import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import LayoutClientShell from "@/components/layout/LayoutClientShell";

const geistSans = GeistSans;
const geistMono = GeistMono;
const inter = Inter({ 
  subsets: ["latin"],
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
});

export const metadata: Metadata = {
  title: "Sova Intel - Solana Wallet Analyzer",
  description: "Gain deep insights into Solana wallet performance, behavior, and profitability.",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' }
    ],
    apple: '/favicon.svg',
  },
  other: {
    "Content-Security-Policy": "script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} ${inter.className}`}>
        <LayoutClientShell>
          {children}
        </LayoutClientShell>
      </body>
    </html>
  );
}
