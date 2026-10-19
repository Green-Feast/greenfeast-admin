"use client"

import { useEffect, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BellRing, BellOff, Send, Smartphone, ChevronRight, AlertCircle, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { VAPID_PUBLIC_KEY } from "@/lib/push-config"
import { savePushSubscription, removePushSubscription, sendTestAlert, markAlertsRead } from "./actions"

type Alert = { id: string; kind: string; title: string; body: string; url: string; created_at: string }

const KIND_TONE: Record<string, string> = {
  reminder_out: "bg-amber-100 text-amber-800",
  reminder_delivered: "bg-red-100 text-red-700",
  reminder_yesterday: "bg-red-100 text-red-700",
  cash_reported: "bg-amber-100 text-amber-800",
  failed_drop: "bg-red-100 text-red-700",
  payment: "bg-green-100 text-green-700",
  refund_failed: "bg-red-100 text-red-700",
  test: "bg-gray-100 text-gray-600",
}
const KIND_LABEL: Record<string, string> = {
  reminder_out: "Reminder",
  reminder_delivered: "Reminder",
  reminder_yesterday: "Reminder",
  cash_reported: "Cash",
  failed_drop: "Delivery",
  payment: "Payment",
  refund_failed: "Refund",
  test: "Test",
}

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
}

type DeviceState = "checking" | "unsupported" | "needs-install" | "blocked" | "off" | "on"

export function AlertsClient({ alerts, readAt, deviceCount }: { alerts: Alert[]; readAt: string | null; deviceCount: number }) {
  const router = useRouter()
  // What was unread when the page opened stays highlighted after it's marked seen.
  const [seenBefore] = useState(readAt)
  const [device, setDevice] = useState<DeviceState>("checking")
  const [busy, startBusy] = useTransition()
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  function say(ok: boolean, text: string) {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4000)
  }

  // Opening the list = seen; the sidebar badge clears.
  useEffect(() => {
    markAlertsRead().then(() => router.refresh())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Is this browser able to get pushes, and is it already on?
  useEffect(() => {
    let cancelled = false
    async function check() {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setDevice(ios && !standalone ? "needs-install" : "unsupported")
        return
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setDevice("blocked")
        return
      }
      const reg = await navigator.serviceWorker.getRegistration("/admin-sw.js")
      const sub = await reg?.pushManager.getSubscription()
      if (!cancelled) setDevice(sub ? "on" : "off")
    }
    check().catch(() => !cancelled && setDevice("unsupported"))
    return () => { cancelled = true }
  }, [])

  function enable() {
    startBusy(async () => {
      try {
        const permission = await Notification.requestPermission()
        if (permission !== "granted") {
          setDevice(permission === "denied" ? "blocked" : "off")
          return say(false, "Notifications weren't allowed in this browser.")
        }
        const reg = await navigator.serviceWorker.register("/admin-sw.js")
        await navigator.serviceWorker.ready
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
        const res = await savePushSubscription(sub.toJSON(), navigator.userAgent)
        if (!res.ok) return say(false, res.error)
        setDevice("on")
        say(true, "Alerts are on for this device.")
        router.refresh()
      } catch (e) {
        say(false, e instanceof Error ? e.message : "Couldn't turn alerts on.")
      }
    })
  }

  function disable() {
    startBusy(async () => {
      const reg = await navigator.serviceWorker.getRegistration("/admin-sw.js")
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await removePushSubscription(sub.endpoint)
        await sub.unsubscribe()
      }
      setDevice("off")
      say(true, "Alerts are off for this device.")
      router.refresh()
    })
  }

  function test() {
    startBusy(async () => {
      const res = await sendTestAlert()
      say(res.ok, res.ok ? "Test sent — it should pop up in a few seconds." : res.error)
      router.refresh()
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <BellRing className="w-4 h-4 text-[#1B5E20]" />
        <span className="text-xs font-medium text-[#1B5E20] uppercase tracking-wider">For the team</span>
      </div>
      <h1 className="text-2xl font-bold text-[#1A1A1A]">Alerts</h1>
      <p className="text-sm text-gray-500 mt-0.5">
        Reminders to mark meals out for delivery and delivered, and updates like cash collected, failed drops and online payments. Real customers only.
      </p>

      {/* This device */}
      <div className="mt-6 rounded-2xl border border-[#e2e8d5] bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <Smartphone className="w-5 h-5 text-gray-400 mt-0.5" />
            <div>
              <p className="font-semibold text-[#1A1A1A]">Notifications on this device</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {device === "checking" && "Checking…"}
                {device === "on" && "On — alerts pop up here even when this tab is closed."}
                {device === "off" && "Off. Turn on to get alerts as notifications on this phone or computer."}
                {device === "blocked" && "Blocked in this browser's settings. Allow notifications for this site, then reload."}
                {device === "needs-install" && "On iPhone: tap Share → Add to Home Screen, open GreenFeast Admin from the Home Screen, sign in, and turn alerts on there."}
                {device === "unsupported" && "This browser can't get push notifications. Use Chrome or Edge (or the Home Screen app on iPhone)."}
              </p>
              <p className="text-xs text-gray-400 mt-1">{deviceCount} device{deviceCount === 1 ? "" : "s"} on for you.</p>
            </div>
          </div>
          <div className="flex gap-2">
            {device === "off" && (
              <button onClick={enable} disabled={busy} className="flex items-center gap-1.5 h-9 px-4 rounded-lg bg-[#1B5E20] text-white text-sm font-medium hover:bg-[#155116] disabled:opacity-40">
                <BellRing className="w-4 h-4" /> Turn on
              </button>
            )}
            {device === "on" && (
              <button onClick={disable} disabled={busy} className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                <BellOff className="w-4 h-4" /> Turn off
              </button>
            )}
            <button onClick={test} disabled={busy} className="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-[#1B5E20]/30 text-sm font-medium text-[#1B5E20] hover:bg-green-50 disabled:opacity-40">
              <Send className="w-4 h-4" /> Send test
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-4 border-t border-[#e2e8d5] pt-3">
          Reminders: 12:30 PM lunch not out for delivery · 2:30 PM lunch not delivered · 5:30 PM dinner not out · 7:30 PM dinner not delivered · 9:30 AM yesterday&apos;s unmarked meals.
        </p>
      </div>

      {/* The list */}
      <div className="mt-6 space-y-2">
        {alerts.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No alerts yet.</p>}
        {alerts.map((a) => {
          const unread = !seenBefore || a.created_at > seenBefore
          return (
            <Link
              key={a.id}
              href={a.url || "/dashboard"}
              className={cn(
                "flex items-start gap-3 rounded-xl border bg-white px-4 py-3 hover:shadow-sm transition-shadow",
                unread ? "border-[#1B5E20]/40 bg-green-50/40" : "border-[#e2e8d5]"
              )}
            >
              <span className={cn("mt-0.5 shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold", KIND_TONE[a.kind] ?? "bg-gray-100 text-gray-600")}>
                {KIND_LABEL[a.kind] ?? "Update"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#1A1A1A]">{a.title}</p>
                <p className="text-sm text-gray-600 mt-0.5">{a.body}</p>
                <p className="text-xs text-gray-400 mt-1">{when(a.created_at)}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 mt-1 shrink-0" />
            </Link>
          )
        })}
      </div>

      {toast && (
        <div className={cn("fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg text-sm text-white", toast.ok ? "bg-[#1B5E20]" : "bg-red-600")}>
          {toast.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {toast.text}
        </div>
      )}
    </div>
  )
}
