"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, RefreshCw } from "lucide-react";
import { partnerLogout } from "./login/actions";

// Shared bits of the delivery partner app's screens.

export function PartnerHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-[#e2e8d5] bg-[#F9FBF7]/95 px-3 py-3 backdrop-blur">
      {back && (
        <Link href={back} className="flex h-10 w-10 items-center justify-center rounded-full text-gray-700 active:bg-gray-100" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      )}
      <div className={back ? "min-w-0 flex-1" : "min-w-0 flex-1 pl-1"}>
        <p className="truncate text-lg font-bold leading-tight">{title}</p>
        {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
      </div>
      <button
        onClick={() => startRefresh(() => router.refresh())}
        className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 active:bg-gray-100"
        aria-label="Refresh"
      >
        <RefreshCw className={refreshing ? "h-5 w-5 animate-spin" : "h-5 w-5"} />
      </button>
      {!back && (
        <form action={partnerLogout}>
          <button className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 active:bg-gray-100" aria-label="Sign out">
            <LogOut className="h-5 w-5" />
          </button>
        </form>
      )}
    </header>
  );
}

// Keeps the screen current while it's open (the office may move a stop or
// another partner may deliver one) — only while the tab is visible.
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
