import { Sidebar } from "@/components/sidebar";
import { requireAdmin } from "@/lib/auth";
import { getDataMode } from "@/lib/mode";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();
  const mode = await getDataMode();

  return (
    <div className="min-h-screen bg-[#F9FBF7]">
      <Sidebar email={user.email ?? ""} mode={mode} />
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
