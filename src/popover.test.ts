import { describe, expect, it } from "vitest";
import { POPOVER_HEIGHT, POPOVER_WIDTH, popoverBox } from "./popover";
import type { DiagramArrow } from "./paxos/types";

const xOf = (time: number) => 16 + time * 52;
const yOf = (id: "A" | "B" | "C" | "D" | "E") => 28 + ["A", "B", "C", "D", "E"].indexOf(id) * 78 + 39;

function arrow(partial: Partial<DiagramArrow> & Pick<DiagramArrow, "from" | "to">): DiagramArrow {
  return {
    messageId: "m",
    type: "prepare",
    label: "Prepare 1.A",
    detail: "in flight",
    sendTime: 1,
    endTime: null,
    status: "inflight",
    ...partial,
  };
}

describe("popover placement", () => {
  it("stays inside the diagram and clear of an arrowhead on the bottom row", () => {
    const message = arrow({ from: "A", to: "E", sendTime: 2 });
    const nowX = xOf(6);
    const width = nowX + 28;
    const height = 28 + 5 * 78 + 18;
    const box = popoverBox(message, xOf, yOf, nowX, width, height);
    const headX = nowX;
    const headY = yOf("E");
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.left + POPOVER_WIDTH).toBeLessThanOrEqual(width - 8);
    expect(box.top + POPOVER_HEIGHT).toBeLessThanOrEqual(height - 8);
    const coversHead =
      headX >= box.left - 18 && headX <= box.left + POPOVER_WIDTH + 18 && headY >= box.top - 18 && headY <= box.top + POPOVER_HEIGHT + 18;
    expect(coversHead).toBe(false);
  });

  it("keeps a short top-row arrow inside the diagram", () => {
    const message = arrow({ from: "A", to: "B", sendTime: 0 });
    const box = popoverBox(message, xOf, yOf, xOf(2), 400, 436);
    expect(box.top).toBeGreaterThanOrEqual(8);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.top + POPOVER_HEIGHT).toBeLessThanOrEqual(428);
  });
});
