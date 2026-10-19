"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Truck,
  Package,
  Menu,
  X,
  Bike,
  ChefHat,
  LogOut,
  Bell,
  IndianRupee,
  UtensilsCrossed,
  BellRing,
} from "lucide-react";
import { logout } from "@/app/login/actions";
import { setDataMode } from "@/app/(admin)/mode-actions";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/alerts", label: "Alerts", icon: BellRing },
  { href: "/users", label: "Users", icon: UserCog },
  { href: "/subscribers", label: "Subscribers", icon: Users },
  { href: "/operations", label: "Operations", icon: Truck },
  { href: "/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/kitchen", label: "Kitchen", icon: ChefHat },
  { href: "/batches", label: "Batches", icon: Package },
  { href: "/delivery-partners", label: "Partners", icon: Bike },
  { href: "/money", label: "Money", icon: IndianRupee },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

export function Sidebar({ email, mode, alerts = 0 }: { email: string; mode: "live" | "test"; alerts?: number }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switching, startSwitch] = useTransition();

  // Live = real customers, Test = test accounts (users.is_test). Every page
  // filters by this, so it's always visible here.
  const ModeSwitch = () => (
    <div className="px-3 pt-4">
      <div className="flex rounded-lg bg-black/20 p-1 text-xs font-semibold">
        {(["live", "test"] as const).map((m) => (
          <button
            key={m}
            disabled={switching}
            onClick={() => m !== mode && startSwitch(() => setDataMode(m))}
            className={`flex-1 rounded-md py-1.5 transition-colors ${
              mode === m
                ? m === "live" ? "bg-white text-[#1B5E20]" : "bg-[#FDD835] text-[#1A1A1A]"
                : "text-white/70 hover:text-white"
            }`}
          >
            {m === "live" ? "● Live" : "Test"}
          </button>
        ))}
      </div>
    </div>
  );

  const NavContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-white/15">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
          <Image src="/logo.png" alt="" width={32} height={32} className="w-full h-full object-cover" />
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-white font-bold text-lg leading-none tracking-tight">
            Green
          </span>
          <span className="text-[#FDD835] font-bold text-lg leading-none tracking-tight">
            Feast
          </span>
        </div>
      </div>

      <ModeSwitch />

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                active
                  ? "bg-[#FDD835] text-[#1A1A1A] shadow-sm"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {href === "/alerts" && alerts > 0 && (
                <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                  {alerts > 99 ? "99+" : alerts}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/15 space-y-3">
        {email && <p className="text-white/60 text-xs truncate">{email}</p>}
        <form action={logout}>
          <button
            type="submit"
            className="flex items-center gap-2 text-white/70 hover:text-white text-xs font-medium transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
        </form>
        <p className="text-white/40 text-xs">GreenFeast Admin v1.0</p>
        <p className="text-white/30 text-xs">Jaipur, Rajasthan</p>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 min-h-screen bg-[#1B5E20] fixed left-0 top-0 bottom-0 z-30">
        <NavContent />
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-[#1B5E20] shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0">
            <Image src="/logo.png" alt="" width={28} height={28} className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-bold text-base">
            Green<span className="text-[#FDD835]">Feast</span>
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="relative text-white p-1"
          aria-label="Toggle menu"
        >
          {alerts > 0 && !mobileOpen && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-[#1B5E20]" />}
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-60 bg-[#1B5E20] flex flex-col">
            <NavContent />
          </aside>
        </div>
      )}
    </>
  );
}
