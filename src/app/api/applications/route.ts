import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api-helpers";
import { serializeApplicantView } from "@/lib/services";

/** 新建空白草稿，返回申请 ID 与初始版本号。 */
export async function POST() {
  try {
    const id = `APP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const app = await prisma.application.create({
      data: { id, version: 1, fieldVersions: "{}" },
      include: { materials: true, corrections: true },
    });
    return NextResponse.json(serializeApplicantView(app), { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}
