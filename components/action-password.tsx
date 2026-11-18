"use client"

// The second check before a sensitive action (money moving, a plan going live,
// a customer reset or deleted): the admin types their action password, which
// the server verifies (lib/audit.ts → sensitive) and logs. Mounted once in the
// admin layout; any client component calls
//
//   const askPassword = useActionPassword()
//   const pw = await askPassword("Record ₹7,200 cash for GF-000123")
//   if (pw === null) return            // cancelled
//   const res = await someAction(..., pw)

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ShieldCheck, X } from "lucide-react"

type Ask = (what: string) => Promise<string | null>

const Ctx = createContext<Ask | null>(null)

export function useActionPassword(): Ask {
  const ask = useContext(Ctx)
  if (!ask) throw new Error("useActionPassword needs <ActionPasswordProvider> (admin layout).")
  return ask
}

export function ActionPasswordProvider({ children }: { children: React.ReactNode }) {
  const [what, setWhat] = useState<string | null>(null)
  const [value, setValue] = useState("")
  const resolver = useRef<((v: string | null) => void) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ask = useCallback<Ask>((w) => {
    // A second ask while one is open cancels the first.
    resolver.current?.(null)
    setValue("")
    setWhat(w)
    return new Promise<string | null>((resolve) => { resolver.current = resolve })
  }, [])

  const finish = (v: string | null) => {
    resolver.current?.(v)
    resolver.current = null
    setWhat(null)
    setValue("")
  }

  useEffect(() => {
    if (what !== null) setTimeout(() => inputRef.current?.focus(), 0)
  }, [what])

  return (
    <Ctx.Provider value={ask}>
      {children}
      {what !== null && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => finish(null)} />
          <form
            className="relative z-10 w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (value) finish(value) }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#1B5E20]" />
                <h3 className="text-base font-semibold text-[#1A1A1A]">Action password</h3>
              </div>
              <button type="button" onClick={() => finish(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-gray-600">{what}</p>
            <input
              ref={inputRef}
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Your action password"
              className="w-full h-10 rounded-lg border border-[#e2e8d5] bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]/30 focus:border-[#1B5E20]"
            />
            <p className="text-xs text-gray-400">
              This action is logged with your name. Not set up yet?{" "}
              <Link href="/security" className="text-[#1B5E20] hover:underline" onClick={() => finish(null)}>Set your action password</Link>.
            </p>
            <div className="flex gap-3">
              <button type="button" onClick={() => finish(null)} className="flex-1 h-10 rounded-xl border border-[#e2e8d5] text-sm font-medium text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button type="submit" disabled={!value} className="flex-1 h-10 rounded-xl bg-[#1B5E20] text-sm font-medium text-white hover:bg-[#155116] disabled:opacity-40">
                Confirm
              </button>
            </div>
          </form>
        </div>
      )}
    </Ctx.Provider>
  )
}
