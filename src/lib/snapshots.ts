import { prisma } from "./prisma";
import { serializeApplication } from "./serializers";
import type { Application } from "@prisma/client";

export async function saveSnapshot(
  app: Application,
  actor: string = "SYSTEM"
): Promise<void> {
  const serialized = serializeApplication(app);
  await prisma.applicationSnapshot.upsert({
    where: {
      applicationId_version: {
        applicationId: app.id,
        version: app.version,
      },
    },
    update: {
      data: JSON.stringify(serialized),
      state: app.state,
      actor,
    },
    create: {
      applicationId: app.id,
      version: app.version,
      state: app.state,
      data: JSON.stringify(serialized),
      actor,
    },
  });
}

export async function getSnapshotData(
  applicationId: string,
  version: number
): Promise<Record<string, unknown> | null> {
  const snapshot = await prisma.applicationSnapshot.findUnique({
    where: {
      applicationId_version: {
        applicationId,
        version,
      },
    },
  });

  if (!snapshot) return null;

  try {
    return JSON.parse(snapshot.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function getBaseForMerge(
  applicationId: string,
  baseVersion: number,
  currentApp: Application
): Promise<Record<string, unknown>> {
  if (baseVersion >= currentApp.version) {
    return serializeApplication(currentApp) as unknown as Record<string, unknown>;
  }

  const snapshot = await getSnapshotData(applicationId, baseVersion);
  if (snapshot) return snapshot;

  return serializeApplication(currentApp) as unknown as Record<string, unknown>;
}
