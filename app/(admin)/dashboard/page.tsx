import { Users, Truck, Clock, CreditCard, TrendingUp } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase";

// Always render fresh — admin data must be live, not baked at build time
export const dynamic = "force-dynamic";

const BATCH_COLORS: Record<string, string> = {
  default: "bg-emerald-500",
};

async function getDashboardData() {
  const [
    { count: activeCount },
    { count: pendingPayments },
    { data: batchRows },
    { data: recentSubs },
    { data: lowDeliveries },
  ] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),

    supabaseAdmin
      .from("payments")
      .select("*", { count: "exact", head: true })
      .eq("status", "created"),

    // Active subscriptions with batch name for breakdown
    supabaseAdmin
      .from("subscriptions")
      .select("batches(name)")
      .eq("status", "active"),

    // Most recent sign-ups
    supabaseAdmin
      .from("users")
      .select("name, created_at")
      .order("created_at", { ascending: false })
      .limit(5),

    // Subscriptions with ≤ 5 deliveries remaining (expiring soon proxy)
    supabaseAdmin
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .lte("deliveries_remaining", 5),
  ]);

  // Group by batch name
  const batchMap: Record<string, number> = {};
  for (const row of batchRows ?? []) {
    const b = Array.isArray(row.batches) ? row.batches[0] : row.batches;
    const name = (b as any)?.name ?? "Unassigned";
    batchMap[name] = (batchMap[name] ?? 0) + 1;
  }
  const batches = Object.entries(batchMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, deliveries]) => ({ name, deliveries }));

  const totalDeliveries = batches.reduce((s, b) => s + b.deliveries, 0);

  return {
    activeCount: activeCount ?? 0,
    todayDeliveries: activeCount ?? 0,
    expiringCount: (lowDeliveries as any) ?? 0,
    pendingPayments: pendingPayments ?? 0,
    batches,
    totalDeliveries,
    recentSubs: recentSubs ?? [],
  };
}

export default async function DashboardPage() {
  const data = await getDashboardData();

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const maxDeliveries = Math.max(...data.batches.map((b) => b.deliveries), 1);

  const metricCards = [
    {
      label: "Active Subscribers",
      value: String(data.activeCount),
      icon: Users,
      color: "bg-emerald-50 text-emerald-700",
      iconBg: "bg-emerald-100",
      trend: `${data.activeCount} total`,
    },
    {
      label: "Active Deliveries",
      value: String(data.todayDeliveries),
      icon: Truck,
      color: "bg-blue-50 text-blue-700",
      iconBg: "bg-blue-100",
      trend: "Active routes",
    },
    {
      label: "Deliveries Low (≤ 5)",
      value: String(data.expiringCount),
      icon: Clock,
      color: "bg-amber-50 text-amber-700",
      iconBg: "bg-amber-100",
      trend: data.expiringCount > 0 ? "Needs renewal" : "All clear",
    },
    {
      label: "Pending Payments",
      value: String(data.pendingPayments),
      icon: CreditCard,
      color: "bg-red-50 text-red-700",
      iconBg: "bg-red-100",
      trend: data.pendingPayments > 0 ? "Follow up" : "All clear",
    },
  ];

  const COLORS = [
    "bg-emerald-500", "bg-blue-500", "bg-violet-500",
    "bg-orange-500", "bg-pink-500", "bg-teal-500",
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-[#1B5E20]" />
          <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">
            Overview
          </span>
        </div>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">{today}</p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {metricCards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="bg-white rounded-xl border border-[#e2e8d5] p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`p-2 rounded-lg ${card.iconBg}`}>
                  <Icon className={`w-4 h-4 ${card.color.split(" ")[1]}`} />
                </div>
              </div>
              <p className="text-3xl font-bold text-[#1A1A1A] mb-0.5">{card.value}</p>
              <p className="text-xs font-medium text-gray-500 mb-2">{card.label}</p>
              <p className={`text-xs font-medium px-2 py-0.5 rounded-full inline-block ${card.color}`}>
                {card.trend}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Batch Summary */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5] flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-[#1A1A1A]">Subscribers by Batch</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {data.totalDeliveries} active across {data.batches.length} batch{data.batches.length !== 1 ? "es" : ""}
              </p>
            </div>
            <span className="text-xs font-medium bg-[#1B5E20]/10 text-[#1B5E20] px-2.5 py-1 rounded-full">
              Live
            </span>
          </div>
          <div className="p-5 space-y-4">
            {data.batches.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No active subscribers yet</p>
            ) : (
              data.batches.map((batch, idx) => {
                const color = COLORS[idx % COLORS.length];
                return (
                  <div key={batch.name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                        <span className="text-sm font-medium text-[#1A1A1A]">{batch.name}</span>
                      </div>
                      <span className="text-sm font-bold text-[#1A1A1A]">{batch.deliveries}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${color} transition-all duration-500`}
                        style={{ width: `${(batch.deliveries / maxDeliveries) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {data.batches.length > 0 && (
            <div className="px-5 pb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-t border-[#e2e8d5]">
                    <th className="text-left text-xs font-medium text-gray-400 py-2.5 uppercase tracking-wider">Batch</th>
                    <th className="text-right text-xs font-medium text-gray-400 py-2.5 uppercase tracking-wider">Subscribers</th>
                    <th className="text-right text-xs font-medium text-gray-400 py-2.5 uppercase tracking-wider">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.batches.map((batch, i) => (
                    <tr key={batch.name} className={i < data.batches.length - 1 ? "border-b border-[#e2e8d5]/60" : ""}>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${COLORS[i % COLORS.length]}`} />
                          <span className="font-medium text-[#1A1A1A]">{batch.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-[#1A1A1A]">{batch.deliveries}</td>
                      <td className="py-2.5 text-right text-gray-400">
                        {data.totalDeliveries > 0
                          ? `${Math.round((batch.deliveries / data.totalDeliveries) * 100)}%`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Sign-ups */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Recent Sign-ups</h2>
            <p className="text-xs text-gray-500 mt-0.5">New subscribers via app</p>
          </div>
          <div className="p-5">
            {data.recentSubs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No subscribers yet</p>
            ) : (
              <ul className="space-y-4">
                {data.recentSubs.map((s, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#1B5E20]/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-[#1B5E20]">
                        {(s.name ?? "?")[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">{s.name ?? "Unknown"}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(s.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                      </p>
                    </div>
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                      New
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
