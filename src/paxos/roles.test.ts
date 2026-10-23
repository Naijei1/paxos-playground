import { describe, expect, it } from "vitest";
import { createWorld, propose } from "./engine";
import { messageRole, serverRoleLine, serverRoleTag } from "./roles";

describe("roles", () => {
  it("maps each message onto the role that is acting", () => {
    expect(messageRole("prepare").kind).toBe("scout");
    expect(messageRole("accept").kind).toBe("commander");
    expect(messageRole("learn").kind).toBe("learner");
    expect(messageRole("promise").kind).toBe("acceptor");
    expect(messageRole("accepted").kind).toBe("acceptor");
    expect(messageRole("nack").kind).toBe("acceptor");
  });

  it("names the role a server is playing right now", () => {
    const preparing = propose(createWorld(), "A", "Withdraw $80");
    const leader = preparing.servers.find((server) => server.id === "A");
    expect(serverRoleLine(leader!)).toBe("A as proposer (scout)");
    expect(serverRoleTag(leader!)).toBe("scout");
    const idle = preparing.servers.find((server) => server.id === "B");
    expect(serverRoleLine(idle!)).toBe("B as acceptor");
    expect(serverRoleTag(idle!)).toBeNull();
  });
});
