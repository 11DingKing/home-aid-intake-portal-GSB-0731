import Link from "next/link";
import { getStaffContinuation } from "@/server/applicationService";
import { prisma } from "@/server/db";
import { STAFF_VIEWS, isApplicationState, type StaffViewName } from "@/domain/constants";
import StatusBadge from "@/components/StatusBadge";
import StaffActions from "./StaffActions";

export const dynamic = "force-dynamic";

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view: viewParam } = await searchParams;

  const app = await prisma.application.findUnique({ where: { id }, select: { state: true, version: true } });
  if (!app) {
    return (
      <section aria-labelledby="sd-notfound">
        <h1 id="sd-notfound">Application not found</h1>
        <div className="banner" data-tone="error" role="alert">
          <span className="banner-title">Not found: </span>No application <strong>{id}</strong>.
        </div>
        <p>
          <Link href="/staff">Back to queue</Link>
        </p>
      </section>
    );
  }

  const state = isApplicationState(app.state) ? app.state : "DRAFT";
  // Server recomputes the disclosure view from the CURRENT state — a stale
  // `?view=` link can never widen disclosure in the rendered HTML. Over-privileged
  // fields are never projected, so they cannot appear in the markup at all.
  const continuation = await getStaffContinuation(id, viewParam ?? null);
  const view = continuation.enforcedView;
  const disclosed = continuation.disclosed;
  const allowedKeys = STAFF_VIEWS[view] as readonly string[];

  return (
    <section aria-labelledby="sd-heading">
      <p>
        <Link href="/staff">← Back to queue</Link>
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <h1 id="sd-heading">Continue application {id}</h1>
        <StatusBadge state={state} />
      </div>

      {continuation.downgraded ? (
        <div className="banner" data-tone="warn" role="status" data-testid="stale-view-notice">
          <span className="banner-title">View adjusted: </span>
          This link requested the <strong>{continuation.requestedView}</strong> view, but the
          application is now <strong>{state}</strong>. You are seeing the
          state-appropriate <strong>{view}</strong> view; the change is recorded in the audit trail.
        </div>
      ) : null}

      <div className="banner" data-tone="info" role="note" data-testid="disclosure-note">
        <span className="banner-title">Minimal disclosure: </span>
        You are viewing the <strong data-testid="active-view">{view}</strong> fields only
        ({allowedKeys.join(", ")}). Other applicant information is not loaded on this screen.
      </div>

      <ViewSwitcher id={id} current={view} />

      <div className="card">
        <h2>Disclosed fields</h2>
        <dl className="meta" data-testid="disclosed-fields">
          {allowedKeys.map((key) => (
            <DisclosedRow key={key} field={key} value={disclosed[key]} />
          ))}
        </dl>
      </div>

      <StaffActions id={id} state={state} version={app.version} />
    </section>
  );
}

function ViewSwitcher({ id, current }: { id: string; current: StaffViewName }) {
  return (
    <nav aria-label="Disclosure view" className="button-row">
      {(Object.keys(STAFF_VIEWS) as StaffViewName[]).map((v) => (
        <Link
          key={v}
          href={`/staff/${id}?view=${v}`}
          aria-current={v === current ? "true" : undefined}
          className="status"
          data-state={v === current ? "SUBMITTED" : "DRAFT"}
          style={{ textDecoration: "none" }}
        >
          {v === current ? "● " : "○ "}
          {v}
        </Link>
      ))}
    </nav>
  );
}

function DisclosedRow({ field, value }: { field: string; value: unknown }) {
  return (
    <>
      <dt>{humanizeKey(field)}</dt>
      <dd data-testid={`field-${field}`}>{renderValue(field, value)}</dd>
    </>
  );
}

function humanizeKey(key: string): string {
  const map: Record<string, string> = {
    id: "Application ID",
    state: "State",
    exemptionReason: "Eligibility basis",
    materialMetadata: "Material metadata",
    accommodations: "Accommodations",
    correctionFields: "Fields to correct",
    submittedFieldMetadata: "Submitted field metadata",
  };
  return map[key] ?? key;
}

function renderValue(field: string, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return <em>—</em>;

  if (field === "materialMetadata" && Array.isArray(value)) {
    if (value.length === 0) return <em>No materials</em>;
    return (
      <ul>
        {value.map((m: unknown, i: number) => {
          const meta = m as { id: string; kind: string; filename: string; mimeType: string; sizeBytes: number };
          return (
            <li key={meta.id ?? i}>
              <strong>{meta.kind}</strong>: {meta.filename} ({meta.mimeType}, {meta.sizeBytes} bytes)
            </li>
          );
        })}
      </ul>
    );
  }

  if (field === "submittedFieldMetadata" && Array.isArray(value)) {
    return (
      <ul>
        {value.map((m: unknown, i: number) => {
          const meta = m as { key: string; present: boolean; updatedAtVersion: number };
          return (
            <li key={meta.key ?? i}>
              {meta.key}: {meta.present ? "provided" : "missing"} (v{meta.updatedAtVersion})
            </li>
          );
        })}
      </ul>
    );
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : <em>None</em>;
  }
  if (field === "state" && typeof value === "string" && isApplicationState(value)) {
    return <StatusBadge state={value} />;
  }
  return String(value);
}
