import type { AppState } from "./constants";

export type TransitionAction =
  | "SUBMIT"
  | "REQUEST_CORRECTION"
  | "RESUBMIT"
  | "ACCEPT"
  | "DECLINE";

export const TRANSITIONS: Record<AppState, Partial<Record<TransitionAction, AppState>>> = {
  DRAFT: { SUBMIT: "SUBMITTED" },
  SUBMITTED: {
    REQUEST_CORRECTION: "NEEDS_CORRECTION",
    ACCEPT: "ACCEPTED",
    DECLINE: "DECLINED",
  },
  NEEDS_CORRECTION: { RESUBMIT: "RESUBMITTED" },
  RESUBMITTED: {
    REQUEST_CORRECTION: "NEEDS_CORRECTION",
    ACCEPT: "ACCEPTED",
    DECLINE: "DECLINED",
  },
  ACCEPTED: {},
  DECLINED: {},
};

export class StateTransitionError extends Error {
  readonly from: AppState;
  readonly action: TransitionAction;
  constructor(from: AppState, action: TransitionAction) {
    super(`非法状态流转：${from} 不能执行 ${action}`);
    this.name = "StateTransitionError";
    this.from = from;
    this.action = action;
  }
}

export function canTransition(from: AppState, action: TransitionAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

export function nextState(from: AppState, action: TransitionAction): AppState {
  const to = TRANSITIONS[from][action];
  if (to === undefined) throw new StateTransitionError(from, action);
  return to;
}
