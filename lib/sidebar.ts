// Shared by the admin layout (server, reads it) and AdminShell (client, writes
// it). Kept out of the "use client" file: a server component importing a value
// from one gets a client reference, not the string.
export const SIDEBAR_COOKIE = "gf_sidebar";
