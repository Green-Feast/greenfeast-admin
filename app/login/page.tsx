"use client";

import { useActionState } from "react";
import Image from "next/image";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FBF7] px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-11 h-11 rounded-xl overflow-hidden">
            <Image src="/logo.png" alt="" width={44} height={44} className="w-full h-full object-cover" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="font-bold text-xl leading-none tracking-tight text-[#1B5E20]">
              Green
            </span>
            <span className="font-bold text-xl leading-none tracking-tight text-[#C9A400]">
              Feast
            </span>
          </div>
          <p className="text-sm text-neutral-500">Admin dashboard</p>
        </div>

        <form action={action} className="space-y-4 bg-white rounded-2xl p-6 shadow-sm border border-black/5">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium text-neutral-700">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium text-neutral-700">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-[#1B5E20] focus:ring-1 focus:ring-[#1B5E20]"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-[#1B5E20] text-white text-sm font-semibold py-2.5 hover:bg-[#164d1a] transition-colors disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
