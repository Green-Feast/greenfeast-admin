"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { notifyUsers, logBroadcast, type Channel } from "@/lib/notifications";

export type SendBroadcastInput = {
  title: string;
  body: string;
  channels: Channel[];
  type: "promotional" | "custom";
  recipients: { userId: string; name: string; phone: string | null }[];
  audienceDescription: string;
};

export async function sendBroadcast(input: SendBroadcastInput) {
  const admin = await requireAdmin();

  if (!input.title.trim() || !input.body.trim()) {
    throw new Error("Title and message are required.");
  }
  if (input.recipients.length === 0) {
    throw new Error("Select at least one recipient.");
  }
  if (input.channels.length === 0) {
    throw new Error("Select at least one channel.");
  }

  const results = await notifyUsers(
    input.recipients.map((r) => ({ user_id: r.userId, name: r.name, phone: r.phone })),
    input.title.trim(),
    input.body.trim(),
    input.type,
    input.channels
  );

  await logBroadcast({
    type: input.type,
    title: input.title.trim(),
    body: input.body.trim(),
    channels: input.channels,
    audience: { description: input.audienceDescription, count: input.recipients.length },
    results,
    createdBy: admin.email,
  });

  revalidatePath("/notifications");

  return {
    sent: results.length,
    pushSent: results.filter((r) => r.push === "sent").length,
    whatsappSent: results.filter((r) => r.whatsapp === "sent").length,
  };
}
