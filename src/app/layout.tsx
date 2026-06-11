import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Nav from "@/components/Nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Serenity 瓶颈点投研台",
  description:
    "学习 Serenity（白毛股神）瓶颈点投资法，结合 AI 与 A 股数据进行选股与分析。仅供研究，不构成投资建议。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-white/10 px-4 py-4 text-center text-xs text-zinc-500">
          仅供学习研究，不构成任何投资建议（NFA）。数据来自东方财富/腾讯财经公开接口。
        </footer>
      </body>
    </html>
  );
}
