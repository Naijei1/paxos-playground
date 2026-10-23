import type { DiagramArrow, ServerId } from "./paxos/types";

export const POPOVER_WIDTH = 272;
export const POPOVER_HEIGHT = 40;

const MARGIN = 8;
const HEAD_CLEARANCE = 22;

export function popoverBox(
  arrow: DiagramArrow,
  xOf: (time: number) => number,
  yOf: (id: ServerId) => number,
  nowX: number,
  width: number,
  height: number,
) {
  const x1 = xOf(arrow.sendTime);
  const y1 = yOf(arrow.from);
  const x2 = arrow.status === "inflight" ? nowX : endX(arrow, xOf);
  const y2 = yOf(arrow.to);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const candidates = [
    { left: midX - POPOVER_WIDTH / 2, top: midY - POPOVER_HEIGHT - HEAD_CLEARANCE },
    { left: midX - POPOVER_WIDTH / 2, top: midY + HEAD_CLEARANCE },
    { left: x2 - POPOVER_WIDTH - HEAD_CLEARANCE, top: y2 - POPOVER_HEIGHT - HEAD_CLEARANCE },
    { left: x2 + HEAD_CLEARANCE, top: y2 - POPOVER_HEIGHT - HEAD_CLEARANCE },
    { left: MARGIN, top: MARGIN },
  ];
  const clamped = candidates.map(clamp);
  return clamped.find((box) => !coversPoint(box, x2, y2, HEAD_CLEARANCE)) ?? clamped[0]!;

  function clamp(box: { left: number; top: number }) {
    const maxLeft = Math.max(MARGIN, width - POPOVER_WIDTH - MARGIN);
    const maxTop = Math.max(MARGIN, height - POPOVER_HEIGHT - MARGIN);
    return {
      left: Math.min(Math.max(box.left, MARGIN), maxLeft),
      top: Math.min(Math.max(box.top, MARGIN), maxTop),
    };
  }
}

function coversPoint(box: { left: number; top: number }, x: number, y: number, pad: number) {
  return x >= box.left - pad && x <= box.left + POPOVER_WIDTH + pad && y >= box.top - pad && y <= box.top + POPOVER_HEIGHT + pad;
}

function endX(arrow: DiagramArrow, xOf: (time: number) => number) {
  const at = xOf(arrow.endTime ?? arrow.sendTime);
  if (arrow.status === "dropped" && arrow.endTime === arrow.sendTime) return at + 22;
  return at;
}
