"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { partnerLogin, type PartnerLoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<PartnerLoginState, FormData>(partnerLogin, undefined);
  const [show, setShow] = useState(false);
  // Controlled, so a wrong password doesn't clear the number too (React
  // resets a form's uncontrolled fields after its action runs).
  const [phone, setPhone] = useState("");

  return (
    <form action={action} className="mt-8 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-gray-600">Phone number</span>
        <div className="mt-1.5 flex items-center h-14 rounded-xl border border-[#e2e8d5] bg-white focus-within:ring-2 focus-within:ring-[#1B5E20]/30">
          <span className="pl-4 pr-2 text-base text-gray-500">+91</span>
          <input
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="username"
            placeholder="98765 43210"
            maxLength={14}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            className="flex-1 h-full bg-transparent pr-4 text-lg outline-none"
          />
        </div>
      </label>
      <label className="block">
        <span className="text-sm font-medium text-gray-600">Password</span>
        <div className="mt-1.5 flex items-center h-14 rounded-xl border border-[#e2e8d5] bg-white focus-within:ring-2 focus-within:ring-[#1B5E20]/30">
          <input
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="off"
            autoCorrect="off"
            required
            className="flex-1 h-full bg-transparent px-4 text-lg outline-none"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="px-4 h-full text-gray-500"
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
          </button>
        </div>
      </label>

      {state?.error && (
        <p className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full h-14 rounded-xl bg-[#1B5E20] text-white text-base font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {pending && <Loader2 className="w-5 h-5 animate-spin" />}
        Sign in
      </button>
    </form>
  );
}
