import { prisma } from "@/lib/prisma";
import { serializeApplication, serializeCorrection } from "@/lib/serializers";
import { apiSuccess } from "@/lib/api-response";
import { STAFF_VIEW_FIELDS, type ApplicationData, type StaffViewType } from "@/domain/types";

function projectToStaffView(
  app: ApplicationData,
  view: StaffViewType,
  corrections: ReturnType<typeof serializeCorrection>[]
) {
  const fields = STAFF_VIEW_FIELDS[view];
  const result: Record<string, unknown> = {};

  for (const field of fields) {
    if (field === "correctionFields") {
      const active = corrections.filter((c) => !c.resolved);
      result[field] = active.flatMap((c) => c.fields);
      result.activeCorrections = active;
    } else if (field in app) {
      result[field] = (app as unknown as Record<string, unknown>)[field];
    }
  }

  return result;
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

  const result = apps.map((app) => {
    const serialized = serializeApplication(app);
    const appCorrections = allCorrections
      .filter((c) => c.applicationId === app.id)
      .map(serializeCorrection);

    const view: StaffViewType =
      app.state === "NEEDS_CORRECTION" ? "CORRECTION_REVIEW" : "INTAKE_REVIEW";

    return {
      ...projectToStaffView(serialized, view, appCorrections),
      view,
    };
  });

  return apiSuccess(result);
}
