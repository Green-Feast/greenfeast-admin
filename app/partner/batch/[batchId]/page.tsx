import Link from "next/link";
import { requirePartner } from "@/lib/partner-auth";
import { partnerBatches, batchStops, SLOT_HOURS, RUN_LABEL } from "@/lib/partner-data";
import { istToday, addDaysISO } from "@/lib/ist";
import { PartnerHeader, AutoRefresh } from "../../ui";
import { BatchClient } from "./batch-client";

export const dynamic = "force-dynamic";

export default async function PartnerBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const partner = await requirePartner();
  const { batchId } = await params;
  const { date: asked } = await searchParams;

  const today = istToday();
  // Today to act on; a week either side to look at.
  const date =
    asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked >= addDaysISO(today, -7) && asked <= addDaysISO(today, 7)
      ? asked
      : today;

  const batch = (await partnerBatches(partner.partnerId)).find((b) => b.id === batchId);
  if (!batch) {
    return (
      <main>
        <PartnerHeader title="Batch not found" back="/partner" />
        <p className="m-4 rounded-2xl border border-dashed border-[#e2e8d5] bg-white p-6 text-center text-sm text-gray-500">
          This batch isn&apos;t assigned to you any more.{" "}
          <Link href="/partner" className="font-medium text-[#1B5E20] underline">Back to today</Link>
        </p>
      </main>
    );
  }

  const stops = await batchStops(batch.id, date, batch.slot, partner.isTest);
  const dateLabel = new Date(date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const subtitle = [
    date === today ? "Today" : dateLabel,
    `${batch.slot === "lunch" ? "Lunch" : "Dinner"} ${SLOT_HOURS[batch.slot]}`,
    batch.timeWindow ? RUN_LABEL[batch.timeWindow] ?? batch.timeWindow : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="pb-28">
      {date === today && <AutoRefresh seconds={60} />}
      <PartnerHeader title={batch.name} subtitle={subtitle} back="/partner" />
      <BatchClient batchId={batch.id} stops={stops} canAct={date === today} dateLabel={date === today ? "today" : dateLabel} />
    </main>
  );
}
