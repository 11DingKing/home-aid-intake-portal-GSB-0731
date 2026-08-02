import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, isEditableState, isTerminalState, getNextState } from "@/domain/state-machine";

describe("state machine", () => {
  it("allows DRAFT -> SUBMITTED", () => {
    expect(canTransition("DRAFT", "SUBMITTED")).toBe(true);
  });

  it("allows SUBMITTED -> NEEDS_CORRECTION", () => {
    expect(canTransition("SUBMITTED", "NEEDS_CORRECTION")).toBe(true);
  });

  it("allows SUBMITTED -> ACCEPTED", () => {
    expect(canTransition("SUBMITTED", "ACCEPTED")).toBe(true);
  });

  it("allows SUBMITTED -> DECLINED", () => {
    expect(canTransition("SUBMITTED", "DECLINED")).toBe(true);
  });

  it("allows NEEDS_CORRECTION -> RESUBMITTED", () => {
    expect(canTransition("NEEDS_CORRECTION", "RESUBMITTED")).toBe(true);
  });

  it("allows RESUBMITTED -> NEEDS_CORRECTION", () => {
    expect(canTransition("RESUBMITTED", "NEEDS_CORRECTION")).toBe(true);
  });

  it("allows RESUBMITTED -> ACCEPTED", () => {
    expect(canTransition("RESUBMITTED", "ACCEPTED")).toBe(true);
  });

  it("disallows DRAFT -> ACCEPTED", () => {
    expect(canTransition("DRAFT", "ACCEPTED")).toBe(false);
  });

  it("disallows DRAFT -> NEEDS_CORRECTION", () => {
    expect(canTransition("DRAFT", "NEEDS_CORRECTION")).toBe(false);
  });

  it("disallows ACCEPTED -> any state", () => {
    expect(canTransition("ACCEPTED", "DRAFT")).toBe(false);
    expect(canTransition("ACCEPTED", "SUBMITTED")).toBe(false);
    expect(canTransition("ACCEPTED", "DECLINED")).toBe(false);
  });

  it("disallows DECLINED -> any state", () => {
    expect(canTransition("DECLINED", "DRAFT")).toBe(false);
    expect(canTransition("DECLINED", "ACCEPTED")).toBe(false);
  });

  it("assertTransition throws on invalid transition", () => {
    expect(() => assertTransition("DRAFT", "ACCEPTED")).toThrow("Invalid state transition");
  });

  it("assertTransition does not throw on valid transition", () => {
    expect(() => assertTransition("DRAFT", "SUBMITTED")).not.toThrow();
  });

  it("identifies editable states", () => {
    expect(isEditableState("DRAFT")).toBe(true);
    expect(isEditableState("NEEDS_CORRECTION")).toBe(true);
    expect(isEditableState("SUBMITTED")).toBe(false);
    expect(isEditableState("ACCEPTED")).toBe(false);
  });

  it("identifies terminal states", () => {
    expect(isTerminalState("ACCEPTED")).toBe(true);
    expect(isTerminalState("DECLINED")).toBe(true);
    expect(isTerminalState("DRAFT")).toBe(false);
    expect(isTerminalState("SUBMITTED")).toBe(false);
  });

  it("returns next states", () => {
    expect(getNextState("DRAFT")).toEqual(["SUBMITTED"]);
    expect(getNextState("SUBMITTED")).toEqual(["NEEDS_CORRECTION", "ACCEPTED", "DECLINED"]);
    expect(getNextState("ACCEPTED")).toEqual([]);
  });
});
