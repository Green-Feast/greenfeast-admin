"use client";

import { useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

// Holds the desktop sidebar's collapsed state so the page's left padding
// follows it. The layout reads the cookie, so a reload renders at the right
// width without flashing the full sidebar first.
export function AdminShell({
  initialCollapsed,
  email,
  mode,
  alerts,
  feedback,
  children,
}: {
  initialCollapsed: boolean;
  email: string;
  mode: "live" | "test";
  alerts: number;
  feedback: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }

  return (
    <>
      <Sidebar email={email} mode={mode} alerts={alerts} feedback={feedback} collapsed={collapsed} onToggle={toggle} />
      <main className={`transition-[padding] duration-200 ${collapsed ? "md:pl-16" : "md:pl-60"}`}>{children}</main>
    </>
  );
}
