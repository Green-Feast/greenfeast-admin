import { supabaseAdmin } from "./supabase-admin"

/**
 * The pincode check the app and the database use (`service_pincodes`, 093).
 * Returns an error sentence, or null when the pincode is served.
 */
export async function servicePincodeError(raw: string): Promise<string | null> {
  const pincode = raw.replace(/\s/g, "")
  if (!/^\d{6}$/.test(pincode)) return "Enter the 6-digit pincode."
  const { data, error } = await supabaseAdmin
    .from("service_pincodes").select("is_active").eq("pincode", pincode).maybeSingle()
  if (error) return `Couldn't check the pincode: ${error.message}`
  if (!data) return `${pincode} isn't a Jaipur pincode.`
  if (!data.is_active) return `${pincode} is in Jaipur district but outside the delivery area (switch it on in service_pincodes to allow it).`
  return null
}
