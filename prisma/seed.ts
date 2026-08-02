import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

interface CaseData {
  id: string;
  reason: string;
  economicProof: unknown;
  otherRequiredMaterial: string;
  accommodations: string[];
}

interface SeedData {
  applications: CaseData[];
  corrections: { applicationId: string; fields: string[]; reasonCode: string }[];
}

function makeMaterialMeta(materialId: string) {
  return JSON.stringify({
    materialId,
    fileName: `${materialId}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 102400,
    uploadedAt: new Date().toISOString(),
    status: "UPLOADED",
  });
}

async function main() {
  const seedPath = join(process.cwd(), "materials", "application-cases.json");
  const raw = readFileSync(seedPath, "utf-8");
  const data = JSON.parse(raw) as SeedData;

  for (const app of data.applications) {
    const exists = await prisma.application.findUnique({ where: { id: app.id } });
    if (exists) {
      await prisma.application.delete({ where: { id: app.id } });
    }

    await prisma.application.create({
      data: {
        id: app.id,
        state: "DRAFT",
        exemptionReason: app.reason,
        fullName: app.id === "APP-201" ? "张明" : "李华",
        contactPhone: "13800138000",
        contactEmail: app.id === "APP-202" ? "lihua@example.com" : null,
        caseDescription:
          app.id === "APP-201"
            ? "因房屋租赁纠纷被房东起诉驱逐，需要法律援助。"
            : "劳动合同纠纷，用人单位违法解除劳动合同。",
        legalIssueType: app.id === "APP-201" ? "HOUSING" : "EMPLOYMENT",
        accommodations: JSON.stringify(app.accommodations),
        economicProofMeta: app.economicProof
          ? makeMaterialMeta(String(app.economicProof))
          : null,
        idDocumentMeta: makeMaterialMeta(`ID-${app.id}`),
        otherMaterialMeta: makeMaterialMeta(app.otherRequiredMaterial),
        version: 1,
      },
    });
  }

  for (const corr of data.corrections) {
    const app = await prisma.application.findUnique({ where: { id: corr.applicationId } });
    if (!app) continue;

    if (app.state === "DRAFT") {
      await prisma.application.update({
        where: { id: corr.applicationId },
        data: { state: "NEEDS_CORRECTION", version: app.version + 1 },
      });
    }

    await prisma.correction.create({
      data: {
        applicationId: corr.applicationId,
        fields: JSON.stringify(corr.fields),
        reasonCode: corr.reasonCode,
      },
    });
  }

  console.log("Seed complete:");
  const all = await prisma.application.findMany();
  for (const a of all) {
    console.log(`  ${a.id} [${a.state}] - ${a.exemptionReason}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
