"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ApplicationData,
  Accommodation,
  ExemptionReason,
  LegalIssueType,
  MaterialMeta,
  CorrectionData,
} from "@/domain/types";

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
  activeCorrections: CorrectionData[];
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
    activeCorrections: [],
  };
}

function loadFromStorage(id: string): DraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    if (!parsed.activeCorrections) parsed.activeCorrections = [];
    return parsed;
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

export function fromApplicationData(app: ApplicationData, corrections: CorrectionData[] = []): DraftState {
  const activeCorrections = corrections.filter((c) => !c.resolved);
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
    activeCorrections,
  };
}

export interface UseDraftReturn {
  draft: DraftState;
  setField: <K extends keyof DraftState>(field: K, value: DraftState[K]) => void;
  saveDraft: (showStatus?: boolean) => Promise<void>;
  submitApplication: () => Promise<{
    success: boolean;
    errors?: { field: string; message: string }[];
    conflictFields?: string[];
  }>;
  isOnline: boolean;
  isSaving: boolean;
  saveMessage: string;
  conflictMessage: string;
  conflictFields: string[];
  loadApplication: (id: string) => Promise<void>;
  resetDraft: () => void;
  lastSavedAt: Date | null;
  refreshCorrections: () => Promise<void>;
}

const FIELD_LABELS: Record<string, string> = {
  fullName: "姓名",
  contactPhone: "联系电话",
  contactEmail: "电子邮箱",
  caseDescription: "案件描述",
  legalIssueType: "案件类型",
  exemptionReason: "豁免原因",
  accommodations: "合理便利",
  economicProofMeta: "经济困难证明",
  idDocumentMeta: "身份证明",
  otherMaterialMeta: "其他材料",
};

export function useDraft(initialId?: string): UseDraftReturn {
  const [draft, setDraft] = useState<DraftState>(() =>
    initialId ? emptyDraft(initialId) : emptyDraft("")
  );
  const [isOnline, setIsOnline] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [conflictMessage, setConflictMessage] = useState("");
  const [conflictFields, setConflictFields] = useState<string[]>([]);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveDraftRef = useRef<((show?: boolean) => Promise<void>) | null>(null);
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

  const loadApplication = useCallback(
    async (id: string) => {
      idRef.current = id;

      try {
        const [appRes, corrRes] = await Promise.all([
          fetch(`/api/applications/${id}`, { cache: "no-store" }),
          fetch(`/api/applications/${id}/corrections`, { cache: "no-store" }),
        ]);

        if (appRes.ok) {
          const appJson = await appRes.json();
          const serverApp = appJson.data as ApplicationData;
          let corrections: CorrectionData[] = [];
          if (corrRes.ok) {
            const corrJson = await corrRes.json();
            corrections = corrJson.data as CorrectionData[];
          }

          const latestLocal = loadFromStorage(id);

          setDraft((prev) => {
            const currentLocal = latestLocal ?? prev;
            const serverState = fromApplicationData(serverApp, corrections);
            let merged: DraftState;

            if (currentLocal.id !== id) {
              merged = serverState;
            } else if (currentLocal.baseVersion < serverApp.version) {
              merged = mergeServerOverStaleLocal(currentLocal, serverState);
            } else {
              merged = threeWayMergeClient({ ...currentLocal }, serverState);
            }

            saveToStorage(merged);
            return merged;
          });

          if (latestLocal && latestLocal.baseVersion < serverApp.version) {
            setConflictMessage(
              `检测到版本差异（本地 v${latestLocal.baseVersion} / 服务器 v${serverApp.version}），已自动合并。合理便利需求已保留。`
            );
          }
          return;
        }
      } catch {
        // offline - use local
      }

      const local = loadFromStorage(id);
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
    },
    []
  );

  const refreshCorrections = useCallback(async () => {
    if (!idRef.current) return;
    try {
      const res = await fetch(`/api/applications/${idRef.current}/corrections`, {
        cache: "no-store",
      });
      if (res.ok) {
        const json = await res.json();
        const corrections = json.data as CorrectionData[];
        setDraft((prev) => {
          const next = { ...prev, activeCorrections: corrections.filter((c) => !c.resolved) };
          saveToStorage(next);
          return next;
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const setField = useCallback(
    <K extends keyof DraftState>(field: K, value: DraftState[K]) => {
      setDraft((prev) => {
        const next = { ...prev, [field]: value };
        if (field === "accommodations") {
          const existing = prev.accommodations;
          const incoming = value as Accommodation[];
          next.accommodations = Array.from(
            new Set([...existing, ...incoming])
          ) as Accommodation[];
        }
        saveToStorage(next);
        return next;
      });

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        void saveDraftRef.current?.(true);
      }, 2000);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const saveDraft = useCallback(
    async (showStatus = false): Promise<void> => {
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
          "fullName",
          "contactPhone",
          "contactEmail",
          "caseDescription",
          "legalIssueType",
          "exemptionReason",
          "accommodations",
          "economicProofMeta",
          "idDocumentMeta",
          "otherMaterialMeta",
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
          const conflicts: string[] = json.conflicts || [];
          const autoMerged: string[] = json.autoMerged || [];

          setDraft((prev) => {
            const serverState = fromApplicationData(serverData, prev.activeCorrections);
            const merged = threeWayMergeClient(prev, serverState);
            merged.baseVersion = serverData.version;
            merged.version = serverData.version;
            saveToStorage(merged);
            return merged;
          });

          setConflictFields(conflicts);
          const conflictLabels = conflicts.map((f) => FIELD_LABELS[f] || f).join("、");
          const autoLabels = autoMerged.map((f) => FIELD_LABELS[f] || f).join("、");
          let msg = "字段冲突已自动合并";
          if (conflictLabels) msg += `：${conflictLabels}（以您的输入为准）`;
          if (autoLabels) msg += `；${autoLabels}已自动合并保留双方设置`;
          msg += "。合理便利需求已保留。";
          setConflictMessage(msg);
          if (showStatus) setSaveMessage("冲突已解决并保存");
        } else if (res.ok) {
          const json = await res.json();
          const updated = json.data as ApplicationData;
          setDraft((prev) => {
            const next = fromApplicationData(updated, prev.activeCorrections);
            saveToStorage(next);
            return next;
          });
          if (showStatus) setSaveMessage("草稿已保存");
          setLastSavedAt(new Date());
          setConflictMessage("");
          setConflictFields([]);
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
    },
    [draft]
  );

  saveDraftRef.current = saveDraft;

  const syncOnReconnect = useCallback(async () => {
    await saveDraft(true);
  }, [saveDraft]);

  const submitApplication = useCallback(async () => {
    const current = draft;
    if (!current.id)
      return {
        success: false,
        errors: [{ field: "form", message: "申请ID缺失" }],
      };

    await saveDraft(false);

    const idempotencyKey = `submit-${current.id}-${Date.now()}`;
    try {
      const res = await fetch(`/api/applications/${current.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, version: current.baseVersion }),
      });

      if (res.ok) {
        const json = await res.json();
        const updated = json.data as ApplicationData;
        setDraft((prev) => {
          const next = fromApplicationData(updated, prev.activeCorrections);
          saveToStorage(next);
          return next;
        });
        setSaveMessage("提交成功！");
        return { success: true };
      } else {
        const json = await res.json();
        if (res.status === 409) {
          const serverData = json.serverData as ApplicationData;
          const conflicts: string[] = json.conflicts || [];
          setDraft((prev) => {
            const serverState = fromApplicationData(serverData, prev.activeCorrections);
            const merged = threeWayMergeClient(prev, serverState);
            merged.baseVersion = serverData.version;
            saveToStorage(merged);
            return merged;
          });
          setConflictFields(conflicts);
          return {
            success: false,
            errors: [{ field: "form", message: json.error || "数据冲突，请刷新后重试" }],
            conflictFields: conflicts,
          };
        }
        if (json.errors) {
          return { success: false, errors: json.errors };
        }
        return {
          success: false,
          errors: [{ field: "form", message: json.error || "提交失败" }],
        };
      }
    } catch {
      return {
        success: false,
        errors: [{ field: "form", message: "网络错误，请稍后重试" }],
      };
    }
  }, [draft, saveDraft]);

  const resetDraft = useCallback(() => {
    if (draft.id) {
      localStorage.removeItem(STORAGE_PREFIX + draft.id);
    }
    setDraft(emptyDraft(draft.id));
    setSaveMessage("");
    setConflictMessage("");
    setConflictFields([]);
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
    conflictFields,
    loadApplication,
    resetDraft,
    lastSavedAt,
    refreshCorrections,
  };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function threeWayMergeClient(local: DraftState, server: DraftState): DraftState {
  const merged: DraftState = { ...server };

  if (local.fullName && !server.fullName) merged.fullName = local.fullName;
  else if (local.fullName && server.fullName && local.fullName !== server.fullName)
    merged.fullName = local.fullName;

  if (local.contactPhone && !server.contactPhone) merged.contactPhone = local.contactPhone;
  else if (local.contactPhone && server.contactPhone && local.contactPhone !== server.contactPhone)
    merged.contactPhone = local.contactPhone;

  if (local.contactEmail && !server.contactEmail) merged.contactEmail = local.contactEmail;
  else if (local.contactEmail && server.contactEmail && local.contactEmail !== server.contactEmail)
    merged.contactEmail = local.contactEmail;

  if (local.caseDescription && !server.caseDescription)
    merged.caseDescription = local.caseDescription;
  else if (
    local.caseDescription &&
    server.caseDescription &&
    local.caseDescription !== server.caseDescription
  )
    merged.caseDescription = local.caseDescription;

  if (local.legalIssueType && !server.legalIssueType)
    merged.legalIssueType = local.legalIssueType;
  else if (
    local.legalIssueType &&
    server.legalIssueType &&
    local.legalIssueType !== server.legalIssueType
  )
    merged.legalIssueType = local.legalIssueType;

  merged.accommodations = Array.from(
    new Set([...local.accommodations, ...server.accommodations])
  ) as Accommodation[];

  if (local.economicProofMeta && !server.economicProofMeta)
    merged.economicProofMeta = local.economicProofMeta;
  else if (
    local.economicProofMeta &&
    server.economicProofMeta &&
    !valuesEqual(local.economicProofMeta, server.economicProofMeta)
  )
    merged.economicProofMeta = local.economicProofMeta;

  if (local.idDocumentMeta && !server.idDocumentMeta)
    merged.idDocumentMeta = local.idDocumentMeta;
  else if (
    local.idDocumentMeta &&
    server.idDocumentMeta &&
    !valuesEqual(local.idDocumentMeta, server.idDocumentMeta)
  )
    merged.idDocumentMeta = local.idDocumentMeta;

  if (local.otherMaterialMeta && !server.otherMaterialMeta)
    merged.otherMaterialMeta = local.otherMaterialMeta;
  else if (
    local.otherMaterialMeta &&
    server.otherMaterialMeta &&
    !valuesEqual(local.otherMaterialMeta, server.otherMaterialMeta)
  )
    merged.otherMaterialMeta = local.otherMaterialMeta;

  merged.version = server.version;
  merged.baseVersion = server.version;
  merged.state = server.state;
  merged.activeCorrections = server.activeCorrections;

  return merged;
}

function mergeServerOverStaleLocal(local: DraftState, server: DraftState): DraftState {
  const merged: DraftState = { ...server };

  merged.accommodations = Array.from(
    new Set([...local.accommodations, ...server.accommodations])
  ) as Accommodation[];

  if (local.fullName && !server.fullName) merged.fullName = local.fullName;
  if (local.contactPhone && !server.contactPhone) merged.contactPhone = local.contactPhone;
  if (local.contactEmail && !server.contactEmail) merged.contactEmail = local.contactEmail;
  if (local.caseDescription && !server.caseDescription)
    merged.caseDescription = local.caseDescription;
  if (local.legalIssueType && !server.legalIssueType)
    merged.legalIssueType = local.legalIssueType;
  if (local.economicProofMeta && !server.economicProofMeta)
    merged.economicProofMeta = local.economicProofMeta;
  if (local.idDocumentMeta && !server.idDocumentMeta)
    merged.idDocumentMeta = local.idDocumentMeta;
  if (local.otherMaterialMeta && !server.otherMaterialMeta)
    merged.otherMaterialMeta = local.otherMaterialMeta;

  merged.version = server.version;
  merged.baseVersion = server.version;
  merged.state = server.state;
  merged.activeCorrections = server.activeCorrections;

  return merged;
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
