import { STATE_LABELS, type AppState } from "@/lib/constants";

const STATE_ICONS: Record<AppState, string> = {
  DRAFT: "◐",
  SUBMITTED: "▶",
  NEEDS_CORRECTION: "↺",
  RESUBMITTED: "⇧",
  ACCEPTED: "✓",
  DECLINED: "✕",
};

/**
 * 状态徽标：图形符号 + 文字 + 边框样式共同表达状态，不依赖单一颜色。
 */
export function StatusBadge({ state }: { state: AppState }) {
  return (
    <span className="badge" data-state={state}>
      <span className="icon" aria-hidden="true">
        {STATE_ICONS[state]}
      </span>
      <span>状态：{STATE_LABELS[state]}</span>
    </span>
  );
}
