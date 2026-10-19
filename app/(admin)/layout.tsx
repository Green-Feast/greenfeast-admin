import { Sidebar } from "@/components/sidebar";
import { requireAdmin } from "@/lib/auth";
import { getDataMode } from "@/lib/mode";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Alerts the admin hasn't seen (sidebar badge) — since they last opened
// Alerts, or the last 7 days.
async function unseenAlerts(adminId: string) {
  const { data: me } = await supabaseAdmin.from("admin_users").select("alerts_read_at").eq("user_id", adminId).maybeSingle();
  const since = me?.alerts_read_at ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { count } = await supabaseAdmin.from("admin_alerts").select("*", { count: "exact", head: true }).gt("created_at", since);
  return count ?? 0;
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  const [mode, alerts] = await Promise.all([getDataMode(), unseenAlerts(user.id)]);

  return (
    <div className="min-h-screen bg-[#F9FBF7]">
      <Sidebar email={user.email ?? ""} mode={mode} alerts={alerts} />
      <main className="md:pl-60">
        <div className="pt-14 md:pt-0 min-h-screen">
          {mode === "test" && (
            <div className="sticky top-0 z-20 bg-[#FDD835] text-[#1A1A1A] text-xs font-semibold px-4 py-2 text-center shadow-sm">
              TEST MODE — you're seeing test accounts only. Real customers are under Live (switch in the sidebar).
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
