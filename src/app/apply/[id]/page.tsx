import Link from "next/link";
import { prisma } from "@/lib/db";
import { serializeApplicantView } from "@/lib/services";
import { ApplyWizard } from "./ApplyWizard";

export const dynamic = "force-dynamic";

export default async function ApplyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id: id.toUpperCase() },
    include: {
      materials: true,
      corrections: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!app) {
    return (
      <>
        <h1>未找到申请</h1>
        <p role="alert">申请编号 {id} 不存在，请核对后重试。</p>
        <Link href="/" className="btn secondary">
          返回首页
        </Link>
      </>
    );
  }

  return <ApplyWizard initial={serializeApplicantView(app)} />;
}
