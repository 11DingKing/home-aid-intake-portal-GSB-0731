import type { NextRequest } from "next/server";
import { createApplication } from "@/server/applicationService";
import { errorResponse, ok } from "@/server/http";

export const dynamic = "force-dynamic";

// POST /api/applications — start a new draft application.
export async function POST(_req: NextRequest) {
  try {
    const app = await createApplication();
    return ok(app, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
