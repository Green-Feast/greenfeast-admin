import "server-only";
import { cookies } from "next/headers";
import { supabaseAdmin } from "./supabase-admin";

// The admin works in one of two data worlds:
//   live — real customers (the default)
//   test — every account from before go-live, and test accounts made since
// users.is_test decides which world an account belongs to (migration 051).
// Every page and action that lists or acts on customers filters by it, so
// Live never shows — or bills, or cooks for — a test account.
export type DataMode = "live" | "test";
export const MODE_COOKIE = "gf_mode";

export async function getDataMode(): Promise<DataMode> {
  const jar = await cookies();
  return jar.get(MODE_COOKIE)?.value === "test" ? "test" : "live";
}

export async function isTestMode(): Promise<boolean> {
  return (await getDataMode()) === "test";
}

// Ids of every account in the current mode — for queries that can't filter
// through an embedded users join (bulk order updates by batch, etc.).
export async function modeUserIds(isTest: boolean): Promise<string[]> {
  const { data } = await supabaseAdmin.from("users").select("id").eq("is_test", isTest);
  return (data ?? []).map((u: { id: string }) => u.id);
}
