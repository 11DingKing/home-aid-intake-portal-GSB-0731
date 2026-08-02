"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ApplicationData, Accommodation, ExemptionReason, LegalIssueType, MaterialMeta } from "@/domain/types";

const STORAGE_PREFIX = "legal-aid-draft-";

export interface DraftState {
  id: string;
  fullName: string;
  contactPhone: string;
  contactEmail: string;
  caseDescription: string;
  legalIssueType: LegalIssueType | "";
  exemptionReason: ExemptionReason;
  accommodations: Accommodation[];
  economicProofMeta: MaterialMeta | null;
  idDocumentMeta: MaterialMeta | null;
  otherMaterialMeta: MaterialMeta | null;
  version: number;
  baseVersion: number;
  state: string;
}

function emptyDraft(id: string): DraftState {
  return {
    id,
    fullName: "",
    contactPhone: "",
    contactEmail: "",
    caseDescription: "",
    legalIssueType: "",
    exemptionReason: "NONE",
    accommodations: [],
    economicProofMeta: null,
    idDocumentMeta: null,
    otherMaterialMeta: null,
    version: 1,
    baseVersion: 1,
    state: "DRAFT",
  };
}

function loadFromStorage(id: string): DraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as DraftState;
  } catch {
    return null;
  }
}

function saveToStorage(draft: DraftState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + draft.id, JSON.stringify(draft));
  } catch {
    // storage full or unavailable
  }
}

export function fromApplicationData(app: ApplicationData): DraftState {
  return {
    id: app.id,
    fullName: app.fullName ?? "",
    contactPhone: app.contactPhone ?? "",
    contactEmail: app.contactEmail ?? "",
    caseDescription: app.caseDescription ?? "",
    legalIssueType: app.legalIssueType ?? "",
    exemptionReason: app.exemptionReason,
    accommodations: [...app.accommodations],
    economicProofMeta: app.economicProofMeta,
    idDocumentMeta: app.idDocumentMeta,
    otherMaterialMeta: app.otherMaterialMeta,
    version: app.version,
    baseVersion: app.version,
    state: app.state,
  };
}

export interface UseDraftReturn {
  draft: DraftState;
  setField: <K extends keyof DraftState>(field: K, value: DraftState[K]) => void;
  saveDraft: (showStatus?: boolean) => Promise<void>;
  submitApplication: () => Promise<{ success: boolean; errors?: { field: string; message: string }[] }>;
  isOnline: boolean;
  isSaving: boolean;
  saveMessage: string;
  conflictMessage: string;
  loadApplication: (id: string) => Promise<void>;
  resetDraft: () => void;
  lastSavedAt: Date | null;
}

export function useDraft(initialId?: string): UseDraftReturn {
  const [draft, setDraft] = useState<DraftState>(() =>
    initialId ? emptyDraft(initialId) : emptyDraft("")
  );
  const [isOnline, setIsOnline] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(initialId ?? "");

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const onOnline = () => {
      setIsOnline(true);
      setSaveMessage("网络已恢复，正在同步草稿...");
      if (idRef.current) {
        void syncOnReconnect();
      }
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadApplication = useCallback(async (id: string) => {
    idRef.current = id;
    const local = loadFromStorage(id);

    try {
      const res = await fetch(`/api/applications/${id}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        const serverApp = json.data as ApplicationData;
        let merged: DraftState;

        if (local && local.baseVersion < serverApp.version) {
          merged = fieldLevelMerge(local, serverApp);
          setConflictMessage(`检测到版本差异（本地 v${local.baseVersion} / 服务器 v${serverApp.version}），已自动合并保留您的合理便利设置。`);
        } else if (local && local.version > serverApp.version) {
          merged = fieldLevelMerge(local, serverApp);
        } else {
          merged = fromApplicationData(serverApp);
        }

        setDraft(merged);
        saveToStorage(merged);
        return;
      }
    } catch {
      // offline - use local
    }

    if (local) {
      setDraft(local);
    } else {
      const created = await createApplication(id);
      if (created) {
        const d = fromApplicationData(created);
        setDraft(d);
        saveToStorage(d);
      }
    }
  }, []);

  const setField = useCallback(<K extends keyof DraftState>(field: K, value: DraftState[K]) => {
    setDraft((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "accommodations") {
        const existing = prev.accommodations;
        const incoming = value as Accommodation[];
        next.accommodations = Array.from(new Set([...existing, ...incoming])) as Accommodation[];
      }
      saveToStorage(next);
      return next;
    });

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void saveDraft(true);
    }, 2000);
  }, []);

  const saveDraft = useCallback(async (showStatus = false): Promise<void> => {
    const current = draft;
    if (!current.id) return;

    if (!navigator.onLine) {
      saveToStorage(current);
      if (showStatus) setSaveMessage("当前离线，草稿已保存在本地");
      return;
    }

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = { version: current.baseVersion };
      const fields: (keyof DraftState)[] = [
        "fullName", "contactPhone", "contactEmail", "caseDescription",
        "legalIssueType", "exemptionReason", "accommodations",
        "economicProofMeta", "idDocumentMeta", "otherMaterialMeta",
      ];
      for (const f of fields) {
        payload[f] = current[f];
      }

      const res = await fetch(`/api/applications/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 409) {
        const json = await res.json();
        const serverData = json.serverData as ApplicationData;
        const merged = fieldLevelMerge(current, serverData);
        merged.baseVersion = serverData.version;
        merged.version = serverData.version;
        setDraft(merged);
        saveToStorage(merged);
        setConflictMessage(`字段冲突已自动合并：${json.conflicts.join("、")}。合理便利需求已保留。`);
        if (showStatus) setSaveMessage("冲突已解决并保存");
      } else if (res.ok) {
        const json = await res.json();
        const updated = json.data as ApplicationData;
        setDraft((prev) => {
          const next = { ...prev, ...fromApplicationData(updated) };
          saveToStorage(next);
          return next;
        });
        if (showStatus) setSaveMessage("草稿已保存");
        setLastSavedAt(new Date());
        setConflictMessage("");
      } else {
        const json = await res.json().catch(() => ({}));
        if (showStatus) setSaveMessage(json.error || "保存失败，已暂存本地");
        saveToStorage(current);
      }
    } catch {
      saveToStorage(current);
      if (showStatus) setSaveMessage("网络异常，草稿已保存在本地");
    } finally {
      setIsSaving(false);
    }
  }, [draft]);

  const syncOnReconnect = useCallback(async () => {
    await saveDraft(true);
  }, [saveDraft]);

  const submitApplication = useCallback(async () => {
    const current = draft;
    if (!current.id) return { success: false, errors: [{ field: "form", message: "申请ID缺失" }] };

    await saveDraft(false);

    const idempotencyKey = `submit-${current.id}-${Date.now()}`;
    try {
      const res = await fetch(`/api/applications/${current.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey }),
      });

      if (res.ok) {
        const json = await res.json();
        const updated = json.data as ApplicationData;
        setDraft((prev) => {
          const next = { ...prev, ...fromApplicationData(updated) };
          saveToStorage(next);
          return next;
        });
        setSaveMessage("提交成功！");
        return { success: true };
      } else {
        const json = await res.json();
        if (json.errors) {
          return { success: false, errors: json.errors };
        }
        return { success: false, errors: [{ field: "form", message: json.error || "提交失败" }] };
      }
    } catch {
      return { success: false, errors: [{ field: "form", message: "网络错误，请稍后重试" }] };
    }
  }, [draft, saveDraft]);

  const resetDraft = useCallback(() => {
    if (draft.id) {
      localStorage.removeItem(STORAGE_PREFIX + draft.id);
    }
    setDraft(emptyDraft(draft.id));
    setSaveMessage("");
    setConflictMessage("");
  }, [draft.id]);

  return {
    draft,
    setField,
    saveDraft,
    submitApplication,
    isOnline,
    isSaving,
    saveMessage,
    conflictMessage,
    loadApplication,
    resetDraft,
    lastSavedAt,
  };
}

function fieldLevelMerge(local: DraftState, server: ApplicationData): DraftState {
  const merged: DraftState = {
    id: server.id,
    fullName: pickWinner(local.fullName, server.fullName ?? ""),
    contactPhone: pickWinner(local.contactPhone, server.contactPhone ?? ""),
    contactEmail: pickWinner(local.contactEmail, server.contactEmail ?? ""),
    caseDescription: pickWinner(local.caseDescription, server.caseDescription ?? ""),
    legalIssueType: (pickWinner(local.legalIssueType as string, server.legalIssueType ?? "") as LegalIssueType | "") || "",
    exemptionReason: server.exemptionReason,
    accommodations: Array.from(new Set([...local.accommodations, ...server.accommodations])) as Accommodation[],
    economicProofMeta: local.economicProofMeta ?? server.economicProofMeta,
    idDocumentMeta: local.idDocumentMeta ?? server.idDocumentMeta,
    otherMaterialMeta: local.otherMaterialMeta ?? server.otherMaterialMeta,
    version: server.version,
    baseVersion: server.version,
    state: server.state,
  };
  return merged;
}

function pickWinner(localVal: string, serverVal: string): string {
  if (!localVal && serverVal) return serverVal;
  if (localVal && !serverVal) return localVal;
  return localVal || serverVal;
}

async function createApplication(id: string): Promise<ApplicationData | null> {
  try {
    const res = await fetch("/api/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      const json = await res.json();
      return json.data as ApplicationData;
    }
  } catch {
    // offline
  }
  return null;
}
