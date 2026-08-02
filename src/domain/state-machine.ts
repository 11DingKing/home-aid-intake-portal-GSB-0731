import type { ApplicationState } from "./types";

const TRANSITIONS: Record<ApplicationState, ApplicationState[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["NEEDS_CORRECTION", "ACCEPTED", "DECLINED"],
  NEEDS_CORRECTION: ["RESUBMITTED"],
  RESUBMITTED: ["NEEDS_CORRECTION", "ACCEPTED", "DECLINED"],
  ACCEPTED: [],
  DECLINED: [],
};

export function canTransition(from: ApplicationState, to: ApplicationState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ApplicationState, to: ApplicationState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid state transition: ${from} -> ${to}`);
  }
}

export function isEditableState(state: ApplicationState): boolean {
  return state === "DRAFT" || state === "NEEDS_CORRECTION";
}

export function isTerminalState(state: ApplicationState): boolean {
  return state === "ACCEPTED" || state === "DECLINED";
}

export function getNextState(current: ApplicationState): ApplicationState[] {
  return TRANSITIONS[current] ?? [];
}
