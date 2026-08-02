import type { ApplicationState } from "./constants";

// Application state machine.
//
//   DRAFT ──submit──▶ SUBMITTED
//   SUBMITTED ──requestCorrection──▶ NEEDS_CORRECTION
//   SUBMITTED ──accept──▶ ACCEPTED
//   SUBMITTED ──decline──▶ DECLINED
//   NEEDS_CORRECTION ──resubmit──▶ RESUBMITTED
//   RESUBMITTED ──requestCorrection──▶ NEEDS_CORRECTION
//   RESUBMITTED ──accept──▶ ACCEPTED
//   RESUBMITTED ──decline──▶ DECLINED
//
// ACCEPTED and DECLINED are terminal. Drafts can be patched while in DRAFT or
// NEEDS_CORRECTION (the applicant edits the flagged fields, then resubmits).

export type ApplicationAction =
  | "submit"
  | "requestCorrection"
  | "amendCorrection"
  | "resubmit"
  | "accept"
  | "decline";

export const ACTOR_BY_ACTION: Record<ApplicationAction, "applicant" | "staff"> = {
  submit: "applicant",
  resubmit: "applicant",
  requestCorrection: "staff",
  amendCorrection: "staff",
  accept: "staff",
  decline: "staff",
};

const TRANSITIONS: Record<ApplicationState, Partial<Record<ApplicationAction, ApplicationState>>> = {
  DRAFT: { submit: "SUBMITTED" },
  SUBMITTED: {
    requestCorrection: "NEEDS_CORRECTION",
    accept: "ACCEPTED",
    decline: "DECLINED",
  },
  // amendCorrection is a self-loop: staff can add/refine a correction reason code
  // while the applicant is concurrently supplementing materials in this state.
  NEEDS_CORRECTION: { resubmit: "RESUBMITTED", amendCorrection: "NEEDS_CORRECTION" },
  RESUBMITTED: {
    requestCorrection: "NEEDS_CORRECTION",
    accept: "ACCEPTED",
    decline: "DECLINED",
  },
  ACCEPTED: {},
  DECLINED: {},
};

// States where the applicant may still patch draft fields.
const EDITABLE_STATES: ReadonlySet<ApplicationState> = new Set(["DRAFT", "NEEDS_CORRECTION"]);

export const TERMINAL_STATES: ReadonlySet<ApplicationState> = new Set(["ACCEPTED", "DECLINED"]);

export function canEditFields(state: ApplicationState): boolean {
  return EDITABLE_STATES.has(state);
}

export function isTerminal(state: ApplicationState): boolean {
  return TERMINAL_STATES.has(state);
}

export function nextState(
  state: ApplicationState,
  action: ApplicationAction,
): ApplicationState | null {
  return TRANSITIONS[state][action] ?? null;
}

export function canTransition(state: ApplicationState, action: ApplicationAction): boolean {
  return nextState(state, action) !== null;
}

export function allowedActions(state: ApplicationState): ApplicationAction[] {
  return Object.keys(TRANSITIONS[state]) as ApplicationAction[];
}

export class StateTransitionError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(
    readonly from: ApplicationState,
    readonly action: ApplicationAction,
  ) {
    super(`Cannot ${action} from state ${from}`);
    this.name = "StateTransitionError";
  }
}

export function assertTransition(
  state: ApplicationState,
  action: ApplicationAction,
): ApplicationState {
  const to = nextState(state, action);
  if (to === null) throw new StateTransitionError(state, action);
  return to;
}
