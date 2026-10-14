"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireAdmin, requireAdminStrict } from "@/lib/auth";
import { isTestMode } from "@/lib/mode";
import { notifyUsers, logBroadcast, type Channel } from "@/lib/notifications";

export type AudienceMode = "all" | "subscribers" | "selected";

export type SendBroadcastInput = {
  title: string;
  body: string;
  channels: Channel[];
  type: "promotional" | "custom";
  audience: AudienceMode;
  userIds?: string[]; // audience "selected"
  audienceDescription: string;
};

// Recipients are worked out here, not trusted from the page: everyone in the
// current Live/Test world, everyone with a plan, or the people picked.
async function resolveRecipients(audience: AudienceMode, userIds: string[] | undefined, isTest: boolean) {
  let ids: string[] | null = null;
  if (audience === "subscribers") {
    const { data } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id, users!inner ( is_test )")
      .in("status", ["active", "paused", "pending"])
      .eq("users.is_test", isTest);
    ids = Array.from(new Set(((data ?? []) as { user_id: string }[]).map((s) => s.user_id)));
  } else if (audience === "selected") {
    ids = Array.from(new Set(userIds ?? []));
    if (ids.length === 0) return [];
  }

  const rows: { id: string; name: string | null; phone: string | null }[] = [];
  if (ids === null) {
    const { data } = await supabaseAdmin.from("users").select("id, name, phone").eq("is_test", isTest);
    rows.push(...((data ?? []) as typeof rows));
  } else {
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabaseAdmin
        .from("users").select("id, name, phone").eq("is_test", isTest).in("id", ids.slice(i, i + 300));
      rows.push(...((data ?? []) as typeof rows));
    }
  }
  return rows.map((u) => ({ user_id: u.id, name: u.name ?? "Customer", phone: u.phone }));
}

export async function sendBroadcast(input: SendBroadcastInput) {
  const admin = await requireAdminStrict();

  if (!input.title.trim() || !input.body.trim()) {
    throw new Error("Title and message are required.");
  }
  if (input.channels.length === 0) {
    throw new Error("Select at least one channel.");
  }
  const recipients = await resolveRecipients(input.audience, input.userIds, await isTestMode());
  if (recipients.length === 0) {
    throw new Error("Nobody to send to — pick at least one recipient.");
  }

  const results = await notifyUsers(recipients, input.title.trim(), input.body.trim(), input.type, input.channels);

  await logBroadcast({
    type: input.type,
    title: input.title.trim(),
    body: input.body.trim(),
    channels: input.channels,
    audience: { mode: input.audience, description: input.audienceDescription, count: recipients.length },
    results,
    createdBy: admin.email,
  });

  revalidatePath("/notifications");

  return {
    sent: results.length,
    pushSent: results.filter((r) => r.push === "sent").length,
    whatsappSent: results.filter((r) => r.whatsapp === "sent").length,
    results,
  };
}

// ── Automated messages ────────────────────────────────────────────────────

export async function saveTemplate(key: string, input: { title: string; body: string; enabled: boolean }) {
  const admin = await requireAdmin();
  if (!input.title.trim() || !input.body.trim()) throw new Error("Title and message can't be empty.");
  const { error } = await supabaseAdmin
    .from("notification_templates")
    .update({
      title: input.title.trim(),
      body: input.body.trim(),
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
      updated_by: admin.email,
    })
    .eq("key", key);
  if (error) throw new Error(error.message);
  revalidatePath("/notifications");
}

export async function resetTemplate(key: string) {
  const admin = await requireAdmin();
  const { data: t } = await supabaseAdmin
    .from("notification_templates").select("default_title, default_body").eq("key", key).maybeSingle();
  if (!t?.default_title || !t?.default_body) throw new Error("No default text for this message.");
  const { error } = await supabaseAdmin
    .from("notification_templates")
    .update({ title: t.default_title, body: t.default_body, updated_at: new Date().toISOString(), updated_by: admin.email })
    .eq("key", key);
  if (error) throw new Error(error.message);
  revalidatePath("/notifications");
  return { title: t.default_title as string, body: t.default_body as string };
}

// ── Saved messages (promotions etc.) ──────────────────────────────────────

export async function saveMessage(input: { key?: string; label: string; title: string; body: string }) {
  const admin = await requireAdmin();
  if (!input.label.trim() || !input.title.trim() || !input.body.trim()) {
    throw new Error("Give it a name, a title and a message.");
  }
  const row = {
    label: input.label.trim(),
    title: input.title.trim(),
    body: input.body.trim(),
    updated_at: new Date().toISOString(),
    updated_by: admin.email,
  };
  const { error } = input.key
    ? await supabaseAdmin.from("notification_templates").update(row).eq("key", input.key).eq("kind", "saved")
    : await supabaseAdmin.from("notification_templates").insert({ ...row, key: `saved_${randomUUID()}`, kind: "saved" });
  if (error) throw new Error(error.message);
  revalidatePath("/notifications");
}

export async function deleteMessage(key: string) {
  await requireAdmin();
  const { error } = await supabaseAdmin.from("notification_templates").delete().eq("key", key).eq("kind", "saved");
  if (error) throw new Error(error.message);
  revalidatePath("/notifications");
}
