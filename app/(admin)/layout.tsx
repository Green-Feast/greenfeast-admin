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

// 1–2★ ratings and app feedback nobody has marked handled yet (Feedback
// badge), in the current Live/Test world.
async function openFeedback(isTest: boolean) {
  const [ratings, messages] = await Promise.all([
    supabaseAdmin.from("meal_ratings").select("id, users!inner ( is_test )", { count: "exact", head: true })
      .lte("stars", 2).is("handled_at", null).eq("users.is_test", isTest),
    supabaseAdmin.from("app_feedback").select("id, users!inner ( is_test )", { count: "exact", head: true })
      .is("handled_at", null).eq("users.is_test", isTest),
  ]);
  return (ratings.count ?? 0) + (messages.count ?? 0);
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  const mode = await getDataMode();
  const [alerts, feedback] = await Promise.all([unseenAlerts(user.id), openFeedback(mode === "test")]);

  return (
    <div className="min-h-screen bg-[#F9FBF7]">
      <Sidebar email={user.email ?? ""} mode={mode} alerts={alerts} feedback={feedback} />
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
