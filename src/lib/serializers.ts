import type { ApplicationData, CorrectionData, MaterialMeta } from "@/domain/types";
import type {
  Application as PrismaApplication,
  Correction as PrismaCorrection,
} from "@prisma/client";

function parseMaterialMeta(value: string | null): MaterialMeta | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as MaterialMeta;
  } catch {
    return null;
  }
}

export function serializeApplication(app: PrismaApplication): ApplicationData {
  return {
    id: app.id,
    state: app.state as ApplicationData["state"],
    exemptionReason: app.exemptionReason as ApplicationData["exemptionReason"],
    fullName: app.fullName,
    contactPhone: app.contactPhone,
    contactEmail: app.contactEmail,
    caseDescription: app.caseDescription,
    legalIssueType: app.legalIssueType as ApplicationData["legalIssueType"],
    accommodations: JSON.parse(app.accommodations) as ApplicationData["accommodations"],
    economicProofMeta: parseMaterialMeta(app.economicProofMeta),
    idDocumentMeta: parseMaterialMeta(app.idDocumentMeta),
    otherMaterialMeta: parseMaterialMeta(app.otherMaterialMeta),
    version: app.version,
    idempotencyKey: app.idempotencyKey,
    submittedAt: app.submittedAt?.toISOString() ?? null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
  };
}

export function serializeCorrection(corr: PrismaCorrection): CorrectionData {
  return {
    id: corr.id,
    applicationId: corr.applicationId,
    fields: JSON.parse(corr.fields) as string[],
    reasonCode: corr.reasonCode as CorrectionData["reasonCode"],
    resolved: corr.resolved,
    createdAt: corr.createdAt.toISOString(),
    resolvedAt: corr.resolvedAt?.toISOString() ?? null,
  };
}
