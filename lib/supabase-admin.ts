import { createClient } from '@supabase/supabase-js'

// Server-only admin client — bypasses RLS via the service-role key.
//
// NEVER import this from a client component ("use client"). Doing so pulls the
// service key reference into the browser bundle, where it is undefined and makes
// createClient throw. Import only from server components and "use server" actions.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)
