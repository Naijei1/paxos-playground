import type { RoleKind } from "./paxos/roles";

const fill: Record<RoleKind, string> = {
  scout: "#1b1714",
  commander: "#8a5a12",
  acceptor: "#1c6b45",
  learner: "#b34a22",
};

const letter: Record<RoleKind, string> = {
  scout: "S",
  commander: "C",
  acceptor: "A",
  learner: "L",
};

export function RoleGlyph({ kind, size = 16 }: { kind: RoleKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill={fill[kind]} />
      <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fbf7f0">
        {letter[kind]}
      </text>
    </svg>
  );
}
