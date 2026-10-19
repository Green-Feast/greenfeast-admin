import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GreenFeast Admin",
  description: "Admin dashboard for GreenFeast meal subscription service",
  // Installable (Add to Home Screen) — on iPhone that's what lets alerts
  // arrive as notifications (Alerts page).
  manifest: "/admin.webmanifest",
  appleWebApp: { capable: true, title: "GF Admin", statusBarStyle: "default" },
  icons: { apple: "/admin-apple-icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
