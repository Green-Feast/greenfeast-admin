"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { MODE_COOKIE, type DataMode } from "@/lib/mode";

export async function setDataMode(mode: DataMode) {
  await requireAdmin();
  const jar = await cookies();
  jar.set(MODE_COOKIE, mode === "test" ? "test" : "live", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
