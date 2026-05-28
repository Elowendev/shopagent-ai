import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小拾光 · ShopAgent AI",
  description: "原创品牌店铺 AI 店员",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
