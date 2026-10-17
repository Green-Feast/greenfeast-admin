// The delivery partner app (/partner) keeps its Supabase session in its own
// cookie, separate from the admin's. A partner's session therefore never
// opens an admin page (proxy.ts and requireAdmin only read the admin
// cookie), and an admin can try the partner app in the same browser without
// being signed out of the dashboard.
//
// No "server-only" here: proxy.ts imports it too.
export const PARTNER_COOKIE = "sb-gf-partner";

export function isPartnerPath(pathname: string): boolean {
  return pathname === "/partner" || pathname.startsWith("/partner/");
}
