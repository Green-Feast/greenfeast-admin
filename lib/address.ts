// Addresses since migration 093: line1 (house / flat, building, street),
// line2 (area / colony), landmark, pincode, city (Jaipur, set by the database
// from the pincode), lat / lng (the pin a rider navigates to).

export type AddressParts = {
  line1?: string | null
  line2?: string | null
  landmark?: string | null
  pincode?: string | null
}

/** "12 Gandhi Path, Vaishali Nagar" — the street address without the landmark. */
export function addressText(a: AddressParts | null | undefined): string {
  if (!a) return ""
  return [a.line1, a.line2].map((s) => s?.trim()).filter(Boolean).join(", ")
}

/** Line 1, line 2, landmark and pincode — for delivery sheets. */
export function fullAddressText(a: AddressParts | null | undefined, withPincode = false): string {
  if (!a) return ""
  return [a.line1, a.line2, a.landmark, withPincode ? a.pincode : null]
    .map((s) => s?.trim()).filter(Boolean).join(", ")
}

/** Google Maps directions to the pin (or, without one, to the typed address). */
export function mapsLink(a: AddressParts & { lat?: number | null; lng?: number | null }): string {
  if (a.lat != null && a.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddressText(a, true) + ", Jaipur")}`
}
