import { redirect } from "next/navigation";
import { getPartner } from "@/lib/partner-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function PartnerLoginPage() {
  // Already signed in with a working login → straight to today's deliveries.
  if (await getPartner()) redirect("/partner");

  return (
    <main className="px-6 pt-16 pb-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/partner-icon-192.png" alt="" className="w-16 h-16 rounded-2xl shadow-sm" />
      <h1 className="mt-6 text-2xl font-bold">GreenFeast Partner</h1>
      <p className="mt-1 text-sm text-gray-500">Sign in with the phone number and password the office gave you.</p>
      <LoginForm />
    </main>
  );
}
