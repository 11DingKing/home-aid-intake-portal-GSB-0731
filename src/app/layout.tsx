import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "法援预申请系统",
  description: "无障碍法律援助预申请与工作人员接续系统",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <a href="#main-content" className="sr-only" style={{ position: "absolute", zIndex: 100 }}>
          跳转到主要内容
        </a>
        {children}
      </body>
    </html>
  );
}
