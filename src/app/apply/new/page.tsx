"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NewApplicationPage() {
  const router = useRouter();

  useEffect(() => {
    const id = `APP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    router.replace(`/apply/${id}`);
  }, [router]);

  return (
    <main id="main-content" className="container">
      <p>正在创建申请...</p>
    </main>
  );
}
