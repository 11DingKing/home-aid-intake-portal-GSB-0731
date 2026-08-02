import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  isStaffView,
  projectForStaffView,
  type StaffView,
} from "@/lib/disclosure";
import type { AppState } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

const VIEW_LABELS: Record<StaffView, string> = {
  INTAKE_REVIEW: "受理初审视图",
  CORRECTION_REVIEW: "补正复核视图",
};

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view: rawView } = await searchParams;
  const view: StaffView = isStaffView(rawView) ? rawView : "INTAKE_REVIEW";

  const apps = await prisma.application.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      materials: true,
      corrections: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const items = apps.map((a) =>
    projectForStaffView({ ...a, state: a.state as AppState }, view),
  );

  return (
    <>
      <h1>工作人员接续办理</h1>
      <p>
        当前视图只显示该环节必需的字段（最小披露）。切换视图：
        {(Object.keys(VIEW_LABELS) as StaffView[]).map((v) => (
          <span key={v}>
            {" "}
            <Link
              href={`/staff?view=${v}`}
              aria-current={v === view ? "true" : undefined}
            >
              {VIEW_LABELS[v]}
            </Link>
          </span>
        ))}
      </p>

      <table className="plain">
        <caption>申请列表（{VIEW_LABELS[view]}）</caption>
        <thead>
          <tr>
            <th scope="col">编号</th>
            <th scope="col">状态</th>
            {view === "INTAKE_REVIEW" ? (
              <>
                <th scope="col">免交情形</th>
                <th scope="col">材料元数据</th>
                <th scope="col">合理便利</th>
              </>
            ) : (
              <>
                <th scope="col">补正字段</th>
                <th scope="col">已提交字段元数据</th>
              </>
            )}
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const state = item.state as AppState;
            return (
              <tr key={item.id as string}>
                <td>{item.id as string}</td>
                <td>
                  <StatusBadge state={state} />
                </td>
                {view === "INTAKE_REVIEW" ? (
                  <>
                    <td>{String(item.exemptionReason ?? "")}</td>
                    <td>
                      {(
                        item.materialMetadata as Array<{
                          kind: string;
                          label: string;
                        }>
                      ).map((m, i) => (
                        <div key={i}>
                          {m.kind}：{m.label}
                        </div>
                      ))}
                    </td>
                    <td>
                      {(item.accommodations as string[]).join("、") || "无"}
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      {item.correctionFields
                        ? `${(item.correctionFields as { fields: string[] }).fields.join("、")}（${
                            (item.correctionFields as { reasonCode: string })
                              .reasonCode
                          }）`
                        : "—"}
                    </td>
                    <td>
                      <FieldMetaSummary
                        meta={
                          item.submittedFieldMetadata as Record<string, unknown>
                        }
                      />
                    </td>
                  </>
                )}
                <td>
                  <Link href={`/staff/${item.id as string}?view=${view}`}>
                    接续处理
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint">
        当前共 {items.length}{" "}
        件申请。列表按最近更新排序；状态同时以符号、文字与边框样式表达。
      </p>
      <p className="sr-only" aria-live="polite">
        已加载 {items.length} 件申请，当前视图 {VIEW_LABELS[view]}
      </p>
    </>
  );
}

function FieldMetaSummary({ meta }: { meta: Record<string, unknown> }) {
  return (
    <>
      {Object.entries(meta)
        .filter(([k]) => k !== "materials")
        .map(([k, v]) => (
          <div key={k}>
            {k}：{(v as { present: boolean }).present ? "已填" : "未填"}
          </div>
        ))}
    </>
  );
}
