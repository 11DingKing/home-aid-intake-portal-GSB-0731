import { prisma } from "@/lib/prisma";
import { serializeApplication, serializeCorrection } from "@/lib/serializers";
import { apiSuccess } from "@/lib/api-response";
import { getStaffVisibleFields, getStaffViewForState } from "@/domain/field-permissions";
import type { ApplicationData } from "@/domain/types";

function projectToStaffView(
  app: ApplicationData,
  corrections: ReturnType<typeof serializeCorrection>[]
) {
  const view = getStaffViewForState(app.state);
  if (view === "NONE") return null;

  const visibleFields = getStaffVisibleFields(app.state);
  const result: Record<string, unknown> = {};

  for (const field of visibleFields) {
    if (field === "correctionFields") {
      const active = corrections.filter((c) => !c.resolved);
      result[field] = active.flatMap((c) => c.fields);
      result.activeCorrections = active;
    } else if (field in app) {
      result[field] = (app as unknown as Record<string, unknown>)[field];
    }
  }

  return { ...result, view };
}

export async function GET() {
  const apps = await prisma.application.findMany({
    where: { state: { in: ["SUBMITTED", "NEEDS_CORRECTION", "RESUBMITTED"] } },
    orderBy: { updatedAt: "desc" },
  });

  const allCorrections = await prisma.correction.findMany({
    where: { applicationId: { in: apps.map((a) => a.id) } },
    orderBy: { createdAt: "desc" },
  });

  const result = apps
    .map((app) => {
      const serialized = serializeApplication(app);
      const appCorrections = allCorrections
        .filter((c) => c.applicationId === app.id)
        .map(serializeCorrection);

      return projectToStaffView(serialized, appCorrections);
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return apiSuccess(result);
}
