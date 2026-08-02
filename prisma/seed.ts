import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Seed the database from materials/application-cases.json so the fixed
// application IDs, states, exemption reasons, accommodation values, and the
// correction example are reproducible for tests and the staff continuation UI.

const prisma = new PrismaClient();

interface CaseFile {
  states: string[];
  exemptionReasons: string[];
  accommodations: string[];
  applications: Array<{
    id: string;
    reason: string;
    economicProof: string | null;
    otherRequiredMaterial: string | null;
    accommodations: string[];
  }>;
  corrections: Array<{ applicationId: string; fields: string[]; reasonCode: string }>;
}

function loadCases(): CaseFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, "..", "materials", "application-cases.json");
  return JSON.parse(readFileSync(path, "utf8")) as CaseFile;
}

async function main() {
  const cases = loadCases();

  // Idempotent reseed: wipe existing rows in FK-safe order.
  await prisma.idempotencyKey.deleteMany();
  await prisma.applicationEvent.deleteMany();
  await prisma.correction.deleteMany();
  await prisma.applicationField.deleteMany();
  await prisma.materialMetadata.deleteMany();
  await prisma.application.deleteMany();

  for (const app of cases.applications) {
    // Seeded fixtures represent submitted applications under staff review.
    const state = "SUBMITTED";
    const created = await prisma.application.create({
      data: {
        id: app.id,
        state,
        version: 1,
        events: {
          create: [
            { toState: "DRAFT", actor: "applicant", note: "seed:created" },
            { fromState: "DRAFT", toState: "SUBMITTED", actor: "applicant", note: "seed:submitted" },
          ],
        },
      },
    });

    // Identity material metadata (otherRequiredMaterial) — metadata only.
    const materialIds: string[] = [];
    if (app.otherRequiredMaterial) {
      const mat = await prisma.materialMetadata.create({
        data: {
          id: app.otherRequiredMaterial,
          applicationId: created.id,
          kind: "IDENTITY",
          filename: `${app.otherRequiredMaterial}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 24000,
          checksum: null,
        },
      });
      materialIds.push(mat.id);
    }

    // Economic proof material, if the case provides one.
    let economicProofId: string | null = null;
    if (app.economicProof) {
      const mat = await prisma.materialMetadata.create({
        data: {
          id: app.economicProof,
          applicationId: created.id,
          kind: "ECONOMIC_PROOF",
          filename: `${app.economicProof}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 31000,
          checksum: null,
        },
      });
      economicProofId = mat.id;
    }

    // Persist applicant fields at version 1.
    const fieldData: Array<{ key: string; value: string | null }> = [
      { key: "fullName", value: `Applicant ${app.id}` },
      { key: "contactEmail", value: `${app.id.toLowerCase()}@example.org` },
      { key: "contactPhone", value: "" },
      { key: "exemptionReason", value: app.reason },
      { key: "identityProof", value: app.otherRequiredMaterial ?? "" },
      { key: "economicProof", value: economicProofId ?? "" },
      { key: "accommodations", value: JSON.stringify(app.accommodations) },
      { key: "accommodationNote", value: "" },
    ];
    for (const f of fieldData) {
      await prisma.applicationField.create({
        data: {
          applicationId: created.id,
          key: f.key,
          value: f.value,
          updatedAtVersion: 1,
        },
      });
    }
  }

  // Corrections: put those applications into NEEDS_CORRECTION with an open
  // correction record so the resubmit flow is demonstrable end-to-end.
  for (const corr of cases.corrections) {
    const app = await prisma.application.findUnique({ where: { id: corr.applicationId } });
    if (!app) continue;
    await prisma.application.update({
      where: { id: corr.applicationId },
      data: {
        state: "NEEDS_CORRECTION",
        version: app.version + 1,
        events: {
          create: {
            fromState: "SUBMITTED",
            toState: "NEEDS_CORRECTION",
            actor: "staff",
            note: `seed:${corr.reasonCode}`,
          },
        },
      },
    });
    await prisma.correction.create({
      data: {
        applicationId: corr.applicationId,
        fields: JSON.stringify(corr.fields),
        reasonCode: corr.reasonCode,
        note: "Please provide the requested item.",
      },
    });
  }

  const count = await prisma.application.count();
  console.log(`Seeded ${count} applications from application-cases.json`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
