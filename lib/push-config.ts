// Web push for the admins' alerts (migration 063). The public VAPID key —
// safe to ship; the private half is a Supabase secret used by the admin-push
// edge function, which does the sending.
export const VAPID_PUBLIC_KEY = "BGRokw0wBy7iBUYBrYWKDDDrG72MLuhAtprAcbJTVZuRonwDXEhuVp1HsqMnButNECfH-bm1cNFjqmTDFZBQYnc";
