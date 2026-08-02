import type { ApplicationState } from "@/domain/constants";

const LABELS: Record<ApplicationState, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  NEEDS_CORRECTION: "Needs correction",
  RESUBMITTED: "Resubmitted",
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
};

// Status is communicated with an icon (via CSS ::before), a text label, AND a
// shape/border — never color alone. The state is also exposed to assistive tech
// through the visually-hidden prefix and a stable data attribute.
export default function StatusBadge({ state }: { state: ApplicationState }) {
  return (
    <span className="status" data-state={state} data-testid="status-badge">
      <span className="sr-only">Status: </span>
      {LABELS[state]}
    </span>
  );
}
