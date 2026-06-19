import { createClient } from '@supabase/supabase-js'

// Browser/client-safe client — anon key, respects RLS.
//
// IMPORTANT: do NOT create the service-role client in this module. It is imported
// by client components (e.g. the delivery-partners doc uploader), and referencing
// SUPABASE_SERVICE_ROLE_KEY — which is undefined in the browser — makes
// createClient throw "supabaseKey is required" during hydration (the page renders
// for a frame, then the client error tears it down). The admin client lives in
// ./supabase-admin and must only ever be imported by server code.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
