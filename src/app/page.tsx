"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useAnnouncer } from "@/components/Announcer";

export default function HomePage() {
  const router = useRouter();
  const { announce } = useAnnouncer();
  const [resumeId, setResumeId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function startNew() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/applications", { method: "POST" });
      if (!res.ok) throw new Error("create failed");
      const data = (await res.json()) as { id: string };
      announce(`已创建新申请 ${data.id}，正在打开第一步`);
      router.push(`/apply/${data.id}`);
    } catch {
      setError("创建申请失败，请重试");
      setBusy(false);
    }
  }

  function resume(e: FormEvent) {
    e.preventDefault();
    const id = resumeId.trim().toUpperCase();
    if (!id) {
      setError("请输入申请编号");
      return;
    }
    router.push(`/apply/${encodeURIComponent(id)}`);
  }

  return (
    <>
      <h1>法律援助预申请</h1>
      <p>
        本门户支持分步填写、离线草稿暂存与断线恢复。行动不便或有其他合理便利需求的申请人，
        可以在表单中登记需求，工作人员接续办理时会看到这些需求。
      </p>

      <section className="card" aria-labelledby="start-heading">
        <h2 id="start-heading">开始新申请</h2>
        <button
          type="button"
          className="btn"
          onClick={() => void startNew()}
          disabled={busy}
        >
          开始填写预申请
        </button>
      </section>

      <section className="card" aria-labelledby="resume-heading">
        <h2 id="resume-heading">继续已有申请</h2>
        <form onSubmit={resume}>
          <div className="field">
            <label htmlFor="resume-id">申请编号</label>
            <input
              id="resume-id"
              type="text"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
              aria-describedby={error ? "resume-error" : undefined}
              aria-invalid={error ? true : undefined}
              placeholder="例如 APP-201"
            />
            {error ? (
              <p className="error" id="resume-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <button type="submit" className="btn secondary">
            继续填写
          </button>
        </form>
      </section>
    </>
  );
}
