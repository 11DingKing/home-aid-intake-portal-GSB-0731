import type { Metadata } from "next";
import Link from "next/link";
import { AnnouncerProvider } from "@/components/Announcer";
import "./globals.css";

export const metadata: Metadata = {
  title: "法律援助预申请门户",
  description: "无障碍法律援助预申请与工作人员接续办理",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip-link" href="#main">
          跳到主要内容
        </a>
        <header
          style={{
            background: "#0b4da2",
            color: "#fff",
            padding: "0.75rem 1rem",
          }}
        >
          <nav
            aria-label="主导航"
            style={{ maxWidth: "46rem", margin: "0 auto" }}
          >
            <Link href="/" style={{ color: "#fff", fontWeight: 700 }}>
              法律援助预申请门户
            </Link>
            {" · "}
            <Link href="/staff" style={{ color: "#fff" }}>
              工作人员接续
            </Link>
          </nav>
        </header>
        <AnnouncerProvider>
          <main id="main">{children}</main>
        </AnnouncerProvider>
      </body>
    </html>
  );
}
