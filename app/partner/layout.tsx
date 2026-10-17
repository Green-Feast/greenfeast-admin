import type { Metadata, Viewport } from "next";

// The delivery partner app: phone-first, installable ("Add to Home screen"
// opens it full screen). Its own session — see lib/partner-cookie.ts.
export const metadata: Metadata = {
  title: "GreenFeast Partner",
  description: "Your GreenFeast delivery batches, stops and map.",
  manifest: "/partner.webmanifest",
  appleWebApp: { capable: true, title: "GF Partner", statusBarStyle: "default" },
  icons: { icon: "/partner-icon-192.png", apple: "/partner-apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1B5E20",
  width: "device-width",
  initialScale: 1,
};

export default function PartnerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F9FBF7] text-[#1A1A1A]">
      <div className="mx-auto max-w-md min-h-screen">{children}</div>
    </div>
  );
}
