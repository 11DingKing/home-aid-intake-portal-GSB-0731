import { prisma } from "./prisma";

export type AuditAction =
  | "CREATED"
  | "SUBMITTED"
  | "RESUBMITTED"
  | "CORRECTION_REQUESTED"
  | "ACCEPTED"
  | "DECLINED"
  | "DRAFT_MERGED"
  | "DRAFT_SAVED"
  | "UNAUTHORIZED_FIELD_REJECTED"
  | "INVALID_TRANSITION_REJECTED"
  | "STALE_LINK_DETECTED"
  | "FIELD_PROJECTION";

export interface AuditEntry {
  applicationId: string;
  action: AuditAction;
  fromState?: string | null;
  toState?: string | null;
  actor: "APPLICANT" | "STAFF" | "SYSTEM";
  details?: Record<string, unknown>;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        applicationId: entry.applicationId,
        action: entry.action,
        fromState: entry.fromState ?? null,
        toState: entry.toState ?? null,
        actor: entry.actor,
        details: entry.details ? JSON.stringify(entry.details) : null,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

export async function logRejectedFields(
  applicationId: string,
  actor: "APPLICANT" | "STAFF",
  rejectedFields: string[],
  reasons: Record<string, string>,
  currentState: string
): Promise<void> {
  if (rejectedFields.length === 0) return;
  await writeAuditLog({
    applicationId,
    action: "UNAUTHORIZED_FIELD_REJECTED",
    fromState: currentState,
    actor,
    details: {
      rejectedFields,
      reasons,
      timestamp: new Date().toISOString(),
    },
  });
}

export async function logInvalidTransition(
  applicationId: string,
  actor: "APPLICANT" | "STAFF",
  fromState: string,
  attemptedTo: string,
  reason: string
): Promise<void> {
  await writeAuditLog({
    applicationId,
    action: "INVALID_TRANSITION_REJECTED",
    fromState,
    toState: attemptedTo,
    actor,
    details: { reason, timestamp: new Date().toISOString() },
  });
}

export async function logStaleLink(
  applicationId: string,
  actor: "APPLICANT" | "STAFF",
  expectedState: string,
  actualState: string
): Promise<void> {
  await writeAuditLog({
    applicationId,
    action: "STALE_LINK_DETECTED",
    fromState: expectedState,
    toState: actualState,
    actor,
    details: { timestamp: new Date().toISOString() },
  });
}
