"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/app/lib/api";

interface AuthUser {
  id: number;
  email: string;
}

export function useRequireAuth() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await apiFetch("/auth/me");
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = (await res.json()) as AuthUser;
        if (mounted) {
          setUser(data);
        }
      } catch {
        router.replace("/login");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    check();
    return () => {
      mounted = false;
    };
  }, [router]);

  return { user, loading };
}
