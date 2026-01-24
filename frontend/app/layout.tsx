import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Prior Systems Dashboard",
  description: "Backtest trading strategies through FastAPI backend.",
  icons: {
    icon: "/favicon-blue.svg",
    shortcut: "/favicon-blue.svg",
    apple: "/favicon-blue.svg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gradient-to-br from-white via-orange-50 to-orange-100 text-gray-900">{children}</body>
    </html>
  );
}

