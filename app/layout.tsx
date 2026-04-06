import type { Metadata } from "next";
import { APP_NAME } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "九州大学サイクリング同好会のライド共有アプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
