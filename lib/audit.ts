import "server-only";
import { randomUUID } from "crypto";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { supabaseAdmin } from "./supabase-admin";
import { requireAdmin, requireAdminStrict, type AdminUser } from "./auth";

// Every admin action leaves a row in admin_audit_log (migration 092). The
// table is append-only — the database refuses updates and deletes, even with
// the service key — so the log is a permanent record of who did what.
//
//   audited(action, meta, fn)              any admin action
//   sensitive(action, password, meta, fn)  money / account actions: checks the
//                                          admin's action password first and
//                                          hands fn an action id that the
//                                          database stamps on the ledger rows
//                                          and payments the action makes.

export type AuditMeta = {
  userId?: string | null;
  subscriptionId?: string | null;
  ref?: string | null;
  amountPaise?: number | null;
  details?: Record<string, unknown>;
};

export type SensitiveCtx = {
  admin: AdminUser;
  actionId: string;
  /** Add what the action learnt (customer, amount, ids) to its log row. */
  note: (meta: AuditMeta) => void;
};

type Outcome = "ok" | "error" | "denied";

async function requestInfo() {
  try {
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent") || null,
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

function merge(a: AuditMeta, b: AuditMeta): AuditMeta {
  return {
    userId: b.userId ?? a.userId,
    subscriptionId: b.subscriptionId ?? a.subscriptionId,
    ref: b.ref ?? a.ref,
    amountPaise: b.amountPaise ?? a.amountPaise,
    details: { ...(a.details ?? {}), ...(b.details ?? {}) },
  };
}

// Never put secrets in a log row.
const SECRET_KEYS = /password|secret|token|otp/i;
function clean(details: Record<string, unknown> | undefined) {
  if (!details) return {};
  return Object.fromEntries(Object.entries(details).filter(([k]) => !SECRET_KEYS.test(k)));
}

async function write(
  admin: AdminUser | null,
  action: string,
  outcome: Outcome,
  meta: AuditMeta,
  opts: { id?: string; sensitive?: boolean; passwordChecked?: boolean; error?: string | null }
) {
  const info = await requestInfo();
  const { error } = await supabaseAdmin.from("admin_audit_log").insert({
    id: opts.id,
    admin_id: admin?.id ?? null,
    admin_email: admin?.email ?? null,
    action,
    sensitive: opts.sensitive ?? false,
    password_checked: opts.passwordChecked ?? false,
    outcome,
    error: opts.error ?? null,
    target_user: meta.userId ?? null,
    target_subscription: meta.subscriptionId ?? null,
    target_ref: meta.ref ?? null,
    amount_paise: meta.amountPaise ?? null,
    details: { ...clean(meta.details), ip: info.ip, user_agent: info.userAgent },
  });
  if (error) console.error(`admin_audit_log insert failed for ${action}:`, error.message);
}

function resultError(result: unknown): string | null {
  if (result && typeof result === "object" && "ok" in result && (result as { ok: unknown }).ok === false) {
    return String((result as { error?: unknown }).error ?? "failed");
  }
  return null;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Log an admin action: runs fn, then records ok / error. Errors still throw. */
export async function audited<T>(action: string, meta: AuditMeta, fn: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    unstable_rethrow(e); // redirects / not-found aren't failures
    const admin = await requireAdmin().catch(() => null);
    await write(admin, action, "error", meta, { error: errorText(e) });
    throw e;
  }
  const admin = await requireAdmin().catch(() => null);
  const err = resultError(result);
  await write(admin, action, err ? "error" : "ok", meta, { error: err });
  return result;
}

export type Denied = { ok: false; error: string; code?: string };

/**
 * A sensitive action: the admin's action password first (5 wrong tries lock
 * it for 15 minutes), then fn with an action id. Wrong passwords are logged
 * as 'denied'; fn's thrown errors come back as { ok: false, error }.
 */
export async function sensitive<T extends { ok: boolean }>(
  action: string,
  password: string | null | undefined,
  meta: AuditMeta,
  fn: (ctx: SensitiveCtx) => Promise<T>
): Promise<T | Denied> {
  const admin = await requireAdminStrict();
  const { data, error } = await supabaseAdmin.rpc("admin_check_action_password", {
    p_admin: admin.id,
    p_password: password ?? "",
  });
  const check = data as { ok?: boolean; error?: string; code?: string } | null;
  if (error || !check?.ok) {
    const msg = check?.error ?? `Could not check the action password: ${error?.message ?? "unknown error"}`;
    await write(admin, action, "denied", meta, { sensitive: true, error: msg });
    return { ok: false, error: msg, code: check?.code ?? "error" };
  }

  const actionId = randomUUID();
  let collected = meta;
  const ctx: SensitiveCtx = { admin, actionId, note: (m) => { collected = merge(collected, m); } };
  try {
    const result = await fn(ctx);
    const err = resultError(result);
    await write(admin, action, err ? "error" : "ok", collected, { id: actionId, sensitive: true, passwordChecked: true, error: err });
    return result;
  } catch (e) {
    unstable_rethrow(e);
    await write(admin, action, "error", collected, { id: actionId, sensitive: true, passwordChecked: true, error: errorText(e) });
    return { ok: false, error: errorText(e) };
  }
}

/** Supabase RPC errors carry the database's own message (RAISE EXCEPTION). */
export function dbError(e: { message?: string } | null | undefined, fallback: string) {
  return e?.message?.replace(/^.*?ERROR:\s*/, "") || fallback;
}
