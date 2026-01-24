"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/app/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "Login failed");
      }
      router.push("/dashboard");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-orange-50 to-orange-100 text-gray-900 flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-white border border-orange-200 rounded-2xl p-8 shadow-xl">
        <h1 className="text-2xl font-semibold mb-2 text-gray-900">Sign in</h1>
        <p className="text-sm text-gray-600 mb-6">Access your Prior Systems workspace.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-white border border-orange-200 px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg bg-white border border-orange-200 px-3 py-2 text-sm text-gray-900 focus:border-orange-500 focus:outline-none"
              required
            />
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-orange-600 text-white py-2.5 text-sm font-semibold hover:bg-orange-500 transition disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="text-sm text-gray-600 mt-4">
          No account?{" "}
          <Link href="/signup" className="text-orange-600 hover:text-orange-500">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
