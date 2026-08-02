import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const prisma = new PrismaClient();

interface CaseFile {
  states: string[];
  exemptionReasons: string[];
  accommodations: string[];
  applications: Array<{
    id: string;
    reason: string;
    economicProof: string | null;
    otherRequiredMaterial: string;
    accommodations: string[];
  }>;
  corrections: Array<{
    applicationId: string;
    fields: string[];
    reasonCode: string;
  }>;
  staffViews: Record<string, string[]>;
  offlineConflicts: string[];
}

const cases: CaseFile = JSON.parse(
  readFileSync(
    join(__dirname, "..", "materials", "application-cases.json"),
    "utf-8",
  ),
) as CaseFile;

async function main() {
  for (const c of cases.applications) {
    const needsCorrection = cases.corrections.some(
      (x) => x.applicationId === c.id,
    );
    const state = needsCorrection ? "NEEDS_CORRECTION" : "SUBMITTED";

    await prisma.application.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        version: 1,
        state,
        contactName: c.id === "APP-201" ? "王阿姨" : "李师傅",
        contactPhone: c.id === "APP-201" ? "13800000001" : "13800000002",
        address:
          c.id === "APP-201"
            ? "朝阳区和平街 12 号院 3 单元 501"
            : "海淀区中关村南大街 5 号",
        matterType: c.id === "APP-201" ? "LABOR_DISPUTE" : "TORT_COMPENSATION",
        matterDescription:
          c.id === "APP-201"
            ? "被原单位拖欠三个月工资，多次协商未果，申请法律援助追索劳动报酬。"
            : "交通事故受伤，对方拒绝赔偿医疗费用，申请法律援助主张侵权赔偿。",
        exemptionReason: c.reason,
        accommodations: JSON.stringify(c.accommodations),
        idempotencyKey: `seed-${c.id}`,
        submittedAt: new Date(),
        fieldVersions: JSON.stringify({
          contactName: 1,
          contactPhone: 1,
          address: 1,
          matterType: 1,
          matterDescription: 1,
          exemptionReason: 1,
          accommodations: 1,
        }),
        materials: {
          create: [
            {
              id: c.otherRequiredMaterial,
              kind: "IDENTITY",
              label: "身份证复印件",
              metadata: JSON.stringify({
                fileName: "id-card.pdf",
                size: 245_000,
                mimeType: "application/pdf",
                uploadedAt: new Date().toISOString(),
              }),
            },
            ...(c.economicProof
              ? [
                  {
                    id: c.economicProof,
                    kind: "ECONOMIC_PROOF",
                    label: "经济困难证明",
                    metadata: JSON.stringify({ fileName: "proof.pdf" }),
                  },
                ]
              : []),
          ],
        },
        events: {
          create: [
            { fromState: "DRAFT", toState: "SUBMITTED", actor: "APPLICANT" },
            ...(needsCorrection
              ? [
                  {
                    fromState: "SUBMITTED",
                    toState: "NEEDS_CORRECTION",
                    actor: "STAFF",
                    note: "缺少经济困难证明",
                  },
                ]
              : []),
          ],
        },
      },
    });

    const correction = cases.corrections.find((x) => x.applicationId === c.id);
    if (correction) {
      const existing = await prisma.correction.findFirst({
        where: { applicationId: c.id, reasonCode: correction.reasonCode },
      });
      if (!existing) {
        await prisma.correction.create({
          data: {
            applicationId: c.id,
            fields: JSON.stringify(correction.fields),
            reasonCode: correction.reasonCode,
            note: "请补充经济困难证明，或修改免交情形。",
          },
        });
      }
    }
  }
  console.log(`Seeded ${cases.applications.length} applications`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
