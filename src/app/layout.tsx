import type { Metadata } from "next";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "世界杯预测",
  description: "世界杯结果预测、回测和高确定性候选观察看板"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Nav />
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
