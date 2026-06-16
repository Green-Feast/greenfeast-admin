"use server"

import { revalidatePath } from "next/cache"
import { supabaseAdmin } from "@/lib/supabase"

export async function upsertPartner(data: {
  id?: string
  name: string
  phone: string
  alternate_phone?: string
  aadhaar_number?: string
  pan_number?: string
  dl_number?: string
  vehicle_rc_number?: string
  notes?: string
  status: "active" | "inactive"
}) {
  const { id, ...rest } = data
  if (id) {
    const { error } = await supabaseAdmin.from("delivery_partners").update(rest).eq("id", id)
    if (error) throw error
  } else {
    const { error } = await supabaseAdmin.from("delivery_partners").insert(rest)
    if (error) throw error
  }
  revalidatePath("/delivery-partners")
}

export async function createSignedUploadUrl(partnerId: string, docType: string, fileName: string) {
  const ext = fileName.split(".").pop() ?? "pdf"
  const path = `${partnerId}/${docType}.${ext}`
  const { data, error } = await supabaseAdmin.storage
    .from("partner-docs")
    .createSignedUploadUrl(path, { upsert: true })
  if (error) throw error
  return { token: data.token, path }
}

export async function saveDocUrl(partnerId: string, docType: string, path: string) {
  const field = `${docType}_doc_url`
  const { error } = await supabaseAdmin.from("delivery_partners")
    .update({ [field]: path })
    .eq("id", partnerId)
  if (error) throw error
  revalidatePath("/delivery-partners")
}

export async function getSignedViewUrl(path: string) {
  const { data } = await supabaseAdmin.storage
    .from("partner-docs")
    .createSignedUrl(path, 60)
  return data?.signedUrl ?? null
}
