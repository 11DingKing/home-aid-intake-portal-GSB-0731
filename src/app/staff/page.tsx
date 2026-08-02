"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/FormFields";

interface StaffListItem {
  id: string;
  state: string;
  exemptionReason: string;
  accommodations: string[];
  legalIssueType: string | null;
  view: string;
  idDocumentMeta: unknown;
  otherMaterialMeta: unknown;
  correctionFields?: string[];
}

export default function StaffListPage() {
  const [items, setItems] = useState<StaffListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    void fetch("/api/staff/applications", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        setItems(json.data || []);
        setAnnouncement(`共加载 ${json.data?.length || 0} 份待处理申请`);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <main id="main-content" className="container">
      <div className="page-header">
        <h1>工作人员工作台</h1>
        <p>待审核申请列表 · 最小信息披露原则</p>
      </div>

      <div aria-live="polite" aria-atomic="true" className="live-region" role="status">
        {announcement}
      </div>

      <div className="staff-disclosure-note">
        <strong>隐私保护：</strong>
        本页面仅显示审核所需的最少字段。申请人联系方式、案件详情等敏感信息仅在补正审核视图中按需展示。
      </div>

      {loading ? (
        <p>加载中...</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p>暂无待处理申请。</p>
        </div>
      ) : (
        <div className="card">
          <ul className="application-list">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={`/staff/${item.id}`} className="app-list-link">
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {item.id}
                      <span className="field-disclosure-tag">
                        {item.view === "CORRECTION_REVIEW" ? "补正审核" : "收件审核"}
                      </span>
                    </div>
                    <div className="app-list-meta">
                      {item.legalIssueType
                        ? {
                            FAMILY_LAW: "婚姻家事",
                            HOUSING: "住房纠纷",
                            EMPLOYMENT: "劳动争议",
                            IMMIGRATION: "移民事务",
                            CRIMINAL_DEFENSE: "刑事辩护",
                            CONSUMER_RIGHTS: "消费者权益",
                            PUBLIC_BENEFITS: "公共福利",
                            OTHER: "其他",
                          }[item.legalIssueType] || item.legalIssueType
                        : "未填写案件类型"}
                      {item.accommodations.length > 0 && (
                        <span style={{ marginLeft: "8px", color: "var(--color-primary)" }}>
                          · 含合理便利需求
                        </span>
                      )}
                      {item.correctionFields && item.correctionFields.length > 0 && (
                        <span style={{ marginLeft: "8px", color: "var(--color-warning)" }}>
                          · 待补正：{item.correctionFields.join("、")}
                        </span>
                      )}
                    </div>
                  </div>
                  <StatusBadge state={item.state} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p>
        <Link href="/">返回首页</Link>
      </p>
    </main>
  );
}
