import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prior Systems Dashboard",
  description: "Backtest trading strategies through FastAPI backend.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-gray-100">{children}</body>
    </html>
  );
}

