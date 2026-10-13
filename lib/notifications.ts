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

// {key} → value. {name} is filled per recipient with their first name.
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>) {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : whole
  );
}

function firstName(name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first && first !== "Unknown" && first !== "Customer" ? first : "there";
}

const EXPO_BATCH = 100;

// Sends to every recipient over every requested channel, logs one row per
// recipient into the in-app notification log (`notifications` — what the
// mobile app's own notification centre reads), and returns per-recipient
// outcomes for the caller to fold into a notification_broadcasts row.
// {name} in the title or body becomes each recipient's first name. Push goes
// out in batches (one token lookup, Expo's 100-per-request limit), so a send
// to every customer doesn't make one round trip per person.
export async function notifyUsers(
  recipients: Recipient[],
  title: string,
  body: string,
  type: string,
  channels: Channel[]
): Promise<RecipientResult[]> {
  if (recipients.length === 0) return [];

  const messages = recipients.map((r) => {
    const vars = { name: firstName(r.name) };
    return { r, title: renderTemplate(title, vars), body: renderTemplate(body, vars) };
  });
  const results = new Map<string, RecipientResult>(
    recipients.map((r) => [r.user_id, { user_id: r.user_id, name: r.name }])
  );

  if (channels.includes("push")) {
    const tokens = new Map<string, string>();
    const ids = recipients.map((r) => r.user_id);
    for (let i = 0; i < ids.length; i += 500) {
      const { data } = await supabaseAdmin
        .from("users")
        .select("id, expo_push_token")
        .in("id", ids.slice(i, i + 500));
      for (const u of (data ?? []) as { id: string; expo_push_token: string | null }[]) {
        if (u.expo_push_token) tokens.set(u.id, u.expo_push_token);
      }
    }

    const withToken = messages.filter((m) => tokens.has(m.r.user_id));
    for (const m of messages) {
      if (!tokens.has(m.r.user_id)) results.get(m.r.user_id)!.push = "no_token";
    }
    for (let i = 0; i < withToken.length; i += EXPO_BATCH) {
      const part = withToken.slice(i, i + EXPO_BATCH);
      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(part.map((m) => ({
            to: tokens.get(m.r.user_id), title: m.title, body: m.body, sound: "default",
          }))),
        });
        const json = await res.json().catch(() => null);
        const tickets = Array.isArray(json?.data) ? json.data : [];
        part.forEach((m, k) => {
          results.get(m.r.user_id)!.push = res.ok && tickets[k]?.status !== "error" ? "sent" : "failed";
        });
      } catch {
        for (const m of part) results.get(m.r.user_id)!.push = "failed";
      }
    }
  }

  if (channels.includes("whatsapp")) {
    for (const m of messages) {
      results.get(m.r.user_id)!.whatsapp = await sendWhatsApp(m.r.phone, m.body);
    }
  }

  for (let i = 0; i < messages.length; i += 500) {
    await supabaseAdmin.from("notifications").insert(
      messages.slice(i, i + 500).map((m) => ({ user_id: m.r.user_id, title: m.title, body: m.body, type }))
    );
  }

  return recipients.map((r) => results.get(r.user_id)!);
}

export type NotificationTemplate = {
  key: string;
  kind: "event" | "saved";
  label: string;
  description: string | null;
  title: string;
  body: string;
  enabled: boolean;
  placeholders: string[];
  default_title: string | null;
  default_body: string | null;
  sort_order: number;
  updated_at: string;
  updated_by: string | null;
};

// One automated message (notification_templates, edited in Notifications →
// Automated messages). Returns null when the template is switched off — the
// caller then sends nothing.
export async function notifyEvent(
  key: string,
  recipients: Recipient[],
  vars: Record<string, string | number | null | undefined>,
  type = "custom"
): Promise<{ title: string; body: string; results: RecipientResult[] } | null> {
  if (recipients.length === 0) return null;
  const { data: t } = await supabaseAdmin
    .from("notification_templates")
    .select("title, body, enabled")
    .eq("key", key)
    .maybeSingle();
  if (!t || !t.enabled) return null;
  // {name} stays in for notifyUsers to fill per recipient.
  const title = renderTemplate(t.title, { ...vars, name: "{name}" });
  const body = renderTemplate(t.body, { ...vars, name: "{name}" });
  const results = await notifyUsers(recipients, title, body, type, ["push"]);
  return { title, body, results };
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
