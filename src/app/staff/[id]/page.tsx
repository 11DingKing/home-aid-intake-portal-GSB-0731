import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  isStaffView,
  projectForStaffView,
  type StaffView,
} from "@/lib/disclosure";
import type { AppState } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { StaffActions } from "./StaffActions";
import { StaffCorrectionEditor } from "./StaffCorrectionEditor";

export const dynamic = "force-dynamic";

const VIEW_LABELS: Record<StaffView, string> = {
  INTAKE_REVIEW: "受理初审视图",
  CORRECTION_REVIEW: "补正复核视图",
};

function safeStringArray(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view: rawView } = await searchParams;
  const view: StaffView = isStaffView(rawView) ? rawView : "INTAKE_REVIEW";

  const app = await prisma.application.findUnique({
    where: { id },
    include: {
      materials: true,
      corrections: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  if (!app) {
    return (
      <>
        <h1>未找到申请</h1>
        <p role="alert">申请编号 {id} 不存在。</p>
        <Link href="/staff">返回列表</Link>
      </>
    );
  }

  const projected = projectForStaffView(
    { ...app, state: app.state as AppState },
    view,
  );
  const actionable = app.state === "SUBMITTED" || app.state === "RESUBMITTED";

  return (
    <>
      <h1>接续处理 {app.id}</h1>
      <p>
        当前视图：{VIEW_LABELS[view]}（最小披露）。切换：
        {(Object.keys(VIEW_LABELS) as StaffView[]).map((v) => (
          <span key={v}>
            {" "}
            <Link
              href={`/staff/${app.id}?view=${v}`}
              aria-current={v === view ? "true" : undefined}
            >
              {VIEW_LABELS[v]}
            </Link>
          </span>
        ))}
      </p>

      <section className="card" aria-labelledby="projected-heading">
        <h2 id="projected-heading">可见字段</h2>
        <dl>
          {Object.entries(projected).map(([key, value]) => (
            <div key={key} style={{ marginBlock: "0.5rem" }}>
              <dt style={{ fontWeight: 700 }}>{key}</dt>
              <dd style={{ margin: 0 }}>
                {key === "state" ? (
                  <StatusBadge state={value as AppState} />
                ) : (
                  <code data-testid={`projected-${key}`}>
                    {JSON.stringify(value, null, 1)}
                  </code>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <StaffActions
        id={app.id}
        state={app.state as AppState}
        view={view}
        actionable={actionable}
      />

      {app.state === "NEEDS_CORRECTION" && app.corrections[0] ? (
        <StaffCorrectionEditor
          id={app.id}
          initialVersion={app.version}
          initial={{
            fields: safeStringArray(app.corrections[0].fields),
            reasonCode: app.corrections[0].reasonCode,
            note: app.corrections[0].note,
          }}
        />
      ) : null}

      <p>
        <Link href={`/staff?view=${view}`}>返回列表</Link>
      </p>
    </>
  );
}
