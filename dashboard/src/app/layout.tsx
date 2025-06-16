import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import LayoutClientShell from "@/components/layout/LayoutClientShell";

const geistSans = GeistSans;
const geistMono = GeistMono;
const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sova Intel - Solana Wallet Analyzer",
  description: "Gain deep insights into Solana wallet performance, behavior, and profitability.",
  other: {
    "Content-Security-Policy": "script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className={inter.className}>
        <LayoutClientShell>{children}</LayoutClientShell>
      </body>
    </html>
  );
}
