import "server-only";
import { supabaseAdmin } from "./supabase-admin";

export type Channel = "push" | "whatsapp";
export type SendOutcome =
  | "sent"
  | "no_token"
  | "no_phone"
  | "not_configured"
  | "failed";

export type RecipientResult = {
  user_id: string;
  name: string;
  push?: SendOutcome;
  whatsapp?: SendOutcome;
};

// WhatsApp sending has no provider wired up yet — this is deliberately a
// clean no-op rather than a half-built integration. Every WhatsApp Business
// API provider (Meta Cloud API direct, Gupshup, Interakt, AiSensy, ...) has
// a different request shape and — regardless of provider — requires
// pre-approved message templates for anything sent outside a 24h window
// since the customer last messaged you, which every trigger here (renewal,
// delivery status, promotional) is. Once a provider is picked, implement
// the actual HTTP call inside sendWhatsApp() and flip isWhatsAppConfigured()
// to check for its real env vars.
export function isWhatsAppConfigured(): boolean {
  return !!process.env.WHATSAPP_PROVIDER && !!process.env.WHATSAPP_API_KEY;
}

export async function sendPush(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<SendOutcome> {
  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("expo_push_token")
    .eq("id", userId)
    .maybeSingle();

  const token = userRow?.expo_push_token;
  if (!token) return "no_token";

  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, data }),
    });
    const json = await res.json();
    if (json?.data?.status === "error") return "failed";
    return "sent";
  } catch {
    return "failed";
  }
}

export async function sendWhatsApp(
  phone: string | null,
  _message: string
): Promise<SendOutcome> {
  if (!phone) return "no_phone";
  if (!isWhatsAppConfigured()) return "not_configured";

  // TODO: call the chosen provider's API here once one is set up.
  return "not_configured";
}

type Recipient = { user_id: string; name: string; phone: string | null };

// Sends to every recipient over every requested channel, logs one row per
// recipient into the in-app notification log (`notifications` — what the
// mobile app's own notification centre reads), and returns per-recipient
// outcomes for the caller to fold into a notification_broadcasts row.
export async function notifyUsers(
  recipients: Recipient[],
  title: string,
  body: string,
  type: string,
  channels: Channel[]
): Promise<RecipientResult[]> {
  const results: RecipientResult[] = [];

  for (const r of recipients) {
    const result: RecipientResult = { user_id: r.user_id, name: r.name };

    if (channels.includes("push")) {
      result.push = await sendPush(r.user_id, title, body);
    }
    if (channels.includes("whatsapp")) {
      result.whatsapp = await sendWhatsApp(r.phone, body);
    }

    await supabaseAdmin.from("notifications").insert({
      user_id: r.user_id,
      title,
      body,
      type,
    });

    results.push(result);
  }

  return results;
}

export async function logBroadcast(params: {
  type: string;
  title: string;
  body: string;
  channels: Channel[];
  audience: Record<string, unknown>;
  results: RecipientResult[];
  createdBy?: string | null;
}) {
  const pushSent = params.results.filter((r) => r.push === "sent").length;
  const whatsappSent = params.results.filter((r) => r.whatsapp === "sent").length;

  await supabaseAdmin.from("notification_broadcasts").insert({
    type: params.type,
    title: params.title,
    body: params.body,
    channels: params.channels,
    audience: params.audience,
    recipient_count: params.results.length,
    push_sent_count: pushSent,
    whatsapp_sent_count: whatsappSent,
    results: params.results,
    created_by: params.createdBy ?? null,
  });
}
