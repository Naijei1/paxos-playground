import type { Ballot } from "./types";

export function compareBallot(a: Ballot, b: Ballot): number {
  if (a.round !== b.round) return a.round - b.round;
  if (a.serverId === b.serverId) return 0;
  return a.serverId < b.serverId ? -1 : 1;
}

export function ballotEq(a: Ballot | null | undefined, b: Ballot | null | undefined): boolean {
  if (!a || !b) return false;
  return a.round === b.round && a.serverId === b.serverId;
}

export function formatBallot(ballot: Ballot): string {
  return `${ballot.round}.${ballot.serverId}`;
}

export function ballotKey(ballot: Ballot): string {
  return formatBallot(ballot);
}

export function isHigher(a: Ballot, b: Ballot): boolean {
  return compareBallot(a, b) > 0;
}
