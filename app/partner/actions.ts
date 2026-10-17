"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requirePartnerStrict, type PartnerSession } from "@/lib/partner-auth";
import { partnerBatches } from "@/lib/partner-data";
import { advanceBatch, deliverOrders, type MealSlot, type DeliverResult } from "@/lib/delivery";
import { modeUserIds } from "@/lib/mode";
import { istToday } from "@/lib/ist";
import { rupees } from "@/lib/cash";
import { PROBLEM_REASONS } from "./reasons";

export type PartnerResult = { ok: true; message: string } | { ok: false; error: string };

// Everything a partner does is checked here, not trusted from the page:
// only today's meals, only on batches they're assigned to (primary or
// secondary), only customers in their own Live/Test world.

type OwnOrder = { id: string; status: string; meal_slot: MealSlot; batch_id: string; subscription_id: string; user_id: string };

async function ownBatch(p: PartnerSession, batchId: string) {
  const batch = (await partnerBatches(p.partnerId)).find((b) => b.id === batchId);
  if (!batch) throw new Error("That batch isn't yours — ask the office.");
  return batch;
}

async function ownOrders(p: PartnerSession, orderIds: string[]): Promise<OwnOrder[]> {
  if (orderIds.length === 0 || orderIds.length > 20) throw new Error("Nothing to update.");
  const mine = new Set((await partnerBatches(p.partnerId)).map((b) => b.id));
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, status, meal_slot, batch_id, delivery_date, subscription_id, user_id, users!inner ( is_test )")
    .in("id", orderIds);
  const rows = (data ?? []) as any[];
  const today = istToday();
  if (rows.length !== orderIds.length) throw new Error("Some of these meals aren't on your list any more. Refresh.");
  for (const o of rows) {
    const user = Array.isArray(o.users) ? o.users[0] : o.users;
    if (!mine.has(o.batch_id)) throw new Error("This stop moved to another batch. Refresh.");
    if (o.delivery_date !== today) throw new Error("Only today's meals can be marked.");
    if (!!user?.is_test !== p.isTest) throw new Error("This stop isn't on your list.");
  }
  return rows;
}

function refreshPages(batchId?: string) {
  revalidatePath("/partner");
  if (batchId) revalidatePath(`/partner/batch/${batchId}`);
  revalidatePath("/operations");
  revalidatePath("/dashboard");
}

function fail(e: unknown): PartnerResult {
  // A signed-out partner is redirected to the login page — let that through.
  unstable_rethrow(e);
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong. Try again." };
}

/** Picked up from the kitchen: the batch's meals go "on the way" with this partner. */
export async function startDelivery(batchId: string): Promise<PartnerResult> {
  try {
    const p = await requirePartnerStrict();
    const batch = await ownBatch(p, batchId);
    const userIds = await modeUserIds(p.isTest);
    const moved = await advanceBatch({
      batchId,
      date: istToday(),
      slot: batch.slot,
      status: "out_for_delivery",
      userIds,
      rider: { id: p.partnerId, name: p.name },
    });
    refreshPages(batchId);
    return {
      ok: true,
      message: moved.length > 0
        ? `${moved.length} meal${moved.length === 1 ? "" : "s"} on the way — customers have been told.`
        : "Everything here is already on the way.",
    };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Handed over: every open meal at the stop is billed through the same path
 * as the office's Delivered button. The optional photo was uploaded first
 * (deliveryPhotoUpload) and is linked here.
 */
export async function markDelivered(orderIds: string[], photoPath: string | null): Promise<PartnerResult & { results?: Record<string, DeliverResult> }> {
  try {
    const p = await requirePartnerStrict();
    const orders = await ownOrders(p, orderIds);
    if (photoPath && (!photoPath.startsWith(`${istToday()}/`) || !orders.some((o) => photoPath.includes(o.id)))) {
      return { ok: false, error: "That photo doesn't belong to this stop. Take it again." };
    }
    const open = orders.filter((o) => !["delivered", "cancelled", "skipped"].includes(o.status));
    if (open.length === 0) return { ok: true, message: "Already marked delivered." };

    const results = await deliverOrders(open.map((o) => o.id), open[0].meal_slot, {
      rider: { id: p.partnerId, name: p.name },
      photoPath,
    });
    refreshPages(open[0].batch_id);
    const short = Object.values(results).filter((r) => r === "skipped_insufficient").length;
    if (short > 0) {
      return {
        ok: false,
        error: "The customer's wallet is short — this meal was NOT billed and they've been told. Call the office before handing it over.",
      };
    }
    return { ok: true, message: "Delivered ✓", results };
  } catch (e) {
    return fail(e);
  }
}

/** Couldn't hand it over: stays unbilled, and the office decides (Operations). */
export async function reportProblem(orderIds: string[], reason: string, note: string): Promise<PartnerResult> {
  try {
    const p = await requirePartnerStrict();
    if (!(PROBLEM_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "Pick a reason." };
    const text = note.trim() ? `${reason} — ${note.trim().slice(0, 200)}` : reason;
    const orders = await ownOrders(p, orderIds);
    const open = orders.filter((o) => !["delivered", "cancelled", "skipped"].includes(o.status)).map((o) => o.id);
    if (open.length === 0) return { ok: false, error: "This stop is already done." };
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ delivery_issue: text, delivery_issue_at: new Date().toISOString(), delivery_partner_id: p.partnerId })
      .in("id", open);
    if (error) return { ok: false, error: error.message };
    refreshPages(orders[0].batch_id);
    return { ok: true, message: "Reported — the office will sort it out. You can still mark it delivered later." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Cash collected at the door. Nothing changes for the customer until the
 * office records it (Operations → Record) — this tells them it's with you.
 * Reporting again replaces the earlier amount.
 */
export async function reportCash(orderId: string, amountPaise: number, note: string): Promise<PartnerResult> {
  try {
    const p = await requirePartnerStrict();
    if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > 20_000_000) {
      return { ok: false, error: "Enter the amount you collected." };
    }
    const [order] = await ownOrders(p, [orderId]);
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("id, cod_due_paise")
      .eq("id", order.subscription_id)
      .maybeSingle();
    if (!sub || (sub.cod_due_paise ?? 0) <= 0) return { ok: false, error: "No cash is due from this customer." };

    const { data: existing } = await supabaseAdmin
      .from("cash_reports")
      .select("id")
      .eq("subscription_id", sub.id)
      .eq("partner_id", p.partnerId)
      .is("recorded_at", null)
      .is("dismissed_at", null)
      .maybeSingle();
    const row = { amount_paise: amountPaise, note: note.trim().slice(0, 200) || null, reported_at: new Date().toISOString(), order_id: orderId };
    const { error } = existing
      ? await supabaseAdmin.from("cash_reports").update(row).eq("id", existing.id)
      : await supabaseAdmin.from("cash_reports").insert({ ...row, subscription_id: sub.id, user_id: order.user_id, partner_id: p.partnerId });
    if (error) return { ok: false, error: error.message };
    refreshPages(order.batch_id);
    return { ok: true, message: `${rupees(amountPaise)} reported — hand it to the office.` };
  } catch (e) {
    return fail(e);
  }
}

/** The partner's own stop order for a batch, kept for next time. */
export async function saveRouteOrder(batchId: string, addressIds: string[]): Promise<PartnerResult> {
  try {
    const p = await requirePartnerStrict();
    await ownBatch(p, batchId);
    const ids = Array.from(new Set(addressIds)).slice(0, 200);
    if (ids.length === 0) return { ok: true, message: "" };
    // Only addresses that belong on this batch.
    const { data: valid } = await supabaseAdmin
      .from("addresses")
      .select("id")
      .in("id", ids)
      .or(`batch_id_lunch.eq.${batchId},batch_id_dinner.eq.${batchId}`);
    const ok = new Set((valid ?? []).map((a: { id: string }) => a.id));
    const rows = ids.filter((id) => ok.has(id)).map((address_id, seq) => ({
      batch_id: batchId,
      address_id,
      seq,
      updated_at: new Date().toISOString(),
    }));
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from("route_stops").upsert(rows, { onConflict: "batch_id,address_id" });
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath(`/partner/batch/${batchId}`);
    return { ok: true, message: "Stop order saved." };
  } catch (e) {
    return fail(e);
  }
}

/** A one-time upload link for the handover photo (private bucket). */
export async function deliveryPhotoUpload(orderId: string): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  try {
    const p = await requirePartnerStrict();
    await ownOrders(p, [orderId]);
    const path = `${istToday()}/${orderId}-${randomUUID().slice(0, 8)}.jpg`;
    const { data, error } = await supabaseAdmin.storage.from("delivery-photos").createSignedUploadUrl(path);
    if (error || !data) return { ok: false, error: "Couldn't start the photo upload." };
    return { ok: true, path, token: data.token };
  } catch (e) {
    const r = fail(e);
    return { ok: false, error: r.ok ? "" : r.error };
  }
}
