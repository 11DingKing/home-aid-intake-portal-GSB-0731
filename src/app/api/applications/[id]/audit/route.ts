import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiSuccess, apiError } from "@/lib/api-response";

interface RouteContext {
  params: { id: string };
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const app = await prisma.application.findUnique({ where: { id: params.id } });
  if (!app) return apiError("申请不存在", 404);

  const logs = await prisma.auditLog.findMany({
    where: { applicationId: params.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const rejectionLogs = logs
    .filter(
      (l) =>
        l.action === "UNAUTHORIZED_FIELD_REJECTED" ||
        l.action === "INVALID_TRANSITION_REJECTED" ||
        l.action === "STALE_LINK_DETECTED"
    )
    .map((l) => ({
      id: l.id,
      action: l.action,
      fromState: l.fromState,
      toState: l.toState,
      actor: l.actor,
      details: l.details ? JSON.parse(l.details) : null,
      createdAt: l.createdAt.toISOString(),
    }));

  return apiSuccess({
    applicationId: params.id,
    currentState: app.state,
    version: app.version,
    rejectionCount: rejectionLogs.length,
    auditTrail: rejectionLogs,
  });
}
