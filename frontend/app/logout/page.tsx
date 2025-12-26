"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/app/lib/api";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    apiFetch("/auth/logout", { method: "POST" })
      .catch(() => undefined)
      .finally(() => {
        router.replace("/login");
      });
  }, [router]);

  return (
    <main className="min-h-screen bg-black text-gray-100 flex items-center justify-center">
      <p className="text-sm text-gray-400">Signing out...</p>
    </main>
  );
}
