import { describe, it, expect } from "vitest";
import {
  nextState,
  canTransition,
  assertTransition,
  allowedActions,
  isTerminal,
  canEditFields,
  StateTransitionError,
} from "@/domain/stateMachine";

describe("state machine", () => {
  it("allows the happy-path submit and staff decisions", () => {
    expect(nextState("DRAFT", "submit")).toBe("SUBMITTED");
    expect(nextState("SUBMITTED", "accept")).toBe("ACCEPTED");
    expect(nextState("SUBMITTED", "decline")).toBe("DECLINED");
    expect(nextState("SUBMITTED", "requestCorrection")).toBe("NEEDS_CORRECTION");
  });

  it("models the correction / resubmit loop", () => {
    expect(nextState("NEEDS_CORRECTION", "resubmit")).toBe("RESUBMITTED");
    expect(nextState("RESUBMITTED", "requestCorrection")).toBe("NEEDS_CORRECTION");
    expect(nextState("RESUBMITTED", "accept")).toBe("ACCEPTED");
    expect(nextState("RESUBMITTED", "decline")).toBe("DECLINED");
  });

  it("rejects illegal transitions", () => {
    expect(nextState("DRAFT", "accept")).toBeNull();
    expect(nextState("ACCEPTED", "submit")).toBeNull();
    expect(nextState("DECLINED", "resubmit")).toBeNull();
    expect(canTransition("SUBMITTED", "submit")).toBe(false);
  });

  it("supports amendCorrection as a NEEDS_CORRECTION self-loop only", () => {
    // Staff may refine a correction while the applicant is still editing.
    expect(nextState("NEEDS_CORRECTION", "amendCorrection")).toBe("NEEDS_CORRECTION");
    // But amend is not legal from other states.
    expect(nextState("SUBMITTED", "amendCorrection")).toBeNull();
    expect(nextState("RESUBMITTED", "amendCorrection")).toBeNull();
    expect(nextState("ACCEPTED", "amendCorrection")).toBeNull();
  });

  it("rejects illegal backward transitions (no un-accepting / un-declining / un-submitting)", () => {
    // Terminal states cannot move backward.
    expect(nextState("ACCEPTED", "requestCorrection")).toBeNull();
    expect(nextState("ACCEPTED", "resubmit")).toBeNull();
    expect(nextState("DECLINED", "requestCorrection")).toBeNull();
    // A submitted application cannot be pushed back to draft via any action.
    for (const action of ["submit", "resubmit", "amendCorrection"] as const) {
      expect(nextState("SUBMITTED", action)).not.toBe("DRAFT");
    }
    // NEEDS_CORRECTION only advances (resubmit) or self-loops (amend); it never
    // regresses to SUBMITTED or DRAFT.
    expect(nextState("NEEDS_CORRECTION", "submit")).toBeNull();
    expect(canTransition("NEEDS_CORRECTION", "accept")).toBe(false);
  });

  it("assertTransition throws a typed error on illegal transitions", () => {
    expect(() => assertTransition("ACCEPTED", "submit")).toThrow(StateTransitionError);
    try {
      assertTransition("DRAFT", "accept");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      expect((err as StateTransitionError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("treats ACCEPTED and DECLINED as terminal", () => {
    expect(isTerminal("ACCEPTED")).toBe(true);
    expect(isTerminal("DECLINED")).toBe(true);
    expect(allowedActions("ACCEPTED")).toHaveLength(0);
    expect(allowedActions("DECLINED")).toHaveLength(0);
  });

  it("permits field edits only in DRAFT and NEEDS_CORRECTION", () => {
    expect(canEditFields("DRAFT")).toBe(true);
    expect(canEditFields("NEEDS_CORRECTION")).toBe(true);
    expect(canEditFields("SUBMITTED")).toBe(false);
    expect(canEditFields("RESUBMITTED")).toBe(false);
    expect(canEditFields("ACCEPTED")).toBe(false);
  });
});
