import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeApplication } from "@/lib/serializers";
import { apiSuccess, apiError } from "@/lib/api-response";
import { saveSnapshot } from "@/lib/snapshots";

export async function GET() {
  const apps = await prisma.application.findMany({
    orderBy: { updatedAt: "desc" },
  });
  return apiSuccess(apps.map(serializeApplication));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const id = body.id || `APP-${Date.now()}`;

    const existing = await prisma.application.findUnique({ where: { id } });
    if (existing) {
      return apiSuccess(serializeApplication(existing));
    }

    const app = await prisma.application.create({
      data: { id, state: "DRAFT", accommodations: "[]" },
    });

    await saveSnapshot(app, "APPLICANT");

    await prisma.auditLog.create({
      data: {
        applicationId: id,
        action: "CREATED",
        toState: "DRAFT",
        actor: "APPLICANT",
      },
    });

    return apiSuccess(serializeApplication(app), 201);
  } catch {
    return apiError("创建申请失败", 500);
  }
}
