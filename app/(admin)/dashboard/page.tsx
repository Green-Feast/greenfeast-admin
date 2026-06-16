import { Users, Truck, Clock, CreditCard, TrendingUp } from "lucide-react";

const metricCards = [
  {
    label: "Active Subscribers",
    value: "58",
    icon: Users,
    color: "bg-emerald-50 text-emerald-700",
    iconBg: "bg-emerald-100",
    trend: "+3 this week",
  },
  {
    label: "Today's Deliveries",
    value: "47",
    icon: Truck,
    color: "bg-blue-50 text-blue-700",
    iconBg: "bg-blue-100",
    trend: "On track",
  },
  {
    label: "Expiring This Week",
    value: "6",
    icon: Clock,
    color: "bg-amber-50 text-amber-700",
    iconBg: "bg-amber-100",
    trend: "Needs attention",
  },
  {
    label: "Pending Payments",
    value: "3",
    icon: CreditCard,
    color: "bg-red-50 text-red-700",
    iconBg: "bg-red-100",
    trend: "Follow up",
  },
];

const batches = [
  { name: "Nami", deliveries: 16, color: "bg-emerald-500" },
  { name: "Rahul", deliveries: 7, color: "bg-blue-500" },
  { name: "Yashpal", deliveries: 12, color: "bg-violet-500" },
  { name: "Santu", deliveries: 12, color: "bg-orange-500" },
  { name: "Evening", deliveries: 6, color: "bg-pink-500" },
];

const maxDeliveries = Math.max(...batches.map((b) => b.deliveries));

const recentActivity = [
  {
    text: "Pallavi Bhadu paused subscription",
    type: "pause",
    time: "2 min ago",
  },
  {
    text: "New subscriber: Rijul Agrawal",
    type: "new",
    time: "18 min ago",
  },
  {
    text: "Ankit Chitlangiya changed meal to Thai Zen Bowl",
    type: "update",
    time: "1 hr ago",
  },
  {
    text: "Sheets generated for today",
    type: "system",
    time: "3 hr ago",
  },
  {
    text: "Vandana Chandana renewed plan",
    type: "renew",
    time: "5 hr ago",
  },
];

const activityDot: Record<string, string> = {
  pause: "bg-amber-400",
  new: "bg-emerald-500",
  update: "bg-blue-400",
  system: "bg-gray-400",
  renew: "bg-violet-500",
};

export default function DashboardPage() {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
              <p className="text-3xl font-bold text-[#1A1A1A] mb-0.5">
                {card.value}
              </p>
              <p className="text-xs font-medium text-gray-500 mb-2">
                {card.label}
              </p>
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
              <h2 className="font-semibold text-[#1A1A1A]">Today's Batch Summary</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                53 total deliveries across 5 batches
              </p>
            </div>
            <span className="text-xs font-medium bg-[#1B5E20]/10 text-[#1B5E20] px-2.5 py-1 rounded-full">
              Today
            </span>
          </div>
          <div className="p-5 space-y-4">
            {batches.map((batch) => (
              <div key={batch.name}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${batch.color}`}
                    />
                    <span className="text-sm font-medium text-[#1A1A1A]">
                      {batch.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-[#1A1A1A]">
                      {batch.deliveries}
                    </span>
                    <span className="text-xs text-gray-400 w-16 text-right">
                      {batch.deliveries} deliveries
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${batch.color} transition-all duration-500`}
                    style={{
                      width: `${(batch.deliveries / maxDeliveries) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          {/* Table view */}
          <div className="px-5 pb-5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t border-[#e2e8d5]">
                  <th className="text-left text-xs font-medium text-gray-400 py-2.5 uppercase tracking-wider">
                    Batch
                  </th>
                  <th className="text-right text-xs font-medium text-gray-400 py-2.5 uppercase tracking-wider">
                    Deliveries
                  </th>
                  <th className="text-right text-xs font-medium text-gray-400 py-2.5 uppercase tracking-wider">
                    Share
                  </th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch, i) => (
                  <tr
                    key={batch.name}
                    className={i < batches.length - 1 ? "border-b border-[#e2e8d5]/60" : ""}
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${batch.color}`} />
                        <span className="font-medium text-[#1A1A1A]">{batch.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right font-semibold text-[#1A1A1A]">
                      {batch.deliveries}
                    </td>
                    <td className="py-2.5 text-right text-gray-400">
                      {Math.round((batch.deliveries / 53) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#e2e8d5] shadow-sm">
          <div className="px-5 py-4 border-b border-[#e2e8d5]">
            <h2 className="font-semibold text-[#1A1A1A]">Recent Activity</h2>
            <p className="text-xs text-gray-500 mt-0.5">Last 5 actions</p>
          </div>
          <div className="p-5">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[#e2e8d5]" />
              <ul className="space-y-5">
                {recentActivity.map((item, i) => (
                  <li key={i} className="flex gap-3 relative">
                    <span
                      className={`w-3.5 h-3.5 rounded-full mt-0.5 flex-shrink-0 z-10 ring-2 ring-white ${
                        activityDot[item.type]
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-[#1A1A1A] leading-snug">
                        {item.text}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{item.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="px-5 pb-5">
            <button className="w-full text-center text-xs font-medium text-[#1B5E20] hover:underline py-1.5 border border-[#e2e8d5] rounded-lg hover:bg-[#f0f7f0] transition-colors">
              View full activity log
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
