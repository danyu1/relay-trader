"use client";

import Link from "next/link";

interface UserDisplayProps {
  email: string;
}

export function UserDisplay({ email }: UserDisplayProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
        <div className="w-2 h-2 rounded-full bg-green-400"></div>
        <span className="text-sm text-slate-300">{email}</span>
      </div>
      <Link
        href="/logout"
        className="px-3 py-2 text-sm rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition text-slate-300 hover:text-white"
      >
        Logout
      </Link>
    </div>
  );
}
