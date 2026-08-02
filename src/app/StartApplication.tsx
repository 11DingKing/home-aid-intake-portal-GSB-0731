"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApplicationDTO, ApiError } from "@/lib/types";

// Creates a new draft application and routes to the multi-step form.
export default function StartApplication() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/applications", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as ApiError;
        throw new Error(body.error?.message ?? "Could not start application.");
      }
      const app = (await res.json()) as ApplicationDTO;
      router.push(`/apply/${app.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start application.");
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? (
        <div className="banner" data-tone="error" role="alert">
          <span className="banner-title">Could not start: </span>
          {error}
        </div>
      ) : null}
      <button type="button" onClick={start} disabled={busy} aria-busy={busy}>
        {busy ? "Starting…" : "Start new application"}
      </button>
    </div>
  );
}
