import Link from "next/link";
import { ChevronRight, AlertTriangle, Banknote, CheckCircle2, Clock } from "lucide-react";
import { requirePartner } from "@/lib/partner-auth";
import { partnerBatches, batchDays, SLOT_HOURS, RUN_LABEL, type PartnerBatch, type BatchDay } from "@/lib/partner-data";
import { istToday, addDaysISO } from "@/lib/ist";
import { rupees } from "@/lib/cash";
import { PartnerHeader, AutoRefresh } from "./ui";

export const dynamic = "force-dynamic";

function dayLabel(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function PartnerTodayPage() {
  const partner = await requirePartner();
  const today = istToday();
  const tomorrow = addDaysISO(today, 1);
  const batches = await partnerBatches(partner.partnerId);
  const days = await batchDays(batches.map((b) => b.id), [today, tomorrow], partner.isTest);

  const bySlot = (slot: "lunch" | "dinner") => batches.filter((b) => b.slot === slot);
  const tomorrowRows = batches
    .map((b) => ({ b, d: days.get(`${b.id}|${tomorrow}`) }))
    .filter((x): x is { b: PartnerBatch; d: BatchDay } => !!x.d && x.d.stops > 0);

  return (
    <main className="pb-10">
      <AutoRefresh seconds={60} />
      <PartnerHeader title={`Hi ${partner.name.split(" ")[0]}`} subtitle={`${dayLabel(today)}${partner.isTest ? " · TEST" : ""}`} />

      {batches.length === 0 && (
        <p className="mx-4 mt-6 rounded-2xl border border-dashed border-[#e2e8d5] bg-white p-6 text-center text-sm text-gray-500">
          No batches are assigned to you yet. Ask the office to add you to a batch.
        </p>
      )}

      {(["lunch", "dinner"] as const).map((slot) =>
        bySlot(slot).length === 0 ? null : (
          <section key={slot} className="mt-5 px-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              <Clock className="h-4 w-4" /> {slot === "lunch" ? "Lunch" : "Dinner"} · {SLOT_HOURS[slot]}
            </h2>
            <div className="space-y-3">
              {bySlot(slot).map((b) => (
                <BatchCard key={b.id} batch={b} day={days.get(`${b.id}|${today}`)} />
              ))}
            </div>
          </section>
        )
      )}

      {tomorrowRows.length > 0 && (
        <section className="mt-8 px-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Tomorrow · {dayLabel(tomorrow)}</h2>
          <div className="divide-y divide-[#e2e8d5] rounded-2xl border border-[#e2e8d5] bg-white">
            {tomorrowRows.map(({ b, d }) => (
              <Link
                key={b.id}
                href={`/partner/batch/${b.id}?date=${tomorrow}`}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{b.name}</span>
                  <span className="text-gray-500"> · {b.slot === "lunch" ? "Lunch" : "Dinner"}</span>
                </span>
                <span className="flex items-center gap-1 text-gray-500">
                  {d.stops} stop{d.stops === 1 ? "" : "s"} <ChevronRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function BatchCard({ batch, day }: { batch: PartnerBatch; day: BatchDay | undefined }) {
  const d = day ?? { stops: 0, meals: 0, done: 0, issues: 0, open: 0, cash: 0 };
  const allDone = d.stops > 0 && d.open === 0;
  return (
    <Link
      href={`/partner/batch/${batch.id}`}
      className="block rounded-2xl border border-[#e2e8d5] bg-white p-4 shadow-sm active:bg-gray-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold">{batch.name}</p>
          <p className="text-sm text-gray-500">
            {[batch.area, batch.timeWindow ? RUN_LABEL[batch.timeWindow] ?? batch.timeWindow : null, batch.role === "secondary" ? "Backup" : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        </div>
        <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-gray-400" />
      </div>

      {d.stops === 0 ? (
        <p className="mt-3 text-sm text-gray-400">No deliveries today.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="font-medium">
              {d.stops} stop{d.stops === 1 ? "" : "s"} · {d.meals} meal{d.meals === 1 ? "" : "s"}
            </span>
            <span className={allDone ? "flex items-center gap-1 font-semibold text-[#1B5E20]" : "text-gray-500"}>
              {allDone && <CheckCircle2 className="h-4 w-4" />}
              {d.done}/{d.stops} done
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-[#1B5E20]" style={{ width: `${Math.round((d.done / d.stops) * 100)}%` }} />
          </div>
          {(d.issues > 0 || d.cash > 0) && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              {d.issues > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> {d.issues} problem{d.issues === 1 ? "" : "s"}
                </span>
              )}
              {d.cash > 0 && (
                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-amber-800">
                  <Banknote className="h-3.5 w-3.5" /> Collect {rupees(d.cash)}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </Link>
  );
}
