import { Users, Truck, Clock, CreditCard, TrendingUp, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

async function getDashboardData() {
  const today = new Date().toISOString().split("T")[0];

  const [
    { count: activeCount },
    { count: pendingPayments },
    { data: batchRows },
    { count: lowDeliveriesCount },
    { data: recentActivity },
    { data: todayOrders },
    { data: menuRows },
  ] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),

    supabaseAdmin
      .from("payments")
      .select("*", { count: "exact", head: true })
      .eq("status", "created"),

    supabaseAdmin
      .from("subscriptions")
      .select("batches(name)")
      .eq("status", "active"),

    supabaseAdmin
      .from("subscriptions")
      .select("*", { count: "exact", head: true })
      .eq("status", "active")
      .lte("deliveries_remaining", 5),

    supabaseAdmin
      .from("wallet_transactions")
      .select("id, type, amount, reason, created_at, users ( name )")
      .order("created_at", { ascending: false })
      .limit(8),

    supabaseAdmin
      .from("orders")
      .select("status, subscriptions!inner ( batches ( id, name ) )")
      .eq("delivery_date", today)
      .not("status", "in", "(cancelled,skipped)"),

    supabaseAdmin
      .from("weekly_menu")
      .select("updated_at")
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  // Group active subs by batch
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

  // Group today's orders by batch
  type BatchStatus = { name: string; scheduled: number; preparing: number; out: number; delivered: number; total: number };
  const todayBatchMap: Record<string, BatchStatus> = {};
  for (const o of (todayOrders ?? []) as any[]) {
    const sub = Array.isArray(o.subscriptions) ? o.subscriptions[0] : o.subscriptions;
    const batch = Array.isArray(sub?.batches) ? sub?.batches[0] : sub?.batches;
    const name: string = (batch as any)?.name ?? "Unassigned";
    if (!todayBatchMap[name]) todayBatchMap[name] = { name, scheduled: 0, preparing: 0, out: 0, delivered: 0, total: 0 };
    const entry = todayBatchMap[name];
    entry.total++;
    if (o.status === "delivered") entry.delivered++;
    else if (o.status === "out_for_delivery") entry.out++;
    else if (o.status === "preparing") entry.preparing++;
    else entry.scheduled++;
  }
  const todayBatches = Object.values(todayBatchMap).sort((a, b) => a.name.localeCompare(b.name));
  const totalToday = todayBatches.reduce((s, b) => s + b.total, 0);
  const deliveredToday = todayBatches.reduce((s, b) => s + b.delivered, 0);

  const menuLastUpdated = (menuRows as any)?.[0]?.updated_at ?? null;

  return {
    activeCount: activeCount ?? 0,
    pendingPayments: pendingPayments ?? 0,
    expiringCount: lowDeliveriesCount ?? 0,
    batches,
    totalDeliveries,
    recentActivity: (recentActivity ?? []) as any[],
    todayBatches,
    totalToday,
    deliveredToday,
    menuLastUpdated,
  };
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "Yesterday" : `${days}d ago`;
}

function fmtActivityLabel(reason: string | null): string {
  if (!reason) return "Transaction";
  if (reason.startsWith("Meal delivered")) return "Meal delivered";
  if (reason === "Meal switch") return "Switched meal";
  if (reason === "Wallet top-up") return "Wallet top-up";
  if (reason === "Plan funded") return "Plan funded";
  return reason;
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
      label: "Today's Deliveries",
      value: String(data.totalToday),
      icon: Truck,
      color: "bg-blue-50 text-blue-700",
      iconBg: "bg-blue-100",
      trend: data.totalToday > 0 ? `${data.deliveredToday}/${data.totalToday} done` : "None today",
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
          <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Overview</span>
        </div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">{today}</p>
          </div>
          {data.menuLastUpdated && (
            <span className="text-xs text-gray-500 bg-gray-100 rounded-full px-3 py-1">
              Weekly menu saved {fmtRelative(data.menuLastUpdated)}
            </span>
          )}
        </div>
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

      {/* Today's Deliveries by Batch */}
      {data.todayBatches.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm mb-6">
          <div className="px-5 py-4 border-b border-[#e2e8d5] flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-[#1A1A1A]">Today's Delivery Status</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {data.deliveredToday} of {data.totalToday} delivered
              </p>
            </div>
            <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
              {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </span>
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.todayBatches.map((b) => {
              const pct = b.total > 0 ? Math.round((b.delivered / b.total) * 100) : 0;
              const stage = b.out > 0 ? "Out for delivery" : b.preparing > 0 ? "In kitchen" : b.delivered === b.total ? "All delivered" : "Scheduled";
              const stageCls = b.delivered === b.total
                ? "bg-green-100 text-green-700"
                : b.out > 0 ? "bg-blue-100 text-blue-700"
                : b.preparing > 0 ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-600";
              return (
                <div key={b.name} className="border border-[#e2e8d5] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-[#1A1A1A]">{b.name}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${stageCls}`}>{stage}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#1B5E20] rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 shrink-0">{b.delivered}/{b.total}</span>
                  </div>
                  <div className="flex gap-3 text-[10px] text-gray-400">
                    {b.scheduled > 0 && <span>{b.scheduled} scheduled</span>}
                    {b.preparing > 0 && <span className="text-amber-600">{b.preparing} in kitchen</span>}
                    {b.out > 0 && <span className="text-blue-600">{b.out} out</span>}
                    {b.delivered > 0 && <span className="text-green-600">{b.delivered} delivered</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
            <span className="text-xs font-medium bg-[#1B5E20]/10 text-[#1B5E20] px-2.5 py-1 rounded-full">Live</span>
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
                        {data.totalDeliveries > 0 ? `${Math.round((batch.deliveries / data.totalDeliveries) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Recent Activity</h2>
            <p className="text-xs text-gray-500 mt-0.5">Wallet credits, debits & events</p>
          </div>
          <div className="p-5">
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
            ) : (
              <ul className="space-y-3">
                {data.recentActivity.map((tx: any) => {
                  const isCredit = tx.type === "credit";
                  const userName = Array.isArray(tx.users) ? tx.users[0]?.name : tx.users?.name;
                  return (
                    <li key={tx.id} className="flex items-start gap-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${isCredit ? "bg-green-100" : "bg-red-50"}`}>
                        {isCredit
                          ? <ArrowUpRight className="w-3 h-3 text-green-700" />
                          : <ArrowDownLeft className="w-3 h-3 text-red-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#1A1A1A] truncate">{userName ?? "Unknown"}</p>
                        <p className="text-xs text-gray-400 truncate">{fmtActivityLabel(tx.reason)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-semibold ${isCredit ? "text-green-700" : "text-red-600"}`}>
                          {isCredit ? "+" : "−"}₹{(tx.amount / 100).toLocaleString("en-IN")}
                        </p>
                        <p className="text-[10px] text-gray-400">{fmtRelative(tx.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
