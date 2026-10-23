import type { MessageType, ServerState } from "./types";

export type RoleKind = "scout" | "commander" | "acceptor" | "learner";

export type RoleInfo = {
  kind: RoleKind;
  short: string;
  caption: string;
};

const ROLES: Record<RoleKind, RoleInfo> = {
  scout: { kind: "scout", short: "Scout", caption: "Proposer, phase 1" },
  commander: { kind: "commander", short: "Commander", caption: "Proposer, phase 2" },
  acceptor: { kind: "acceptor", short: "Acceptor", caption: "Promising or accepting" },
  learner: { kind: "learner", short: "Learner", caption: "Hearing the chosen value" },
};

export const ROLE_LEGEND: RoleInfo[] = [ROLES.scout, ROLES.commander, ROLES.acceptor, ROLES.learner];

export function messageRole(type: MessageType): RoleInfo {
  switch (type) {
    case "prepare":
      return ROLES.scout;
    case "accept":
      return ROLES.commander;
    case "learn":
      return ROLES.learner;
    case "promise":
    case "nack":
    case "accepted":
      return ROLES.acceptor;
  }
}

export function serverRoleLine(server: ServerState): string {
  if (!server.online) return `${server.id} is offline. Its acceptor disk is still there.`;
  if (server.proposal?.phase === "preparing") return `${server.id} as proposer (scout)`;
  if (server.proposal?.phase === "accepting") return `${server.id} as proposer (commander)`;
  if (server.learned) return `${server.id} as learner`;
  return `${server.id} as acceptor`;
}

export function serverRoleTag(server: ServerState): string | null {
  if (!server.online) return "down";
  if (server.proposal?.phase === "preparing") return "scout";
  if (server.proposal?.phase === "accepting") return "commander";
  if (server.learned) return "learner";
  return null;
}
