import { describe, expect, it } from "vitest";
import { canTransition, nextState, StateTransitionError } from "./state-machine";
import { STATES } from "./constants";

describe("申请状态机", () => {
  it("合法流转", () => {
    expect(nextState("DRAFT", "SUBMIT")).toBe("SUBMITTED");
    expect(nextState("SUBMITTED", "REQUEST_CORRECTION")).toBe("NEEDS_CORRECTION");
    expect(nextState("NEEDS_CORRECTION", "RESUBMIT")).toBe("RESUBMITTED");
    expect(nextState("SUBMITTED", "ACCEPT")).toBe("ACCEPTED");
    expect(nextState("RESUBMITTED", "DECLINE")).toBe("DECLINED");
  });

  it("非法流转抛出 StateTransitionError", () => {
    expect(() => nextState("DRAFT", "ACCEPT")).toThrow(StateTransitionError);
    expect(() => nextState("ACCEPTED", "REQUEST_CORRECTION")).toThrow(StateTransitionError);
    expect(() => nextState("DECLINED", "RESUBMIT")).toThrow(StateTransitionError);
    expect(() => nextState("NEEDS_CORRECTION", "SUBMIT")).toThrow(StateTransitionError);
    expect(() => nextState("DRAFT", "RESUBMIT")).toThrow(StateTransitionError);
  });

  it("终态无任何出口", () => {
    expect(canTransition("ACCEPTED", "SUBMIT")).toBe(false);
    expect(canTransition("DECLINED", "ACCEPT")).toBe(false);
  });

  it("materials 中的所有状态都被状态机覆盖", () => {
    for (const s of STATES) {
      expect(typeof canTransition(s, "SUBMIT")).toBe("boolean");
    }
  });
});
