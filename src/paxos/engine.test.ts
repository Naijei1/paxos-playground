import { describe, expect, it } from "vitest";
import { compareBallot, formatBallot } from "./ballot";
import {
  checkInvariants,
  crash,
  createWorld,
  delay,
  deliver,
  drop,
  heal,
  nextAutoMessage,
  propose,
  restart,
  setPartition,
  setPartitionMode,
  splitThreeTwo,
} from "./engine";
import { isComplete, scenarioById } from "./scenarios";
import { MAJORITY, SERVER_IDS, type ServerId, type World } from "./types";

function pump(world: World, max = 40): World {
  let next = world;
  for (let step = 0; step < max; step += 1) {
    const message = nextAutoMessage(next);
    if (!message) break;
    next = deliver(next, message.id);
  }
  return next;
}

function findMessage(world: World, predicate: (message: World["queue"][number]) => boolean) {
  const message = world.queue.find(predicate);
  if (!message) throw new Error(`missing message: ${world.queue.map((item) => `${item.type}:${item.from}->${item.to}`).join(" ")}`);
  return message;
}

function expectSafe(world: World): void {
  const errors = checkInvariants(world);
  if (errors.length) throw new Error(errors.join("; "));
}

describe("timeline", () => {
  it("keeps in-flight arrows until delivery or a drop", () => {
    let world = propose(createWorld(), "A", "red");
    expect(world.diagram.arrows.filter((arrow) => arrow.status === "inflight")).toHaveLength(4);
    expect(world.diagram.events.some((event) => event.kind === "promise" && event.server === "A")).toBe(true);
    const first = world.queue[0]!;
    world = deliver(world, first.id);
    expect(world.diagram.arrows.find((arrow) => arrow.messageId === first.id)?.status).toBe("delivered");
    const second = world.queue[0]!;
    world = drop(world, second.id);
    const dropped = world.diagram.arrows.find((arrow) => arrow.messageId === second.id);
    expect(dropped?.status).toBe("dropped");
    expect(dropped?.endTime).not.toBeNull();
    world = crash(world, "B");
    expect(world.diagram.events.some((event) => event.kind === "crash" && event.server === "B")).toBe(true);
    world = restart(world, "B");
    expect(world.diagram.events.some((event) => event.kind === "restart" && event.server === "B")).toBe(true);
    expectSafe(world);
  });

  it("marks the time a majority accepts", () => {
    const world = pump(propose(createWorld(), "A", "Withdraw $80"));
    expect(world.diagram.chosenAt?.label).toContain("Withdraw $80");
    expect(world.diagram.chosenAt?.time).toBeGreaterThan(0);
    expectSafe(world);
  });
});

describe("ballots", () => {
  it("orders by round, then by server letter", () => {
    const lower = { round: 1, serverId: "E" as const };
    const higherRound = { round: 2, serverId: "A" as const };
    const higherLetter = { round: 1, serverId: "D" as const };
    expect(compareBallot(higherRound, lower)).toBeGreaterThan(0);
    expect(compareBallot(higherLetter, { round: 1, serverId: "A" })).toBeGreaterThan(0);
    expect(formatBallot(higherRound)).toBe("2.A");
  });
});

describe("happy path", () => {
  it("chooses a value only after three accepts, and learning is separate", () => {
    let world = propose(createWorld(), "A", "Withdraw $80");
    expect(world.chosen).toBeNull();
    expect(world.queue.filter((message) => message.type === "prepare")).toHaveLength(4);
    expect(world.servers[0]?.promised).toEqual({ round: 1, serverId: "A" });
    expect(world.servers[0]?.accepted).toBeNull();

    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "B").id);
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "C").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "B").id);
    expect(world.servers[0]?.proposal?.phase).toBe("preparing");

    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "C").id);
    expect(world.servers[0]?.proposal?.phase).toBe("accepting");
    if (world.servers[0]?.proposal?.phase === "accepting") {
      expect(world.servers[0].proposal.value).toBe("Withdraw $80");
      expect(world.servers[0].proposal.quorum).toEqual(["A", "B", "C"]);
    }
    expect(world.chosen).toBeNull();
    expect(world.servers[0]?.accepted?.value).toBe("Withdraw $80");
    expect(world.servers.every((server) => server.learned === null)).toBe(true);

    world = deliver(world, findMessage(world, (message) => message.type === "accept" && message.to === "B").id);
    expect(world.chosen).toBeNull();
    world = deliver(world, findMessage(world, (message) => message.type === "accept" && message.to === "C").id);
    expect(world.chosen?.value).toBe("Withdraw $80");
    expect(world.chosen?.acceptors.sort()).toEqual(["A", "B", "C"]);
    expect(world.servers.every((server) => server.learned === null)).toBe(true);

    world = deliver(world, findMessage(world, (message) => message.type === "accepted" && message.from === "B").id);
    world = deliver(world, findMessage(world, (message) => message.type === "accepted" && message.from === "C").id);
    expect(world.servers[0]?.learned?.value).toBe("Withdraw $80");
    expect(world.servers[1]?.learned).toBeNull();

    world = deliver(world, findMessage(world, (message) => message.type === "learn" && message.to === "E").id);
    expect(world.servers.find((server) => server.id === "E")?.learned?.value).toBe("Withdraw $80");
    expect(world.servers.find((server) => server.id === "D")?.learned).toBeNull();
    expectSafe(world);
  });

  it("keeps the choice after later ballots overwrite an acceptor's latest vote", () => {
    let world = pump(propose(createWorld(), "A", "Withdraw $80"));
    expect(world.chosen?.value).toBe("Withdraw $80");
    world = pump(propose(world, "E", "Withdraw $50"));
    expect(world.chosen?.value).toBe("Withdraw $80");
    expect(world.events.some((event) => event.kind === "phase2" && event.value === "Withdraw $80" && event.requested === "Withdraw $50")).toBe(true);
    const latest = world.servers.map((server) => server.accepted?.ballot.round ?? 0);
    expect(Math.max(...latest)).toBeGreaterThan(1);
    expectSafe(world);
  });
});

describe("quorum value selection", () => {
  it("forces red when the only red acceptor is inside the promise quorum", () => {
    let world = scenarioById("unfinished").build();
    world = propose(world, "B", "blue");
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "A").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "A").id);
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "D").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "D").id);
    const phase = world.events.find((event) => event.kind === "phase2");
    expect(phase).toMatchObject({ requested: "blue", value: "red" });
    expect(world.log.some((entry) => entry.text.includes('must propose "red"'))).toBe(true);
    expect(isComplete("unfinished", world)).toBe(true);
    expectSafe(world);
  });

  it("allows blue when the promise quorum excludes the only red acceptor", () => {
    let world = scenarioById("unfinished").build();
    world = propose(world, "B", "blue");
    world = delay(world, findMessage(world, (message) => message.type === "prepare" && message.to === "A").id);
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "D").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "D").id);
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "E").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "E").id);
    const phase = world.events.find((event) => event.kind === "phase2");
    expect(phase).toMatchObject({ requested: "blue", value: "blue", constraint: null });
    expect(world.chosen).toBeNull();

    world = deliver(world, findMessage(world, (message) => message.type === "accept" && message.to === "D").id);
    world = deliver(world, findMessage(world, (message) => message.type === "accept" && message.to === "E").id);
    expect(world.chosen?.value).toBe("blue");
    expect(world.servers.find((server) => server.id === "A")?.accepted?.value).toBe("red");
    expect(world.log.some((entry) => entry.text.includes("A last accepted"))).toBe(true);
    expectSafe(world);
  });

  it("ignores a promise that arrives after the quorum locked the value", () => {
    let world = scenarioById("unfinished").build();
    world = propose(world, "B", "blue");
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "D").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "D").id);
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "E").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "E").id);
    expect(world.servers.find((server) => server.id === "B")?.proposal?.phase).toBe("accepting");
    world = deliver(world, findMessage(world, (message) => message.type === "prepare" && message.to === "A").id);
    world = deliver(world, findMessage(world, (message) => message.type === "promise" && message.from === "A").id);
    if (world.servers.find((server) => server.id === "B")?.proposal?.phase === "accepting") {
      expect(world.servers.find((server) => server.id === "B")?.proposal).toMatchObject({ value: "blue" });
    }
    expectSafe(world);
  });
});

describe("crashes, drops, and partitions", () => {
  it("drops messages to a crashed server and restores only disk state", () => {
    let world = pump(propose(createWorld(), "A", "Withdraw $80"));
    expect(world.servers[0]?.learned?.value).toBe("Withdraw $80");
    world = crash(world, "A");
    const crashed = world.servers[0];
    expect(crashed?.online).toBe(false);
    expect(crashed?.proposal).toBeNull();
    expect(crashed?.learned).toBeNull();
    expect(crashed?.accepted?.value).toBe("Withdraw $80");
    expect(crashed?.promised).toEqual({ round: 1, serverId: "A" });
    world = restart(world, "A");
    expect(world.servers[0]?.online).toBe(true);
    expect(world.servers[0]?.learned).toBeNull();
    expect(world.servers[0]?.accepted?.value).toBe("Withdraw $80");

    let busy = propose(createWorld(), "B", "Withdraw $50");
    busy = crash(busy, "A");
    const incoming = busy.queue.find((message) => message.to === "A");
    expect(incoming).toBeTruthy();
    busy = deliver(busy, incoming!.id);
    expect(busy.queue.some((message) => message.id === incoming!.id)).toBe(false);
    expect(busy.servers[0]?.accepted).toBeNull();
    expect(busy.log.some((entry) => entry.text.includes("offline"))).toBe(true);
    expectSafe(world);
    expectSafe(busy);
  });

  it("holds cross-partition messages until the network heals", () => {
    let world = splitThreeTwo(createWorld());
    world = propose(world, "A", "Withdraw $80");
    const held = findMessage(world, (message) => message.to === "D");
    const before = world.queue.length;
    world = deliver(world, held.id);
    expect(world.queue.some((message) => message.id === held.id)).toBe(true);
    expect(world.queue).toHaveLength(before);
    world = heal(world);
    world = deliver(world, held.id);
    expect(world.queue.some((message) => message.id === held.id)).toBe(false);
    expect(world.servers.find((server) => server.id === "D")?.promised?.serverId).toBe("A");
    expectSafe(world);
  });

  it("can drop cross-partition messages instead of holding them", () => {
    let world = setPartitionMode(splitThreeTwo(createWorld()), "drop");
    world = propose(world, "A", "red");
    expect(world.queue.some((message) => message.to === "D" || message.to === "E")).toBe(false);
    expect(world.queue.some((message) => message.to === "B")).toBe(true);
    expectSafe(world);
  });

  it("lets the majority side choose and blocks the pair", () => {
    const majority = pump(propose(scenarioById("partition").build(), "A", "Withdraw $80"));
    expect(majority.chosen?.value).toBe("Withdraw $80");
    expect(isComplete("partition", majority)).toBe(true);

    const minority = pump(propose(scenarioById("partition").build(), "D", "Withdraw $50"));
    expect(minority.chosen).toBeNull();
    const proposal = minority.servers.find((server) => server.id === "D")?.proposal;
    expect(proposal?.phase).toBe("preparing");
    if (proposal?.phase === "preparing") expect(proposal.promises.length).toBeLessThan(MAJORITY);
    expectSafe(majority);
    expectSafe(minority);
  });

  it("removes a dropped message and reorders with delay", () => {
    let world = propose(createWorld(), "A", "red");
    const first = world.queue[0];
    expect(first).toBeTruthy();
    world = delay(world, first!.id);
    expect(world.queue[world.queue.length - 1]?.id).toBe(first!.id);
    world = drop(world, first!.id);
    expect(world.queue.some((message) => message.id === first!.id)).toBe(false);
    world = setPartition(world, "E", 2);
    expect(world.servers.find((server) => server.id === "E")?.partition).toBe(2);
    expectSafe(world);
  });
});

describe("challenges are solvable", () => {
  it("completes the first decision", () => {
    const world = pump(propose(scenarioById("first").build(), "C", "Withdraw $50"));
    expect(isComplete("first", world)).toBe(true);
    expectSafe(world);
  });

  it("cannot replace a chosen value after the proposer crashes", () => {
    let world = scenarioById("crash").build();
    expect(world.chosen?.value).toBe("Withdraw $80");
    expect(world.servers.every((server) => server.learned === null)).toBe(true);
    expect(world.servers.find((server) => server.id === "A")?.online).toBe(false);
    world = pump(propose(world, "D", "Withdraw $50"));
    expect(world.chosen?.value).toBe("Withdraw $80");
    expect(isComplete("crash", world)).toBe(true);
    expect(world.events.some((event) => event.kind === "phase2" && event.value === "Withdraw $50")).toBe(false);
    expectSafe(world);
  });

  it("counts three real preemptions without choosing", () => {
    let world = scenarioById("duel").build();
    const rounds: Array<{ leader: ServerId; helper: ServerId; victim: ServerId; spoiler: ServerId }> = [
      { leader: "A", helper: "C", victim: "B", spoiler: "E" },
      { leader: "B", helper: "D", victim: "C", spoiler: "E" },
      { leader: "D", helper: "B", victim: "A", spoiler: "E" },
    ];
    for (const round of rounds) {
      world = propose(world, round.leader, "Withdraw $80");
      const leaderBallot = world.servers.find((server) => server.id === round.leader)?.proposal?.ballot;
      expect(leaderBallot).toBeTruthy();
      for (const target of [round.helper, round.victim, round.spoiler]) {
        world = deliver(
          world,
          findMessage(
            world,
            (message) =>
              message.type === "prepare" &&
              message.from === round.leader &&
              message.to === target &&
              message.ballot.round === leaderBallot?.round &&
              message.ballot.serverId === leaderBallot?.serverId,
          ).id,
        );
      }
      world = deliver(
        world,
        findMessage(
          world,
          (message) =>
            message.type === "promise" &&
            message.from === round.helper &&
            message.to === round.leader &&
            message.ballot.round === leaderBallot?.round,
        ).id,
      );
      world = deliver(
        world,
        findMessage(
          world,
          (message) =>
            message.type === "promise" &&
            message.from === round.victim &&
            message.to === round.leader &&
            message.ballot.round === leaderBallot?.round,
        ).id,
      );
      expect(world.servers.find((server) => server.id === round.leader)?.proposal?.phase).toBe("accepting");
      world = propose(world, round.spoiler, "Withdraw $50");
      const spoilerBallot = world.servers.find((server) => server.id === round.spoiler)?.proposal?.ballot;
      world = deliver(
        world,
        findMessage(
          world,
          (message) =>
            message.type === "prepare" &&
            message.from === round.spoiler &&
            message.to === round.victim &&
            message.ballot.round === spoilerBallot?.round &&
            message.ballot.serverId === spoilerBallot?.serverId,
        ).id,
      );
      world = deliver(
        world,
        findMessage(
          world,
          (message) =>
            message.type === "accept" &&
            message.from === round.leader &&
            message.to === round.victim &&
            message.ballot.round === leaderBallot?.round &&
            message.ballot.serverId === leaderBallot?.serverId,
        ).id,
      );
    }
    expect(world.chosen).toBeNull();
    expect(isComplete("duel", world)).toBe(true);
    expectSafe(world);
  });
});

describe("safety under interleaving", () => {
  it("never chooses two values across random crashes, drops, and partitions", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      let world = createWorld();
      let random = seed;
      const nextRand = () => {
        random = (random * 16807) % 2147483647;
        return random / 2147483647;
      };
      const values = ["red", "blue", "Withdraw $80", "Withdraw $50"];
      let seen: string | null = null;
      const seenRounds = new Map<ServerId, { promised: number; accepted: number; nextRound: number }>();
      for (const id of SERVER_IDS) seenRounds.set(id, { promised: 0, accepted: 0, nextRound: 1 });

      for (let step = 0; step < 70; step += 1) {
        const roll = nextRand();
        const id = SERVER_IDS[Math.floor(nextRand() * SERVER_IDS.length)]!;
        if (roll < 0.28) world = propose(world, id, values[Math.floor(nextRand() * values.length)]!);
        else if (roll < 0.72 && world.queue.length > 0) {
          const message = world.queue[Math.floor(nextRand() * world.queue.length)]!;
          world = deliver(world, message.id);
        } else if (roll < 0.82 && world.queue.length > 0) world = drop(world, world.queue[Math.floor(nextRand() * world.queue.length)]!.id);
        else if (roll < 0.9) world = crash(world, id);
        else if (roll < 0.96) world = restart(world, id);
        else world = setPartition(world, id, nextRand() < 0.5 ? 1 : 2);

        expectSafe(world);
        if (world.chosen) {
          if (seen === null) seen = world.chosen.value;
          expect(world.chosen.value).toBe(seen);
        }
        for (const server of world.servers) {
          const previous = seenRounds.get(server.id)!;
          const promisedRound = server.promised?.round ?? 0;
          const acceptedRound = server.accepted?.ballot.round ?? 0;
          expect(promisedRound).toBeGreaterThanOrEqual(previous.promised);
          expect(acceptedRound).toBeGreaterThanOrEqual(previous.accepted);
          expect(server.minNextRound).toBeGreaterThanOrEqual(previous.nextRound);
          previous.promised = promisedRound;
          previous.accepted = acceptedRound;
          previous.nextRound = server.minNextRound;
        }
      }
    }
  });
});
