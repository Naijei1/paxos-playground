import { describe, expect, it } from "vitest";
import { nextHover } from "./hover";

describe("hover stability", () => {
  it("keeps the same state when the pointer is still on the same arrow", () => {
    const current = { title: "Prepare 1.A A → B", detail: "Still in flight.", messageId: "m1" };
    expect(nextHover(current, { ...current })).toBe(current);
  });

  it("replaces the state when the pointer moves to a different arrow", () => {
    const current = { title: "Prepare 1.A A → B", detail: "One.", messageId: "m1" };
    const incoming = { title: "Prepare 1.A A → C", detail: "Two.", messageId: "m2" };
    expect(nextHover(current, incoming)).toBe(incoming);
  });
});
