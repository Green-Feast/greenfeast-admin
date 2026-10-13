import Link from "next/link";
import {
  Users, Truck, CreditCard, TrendingUp, AlertTriangle, UserPlus, Banknote, Route, Hourglass,
  Wallet, Undo2, DoorClosed, PlayCircle, PauseCircle, XCircle, SkipForward, RefreshCw, IndianRupee,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { istToday } from "@/lib/ist";
import { isTestMode } from "@/lib/mode";

export const dynamic = "force-dynamic";

const LOW_WALLET_PAISE = 30000; // ≈ one meal

type Person = { name: string; code: string };
type ActivityItem = { at: string; kind: string; who: Person | null; text: string; href?: string };
type AttentionRow = { who: Person; detail: string; href: string };

function person(u: any): Person {
  const x = Array.isArray(u) ? u[0] : u;
  return { name: x?.name ?? "Unnamed", code: x?.customer_code ?? "" };
}

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
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

function fmtDay(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

async function getDashboardData(isTest: boolean) {
  const today = istToday();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const halfHourAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const [
    { data: liveSubs },
    { data: todayOrders },
    { data: newUsers },
    { data: recentSubs },
    { data: payments },
    { data: stuckPayments },
    { data: refunds },
    { data: skips },
    { data: closures },
  ] = await Promise.all([
    // Every plan that matters right now, with what the attention list needs.
    supabaseAdmin
      .from("subscriptions")
      .select(`
        id, user_id, status, payment_method, plan_name, plan_id, deliveries_remaining, meals_lunch, meals_dinner,
        batch_id_lunch, batch_id_dinner, created_at,
        batchLunch:batches!subscriptions_batch_id_lunch_fkey ( name ),
        batchDinner:batches!subscriptions_batch_id_dinner_fkey ( name ),
        users!inner ( name, customer_code, is_test, wallets ( balance ) )
      `)
      .in("status", ["active", "paused", "pending"])
      .eq("users.is_test", isTest),
    supabaseAdmin
      .from("orders")
      .select("status, meal_slot, batches ( name ), users!inner ( is_test )")
      .eq("delivery_date", today)
      .not("status", "in", "(cancelled,skipped)")
      .eq("users.is_test", isTest),
    supabaseAdmin
      .from("users")
      .select("id, name, customer_code, created_at")
      .eq("is_test", isTest)
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("subscriptions")
      .select("id, user_id, status, payment_method, plan_name, plan_id, renewed_from, created_at, updated_at, pause_until, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .or(`created_at.gte."${weekAgo}",updated_at.gte."${weekAgo}"`)
      .order("updated_at", { ascending: false })
      .limit(60),
    supabaseAdmin
      .from("payments")
      .select("id, amount, subscription_id, cf_order_id, created_at, updated_at, users!inner ( name, customer_code, is_test )")
      .eq("status", "paid")
      .eq("users.is_test", isTest)
      .gte("updated_at", weekAgo)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabaseAdmin
      .from("payments")
      .select("id, users!inner ( is_test )")
      .eq("status", "created")
      .eq("users.is_test", isTest)
      .gte("created_at", twoDaysAgo)
      .lte("created_at", halfHourAgo),
    supabaseAdmin
      .from("refunds")
      .select("id, kind, amount, status, reason, created_at, users!inner ( name, customer_code, is_test )")
      .eq("users.is_test", isTest)
      .gte("created_at", weekAgo)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("orders")
      .select("id, delivery_date, meal_slot, skip_reason, updated_at, subscription_id, users!inner ( name, customer_code, is_test )")
      .eq("status", "skipped")
      .in("skip_reason", ["user", "insufficient_balance", "plan_finished"])
      .eq("users.is_test", isTest)
      .gte("updated_at", twoDaysAgo)
      .order("updated_at", { ascending: false })
      .limit(30),
    supabaseAdmin
      .from("kitchen_closures")
      .select("closed_on, meal_slot, reason, created_at")
      .gte("closed_on", today)
      .order("closed_on"),
  ]);

  const subs = (liveSubs ?? []) as any[];
  const active = subs.filter((s) => s.status === "active");

  // ── Needs attention ────────────────────────────────────────────────────────
  const codPending: AttentionRow[] = subs
    .filter((s) => s.status === "pending" && s.payment_method === "cod")
    .map((s) => ({ who: person(s.users), detail: `${s.plan_name ?? s.plan_id} · signed up ${fmtRelative(s.created_at)}`, href: `/subscribers/${s.id}` }));

  const noBatch: AttentionRow[] = subs
    .filter((s) => s.status !== "pending" || s.payment_method === "cod")
    .filter((s) => ((s.meals_lunch ?? 0) > 0 && !s.batch_id_lunch) || ((s.meals_dinner ?? 0) > 0 && !s.batch_id_dinner))
    .map((s) => {
      const missing = [
        (s.meals_lunch ?? 0) > 0 && !s.batch_id_lunch ? "lunch" : null,
        (s.meals_dinner ?? 0) > 0 && !s.batch_id_dinner ? "dinner" : null,
      ].filter(Boolean).join(" + ");
      return { who: person(s.users), detail: `No ${missing} batch`, href: "/batches" };
    });

  const finishing: AttentionRow[] = active
    .filter((s) => (s.deliveries_remaining ?? 0) <= 2)
    .sort((a, b) => (a.deliveries_remaining ?? 0) - (b.deliveries_remaining ?? 0))
    .map((s) => ({
      who: person(s.users),
      detail: s.deliveries_remaining <= 0 ? "Plan finished — renewal due" : `${s.deliveries_remaining} meal${s.deliveries_remaining === 1 ? "" : "s"} left`,
      href: `/subscribers/${s.id}`,
    }));

  const lowWallet: AttentionRow[] = active
    .filter((s) => (s.deliveries_remaining ?? 0) > 0)
    .map((s) => {
      const u = Array.isArray(s.users) ? s.users[0] : s.users;
      const w = Array.isArray(u?.wallets) ? u.wallets[0] : u?.wallets;
      return { s, balance: (w?.balance ?? 0) as number };
    })
    .filter(({ balance }) => balance < LOW_WALLET_PAISE)
    .map(({ s, balance }) => ({ who: person(s.users), detail: `Wallet ${rupees(balance)} — next meal may be skipped`, href: `/subscribers/${s.id}` }));

  const subscribedUsers = new Set(((recentSubs ?? []) as any[]).map((s) => s.user_id));
  for (const s of subs) subscribedUsers.add((s as any).user_id);
  const newWithoutPlan = ((newUsers ?? []) as any[]).filter((u) => !subscribedUsers.has(u.id));

  const pendingRefunds = ((refunds ?? []) as any[]).filter((r) => r.status === "pending").length;
  const stuck = (stuckPayments ?? []).length;

  // ── Recent activity (last 7 days) ──────────────────────────────────────────
  const activity: ActivityItem[] = [];
  for (const u of (newUsers ?? []) as any[]) {
    activity.push({ at: u.created_at, kind: "signup", who: person(u), text: "Signed up", href: "/users" });
  }
  for (const s of (recentSubs ?? []) as any[]) {
    const who = person(s.users);
    const href = `/subscribers/${s.id}`;
    const plan = s.plan_name ?? s.plan_id;
    if (s.status === "cancelled") activity.push({ at: s.updated_at, kind: "cancel", who, text: `Cancelled ${plan}`, href });
    else if (s.status === "paused") activity.push({ at: s.updated_at, kind: "pause", who, text: `Paused ${plan}${s.pause_until ? ` until ${fmtDay(s.pause_until)}` : ""}`, href });
    else if (s.status === "expired") activity.push({ at: s.updated_at, kind: "expired", who, text: `${plan} finished`, href });
    else if (s.status === "active" && s.created_at >= weekAgo) {
      activity.push({ at: s.created_at, kind: s.renewed_from ? "renewal" : "plan", who, text: s.renewed_from ? `Renewed — ${plan}` : `Started ${plan}`, href });
    } else if (s.status === "pending" && s.payment_method === "cod" && s.created_at >= weekAgo) {
      activity.push({ at: s.created_at, kind: "cod", who, text: `New cash-on-delivery plan — ${plan}, cash pending`, href });
    }
  }
  for (const p of (payments ?? []) as any[]) {
    const what = p.cf_order_id?.startsWith("topup_") ? "wallet top-up" : p.cf_order_id ? "plan payment" : "payment recorded";
    activity.push({ at: p.updated_at ?? p.created_at, kind: "payment", who: person(p.users), text: `${rupees(p.amount)} ${what}`, href: "/money" });
  }
  for (const r of (refunds ?? []) as any[]) {
    activity.push({
      at: r.created_at, kind: "refund", who: person(r.users),
      text: `Refund ${rupees(r.amount)} to ${r.kind === "bank" ? "bank" : "wallet"}${r.status !== "completed" ? ` (${r.status})` : ""} — ${r.reason}`,
      href: "/money",
    });
  }
  for (const o of (skips ?? []) as any[]) {
    const why = o.skip_reason === "user" ? "skipped by customer" : o.skip_reason === "insufficient_balance" ? "skipped — low wallet" : "skipped — plan finished";
    activity.push({ at: o.updated_at, kind: "skip", who: person(o.users), text: `${fmtDay(o.delivery_date)} ${o.meal_slot} ${why}`, href: `/subscribers/${o.subscription_id}` });
  }
  for (const c of (closures ?? []) as any[]) {
    if (c.created_at >= weekAgo) {
      activity.push({ at: c.created_at, kind: "closure", who: null, text: `Kitchen closed — ${fmtDay(c.closed_on)} ${c.meal_slot}${c.reason ? ` (${c.reason})` : ""}`, href: `/operations?date=${c.closed_on}` });
    }
  }
  activity.sort((a, b) => b.at.localeCompare(a.at));

  // ── Today + batches (as before) ────────────────────────────────────────────
  const batchMap: Record<string, number> = {};
  for (const s of active) {
    const bl = Array.isArray(s.batchLunch) ? s.batchLunch[0] : s.batchLunch;
    const bd = Array.isArray(s.batchDinner) ? s.batchDinner[0] : s.batchDinner;
    if (bl?.name) batchMap[bl.name] = (batchMap[bl.name] ?? 0) + 1;
    if (bd?.name) batchMap[bd.name] = (batchMap[bd.name] ?? 0) + 1;
  }
  const batches = Object.entries(batchMap).sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => ({ name, n }));

  type BatchStatus = { name: string; total: number; delivered: number; out: number; preparing: number };
  const todayMap: Record<string, BatchStatus> = {};
  for (const o of (todayOrders ?? []) as any[]) {
    const b = Array.isArray(o.batches) ? o.batches[0] : o.batches;
    const name = `${b?.name ?? "Unassigned"} · ${o.meal_slot}`;
    const e = (todayMap[name] ??= { name, total: 0, delivered: 0, out: 0, preparing: 0 });
    e.total++;
    if (o.status === "delivered") e.delivered++;
    else if (o.status === "out_for_delivery") e.out++;
    else if (o.status === "preparing") e.preparing++;
  }
  const todayBatches = Object.values(todayMap).sort((a, b) => a.name.localeCompare(b.name));
  const walletHeld = active.reduce((sum, s) => {
    const u = Array.isArray(s.users) ? s.users[0] : s.users;
    const w = Array.isArray(u?.wallets) ? u.wallets[0] : u?.wallets;
    return sum + Math.max(w?.balance ?? 0, 0);
  }, 0);

  return {
    activeCount: active.length,
    totalToday: todayBatches.reduce((s, b) => s + b.total, 0),
    deliveredToday: todayBatches.reduce((s, b) => s + b.delivered, 0),
    todayBatches,
    batches,
    walletHeld,
    attention: { codPending, noBatch, finishing, lowWallet, newWithoutPlan, pendingRefunds, stuck },
    closures: (closures ?? []) as any[],
    activity: activity.slice(0, 30),
  };
}

const ACTIVITY_ICON: Record<string, { icon: any; cls: string }> = {
  signup: { icon: UserPlus, cls: "bg-blue-100 text-blue-700" },
  plan: { icon: PlayCircle, cls: "bg-green-100 text-green-700" },
  renewal: { icon: RefreshCw, cls: "bg-green-100 text-green-700" },
  cod: { icon: Banknote, cls: "bg-amber-100 text-amber-700" },
  payment: { icon: IndianRupee, cls: "bg-emerald-100 text-emerald-700" },
  refund: { icon: Undo2, cls: "bg-violet-100 text-violet-700" },
  pause: { icon: PauseCircle, cls: "bg-gray-100 text-gray-600" },
  cancel: { icon: XCircle, cls: "bg-red-100 text-red-700" },
  expired: { icon: Hourglass, cls: "bg-gray-100 text-gray-600" },
  skip: { icon: SkipForward, cls: "bg-orange-100 text-orange-700" },
  closure: { icon: DoorClosed, cls: "bg-red-100 text-red-700" },
};

function AttentionGroup({ icon: Icon, title, rows, empty, tone }: {
  icon: any; title: string; rows: AttentionRow[]; empty?: string; tone: string;
}) {
  if (rows.length === 0 && !empty) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${tone}`} />
        <h3 className="text-sm font-semibold text-[#1A1A1A]">{title}</h3>
        <span className="text-xs text-gray-400">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-400 ml-6">{empty}</p>
      ) : (
        <ul className="ml-6 space-y-1">
          {rows.slice(0, 6).map((r, i) => (
            <li key={i}>
              <Link href={r.href} className="flex items-baseline justify-between gap-3 text-sm hover:text-[#1B5E20]">
                <span className="truncate">
                  <span className="font-medium text-[#1A1A1A]">{r.who.name}</span>{" "}
                  <span className="font-mono text-xs text-gray-400">{r.who.code}</span>
                </span>
                <span className="text-xs text-gray-500 shrink-0">{r.detail}</span>
              </Link>
            </li>
          ))}
          {rows.length > 6 && <li className="text-xs text-gray-400">+{rows.length - 6} more</li>}
        </ul>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  await requireAdmin();
  const isTest = await isTestMode();
  const data = await getDashboardData(isTest);
  const a = data.attention;
  const attentionCount =
    a.codPending.length + a.noBatch.length + a.finishing.length + a.lowWallet.length + a.pendingRefunds + a.stuck;

  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const metricCards = [
    { label: "Active Subscribers", value: String(data.activeCount), icon: Users, iconBg: "bg-emerald-100", iconCls: "text-emerald-700", hint: isTest ? "Test accounts" : "Real customers" },
    { label: "Today's Meals", value: String(data.totalToday), icon: Truck, iconBg: "bg-blue-100", iconCls: "text-blue-700", hint: data.totalToday > 0 ? `${data.deliveredToday}/${data.totalToday} delivered` : "None today" },
    { label: "Needs Attention", value: String(attentionCount), icon: AlertTriangle, iconBg: attentionCount ? "bg-amber-100" : "bg-gray-100", iconCls: attentionCount ? "text-amber-700" : "text-gray-500", hint: attentionCount ? "See below" : "All clear" },
    { label: "Wallet Money Held", value: rupees(data.walletHeld), icon: Wallet, iconBg: "bg-violet-100", iconCls: "text-violet-700", hint: "Prepaid, owed as meals" },
  ];

  return (
    <div className="p-6 md:p-8 max-w-6xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-[#1B5E20]" />
          <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">Overview · {isTest ? "Test" : "Live"}</span>
        </div>
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">{todayLabel}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {metricCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white rounded-xl border border-[#e2e8d5] p-4 shadow-sm">
              <div className={`p-2 rounded-lg w-fit mb-3 ${c.iconBg}`}><Icon className={`w-4 h-4 ${c.iconCls}`} /></div>
              <p className="text-2xl font-bold text-[#1A1A1A] mb-0.5 break-words">{c.value}</p>
              <p className="text-xs font-medium text-gray-500">{c.label}</p>
              <p className="text-xs text-gray-400 mt-1">{c.hint}</p>
            </div>
          );
        })}
      </div>

      {data.closures.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          <DoorClosed className="w-4 h-4" />
          <span className="font-semibold">Kitchen closed:</span>
          {data.closures.map((c: any) => (
            <Link key={c.closed_on + c.meal_slot} href={`/operations?date=${c.closed_on}`} className="underline">
              {fmtDay(c.closed_on)} {c.meal_slot}{c.reason ? ` (${c.reason})` : ""}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        {/* Needs attention */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Needs attention</h2>
            <p className="text-xs text-gray-500 mt-0.5">Things to act on today</p>
          </div>
          <div className="p-5 space-y-5">
            <AttentionGroup icon={Banknote} tone="text-amber-600" title="Cash to collect (cash-on-delivery plans)" rows={a.codPending} />
            <AttentionGroup icon={Route} tone="text-blue-600" title="Not on a delivery batch" rows={a.noBatch} />
            <AttentionGroup icon={Hourglass} tone="text-orange-600" title="Plans finishing — follow up on renewal" rows={a.finishing} />
            <AttentionGroup icon={Wallet} tone="text-red-600" title="Low wallet" rows={a.lowWallet} />
            <AttentionGroup
              icon={UserPlus}
              tone="text-gray-500"
              title="Signed up this week, no plan yet"
              rows={a.newWithoutPlan.map((u: any) => ({ who: person(u), detail: fmtRelative(u.created_at), href: "/users" }))}
            />
            {(a.pendingRefunds > 0 || a.stuck > 0) && (
              <div className="flex flex-wrap gap-2">
                {a.pendingRefunds > 0 && (
                  <Link href="/money" className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700">{a.pendingRefunds} bank refund{a.pendingRefunds > 1 ? "s" : ""} pending</Link>
                )}
                {a.stuck > 0 && (
                  <Link href="/money" className="text-xs px-2.5 py-1 rounded-full bg-red-50 text-red-700"><CreditCard className="inline w-3 h-3 mr-1" />{a.stuck} payment{a.stuck > 1 ? "s" : ""} started but not completed</Link>
                )}
              </div>
            )}
            {attentionCount === 0 && a.newWithoutPlan.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Nothing needs attention right now.</p>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Recent activity</h2>
            <p className="text-xs text-gray-500 mt-0.5">Signups, plans, payments, skips, refunds — last 7 days</p>
          </div>
          <div className="p-5">
            {data.activity.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
            ) : (
              <ul className="space-y-3">
                {data.activity.map((ev, i) => {
                  const meta = ACTIVITY_ICON[ev.kind] ?? ACTIVITY_ICON.signup;
                  const Icon = meta.icon;
                  const body = (
                    <div className="flex items-start gap-2.5">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${meta.cls}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        {ev.who && (
                          <p className="text-sm font-medium text-[#1A1A1A] truncate">
                            {ev.who.name} <span className="font-mono text-xs font-normal text-gray-400">{ev.who.code}</span>
                          </p>
                        )}
                        <p className="text-xs text-gray-500">{ev.text}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 shrink-0 mt-1">{fmtRelative(ev.at)}</span>
                    </div>
                  );
                  return <li key={i}>{ev.href ? <Link href={ev.href} className="block hover:opacity-80">{body}</Link> : body}</li>;
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Today&apos;s deliveries</h2>
            <p className="text-xs text-gray-500 mt-0.5">{data.deliveredToday} of {data.totalToday} delivered</p>
          </div>
          <div className="p-5 space-y-3">
            {data.todayBatches.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No meals today</p>
            ) : data.todayBatches.map((b) => {
              const pct = b.total ? Math.round((b.delivered / b.total) * 100) : 0;
              return (
                <div key={b.name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-[#1A1A1A]">{b.name}</span>
                    <span className="text-xs text-gray-500">{b.delivered}/{b.total}{b.out ? ` · ${b.out} out` : ""}{b.preparing ? ` · ${b.preparing} in kitchen` : ""}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-[#1B5E20] rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Subscribers by batch</h2>
            <p className="text-xs text-gray-500 mt-0.5">Active plans per route (lunch and dinner counted separately)</p>
          </div>
          <div className="p-5">
            {data.batches.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">No active subscribers on batches yet</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {data.batches.map((b) => (
                    <tr key={b.name} className="border-b border-[#e2e8d5]/60 last:border-0">
                      <td className="py-2 font-medium text-[#1A1A1A]">{b.name}</td>
                      <td className="py-2 text-right font-semibold">{b.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
