"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  Truck,
  Package,
  Menu,
  X,
  Leaf,
  Bike,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/subscribers", label: "Subscribers", icon: Users },
  { href: "/operations", label: "Operations", icon: Truck },
  { href: "/batches", label: "Batches", icon: Package },
  { href: "/delivery-partners", label: "Partners", icon: Bike },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const NavContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5 border-b border-white/15">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#FDD835]">
          <Leaf className="w-4 h-4 text-[#1B5E20]" strokeWidth={2.5} />
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
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/15">
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
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#FDD835]">
            <Leaf className="w-3.5 h-3.5 text-[#1B5E20]" strokeWidth={2.5} />
          </div>
          <span className="text-white font-bold text-base">
            Green<span className="text-[#FDD835]">Feast</span>
          </span>
        </div>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-white p-1"
          aria-label="Toggle menu"
        >
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
