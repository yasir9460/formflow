import type { Metadata } from "next";
import "./globals.css";
import { AccessGate } from "./access-ui";

export const metadata: Metadata = {
  title: "CCPL FormFlow",
  description: "Controlled form templates, submissions, registers, and audit trails.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased"><AccessGate>{children}</AccessGate></body>
    </html>
  );
}
