import { crash, createWorld, propose, restart, splitThreeTwo, withIntro, deliver, preemptCount } from "./engine";
import type { Message, ScenarioId, ServerId, World } from "./types";

export type { ScenarioId } from "./types";

export type Scenario = {
  id: ScenarioId;
  kicker: string;
  name: string;
  goal: string;
  debrief: string;
  build: () => World;
};

function take(world: World, predicate: (message: Message) => boolean): World {
  const message = world.queue.find(predicate);
  if (!message) {
    throw new Error(`Missing setup message. Queue: ${world.queue.map((item) => item.type + item.from + item.to).join(" ")}`);
  }
  return deliver(world, message.id);
}

function buildCrash(): World {
  let world = propose(createWorld(), "A", "Withdraw $80");
  world = take(world, (message) => message.type === "prepare" && message.to === "B");
  world = take(world, (message) => message.type === "prepare" && message.to === "C");
  world = take(world, (message) => message.type === "promise" && message.from === "B");
  world = take(world, (message) => message.type === "promise" && message.from === "C");
  world = take(world, (message) => message.type === "accept" && message.to === "B");
  world = take(world, (message) => message.type === "accept" && message.to === "C");
  world = crash(world, "A");
  return withIntro(
    world,
    'A, B, and C already accepted "Withdraw $80" at ballot 1.A, so the value is chosen. A crashed before it could announce Learn, and the replies were lost. B and C know they accepted $80, but nobody has learned the decision. D and E have not heard anything. Propose "Withdraw $50" from D or E and see whether the decree can change. Ballot 1.D is already higher than 1.A, because the server letter breaks a tie.',
  );
}

function buildUnfinished(): World {
  let world = propose(createWorld(), "A", "red");
  world = take(world, (message) => message.type === "prepare" && message.to === "B");
  world = take(world, (message) => message.type === "prepare" && message.to === "C");
  world = take(world, (message) => message.type === "promise" && message.from === "B");
  world = take(world, (message) => message.type === "promise" && message.from === "C");
  world = crash(world, "A");
  world = restart(world, "A");
  return withIntro(
    world,
    'Only A accepted "red", at ballot 1.A. That is not a majority, so nothing is chosen. B and C promised 1.A but accepted nothing; their promises were enough for A to accept locally, and then the Accept messages were lost. A crashed and restarted, so it remembers red on disk and has forgotten the proposal. From B (or C, D, or E), start a proposal for "blue". If the first quorum of promises includes A, you must carry red forward. If you delay or drop A\'s promise and fill the quorum with servers that accepted nothing, you may propose blue.',
    true,
  );
}

export const SCENARIOS: Scenario[] = [
  {
    id: "free",
    kicker: "Sandbox",
    name: "Free play",
    goal: "No goal. Crash servers, split the network, delay messages, and run two proposers against each other. Reset returns to this empty system. Undo steps backward.",
    debrief: "",
    build: () => createWorld(),
  },
  {
    id: "first",
    kicker: "Challenge 1",
    name: "Make a decision",
    goal: 'Get three servers to accept the same proposal. Pick a server, choose a value such as "Withdraw $80", and deliver Prepare, Promise, Accept, and Accepted messages. The Chosen banner lights when three acceptors have the same ballot and value, which can happen before every server knows.',
    debrief:
      "A value is chosen as soon as a majority accepts it. The proposer learns that only after the Accepted replies come back, and everyone else learns it only from a Learn message. Drop those replies and the value stays chosen: the acceptors already wrote it down. That gap, between the fact and who knows the fact, is the rest of these challenges.",
    build: () =>
      withIntro(
        createWorld(),
        'Challenge 1. Nothing has been proposed. Choose any server and a value, then deliver messages until three acceptors have accepted it. Watch the Chosen banner separately from each server\'s "knows chosen" line.',
      ),
  },
  {
    id: "crash",
    kicker: "Challenge 2",
    name: "Crash the proposer",
    goal: 'A majority already accepted "Withdraw $80", then proposer A crashed before announcing it. From D or E, propose "Withdraw $50". You cannot choose $50. Any majority of promises overlaps the three acceptors who already voted for $80, so phase 2 is forced to repeat $80.',
    debrief:
      "Once three acceptors have accepted a value, every later quorum of promises includes at least one of them. That acceptor reports $80, and the new proposer must send $80 again, even if it wanted $50 and even if nobody has learned the choice yet. Safety does not depend on the original proposer staying alive.",
    build: buildCrash,
  },
  {
    id: "unfinished",
    kicker: "Challenge 3",
    name: "Unfinished proposal",
    goal: 'Only A accepted "red", so red is not chosen. Propose "blue" from another server. Delay A\'s Promise if you want a quorum that never saw red: phase 2 may then be blue. Deliver A\'s Promise before you have three promises, and the same proposal must carry red forward.',
    debrief:
      "A promise reports the acceptor's last accepted value, not merely the ballot it promised. One acceptor's red is binding only when that acceptor is inside the quorum you actually use. The first three promises lock the value; a promise that shows up later does not rewrite it. If blue then wins a majority, red stays on A's disk as a last-accepted value that was never chosen. Any future quorum overlaps the blue majority and must carry blue.",
    build: buildUnfinished,
  },
  {
    id: "partition",
    kicker: "Challenge 4",
    name: "Split 3 / 2",
    goal: "A, B, and C can talk to each other. D and E are on the other side, and cross-side messages are held. Decide a value from the side of three. The pair can gather only two promises, including themselves, so they cannot choose. Healing the network lets the held messages flow again.",
    debrief:
      "Majority is 3 of the whole set of 5, not a majority of whoever you can currently reach. The side of three is a quorum and can choose. The side of two is not, no matter how long it waits. Holding the cross messages (instead of dropping them) means a heal can still deliver them; either way, the pair never had a quorum while the split lasted.",
    build: () =>
      withIntro(
        splitThreeTwo(createWorld()),
        "Challenge 4. The network is split. Partition 1 is A, B, and C. Partition 2 is D and E. Messages that cross the split stay in the queue, marked held, until you heal or drop them. Propose on each side.",
      ),
  },
  {
    id: "duel",
    kicker: "Challenge 5",
    name: "Dueling proposers",
    goal: "Keep a value from being chosen by interrupting with higher ballots. Let a Prepare land, then have another server propose and deliver its higher Prepare to that same acceptor before the lower ballot can finish. Do that kind of rejection three times. Paxos stays safe; it just makes no progress.",
    debrief:
      "Each higher promise makes the acceptor reject the lower ballot. That is safe: a ballot that cannot finish cannot choose a conflicting value. It is also why Paxos does not guarantee liveness by itself. Something outside the ballot rule, usually a stable leader, has to stop the duel and let one proposal finish.",
    build: () =>
      withIntro(
        createWorld(),
        "Challenge 5. Try to prevent a decision. Start a proposal and deliver at least one Prepare. Before that ballot is accepted by a majority, start a higher ballot from another server and deliver its Prepare to an acceptor that promised the lower one. Then deliver the lower Accept or a late lower Prepare so it is rejected. Three such rejections, and still no chosen value, completes the challenge.",
      ),
  },
];

export function scenarioById(id: ScenarioId): Scenario {
  const scenario = SCENARIOS.find((item) => item.id === id);
  if (!scenario) throw new Error(`Unknown scenario ${id}`);
  return scenario;
}

export function isComplete(id: ScenarioId, world: World): boolean {
  switch (id) {
    case "free":
      return false;
    case "first":
      return world.chosen !== null;
    case "crash":
      return world.events.some(
        (event) => event.kind === "phase2" && event.requested !== event.value && event.value === "Withdraw $80",
      );
    case "unfinished":
      return world.events.some(
        (event) => event.kind === "phase2" && event.requested === "blue" && (event.value === "red" || event.value === "blue"),
      );
    case "partition":
      return world.events.some((event) => event.kind === "chosen" && event.split);
    case "duel":
      return world.chosen === null && preemptCount(world) >= 3;
  }
}

export function progressLabel(id: ScenarioId, world: World): string {
  switch (id) {
    case "free":
      return "Sandbox";
    case "first":
      return world.chosen ? "A majority has accepted a value." : "No majority yet.";
    case "crash":
      return isComplete(id, world)
        ? "A later proposer was forced to keep $80."
        : 'Propose "Withdraw $50" and collect a quorum of promises.';
    case "unfinished": {
      const forced = world.events.some((event) => event.kind === "phase2" && event.requested === "blue" && event.value === "red");
      const freed = world.events.some((event) => event.kind === "phase2" && event.requested === "blue" && event.value === "blue");
      if (forced && freed) return "You saw both quorums: one forced red, one allowed blue.";
      if (forced) return "This quorum had to carry red. Reset and delay A's promise to see the other path.";
      if (freed) return "This quorum never saw red, so blue was allowed. Reset and include A's promise to see the other path.";
      return 'Propose "blue" and choose which promises join the first quorum of three.';
    }
    case "partition":
      return world.chosen ? "The majority side chose while the network was split." : "The side of three can choose. The pair cannot.";
    case "duel":
      return `${preemptCount(world)} of 3 interrupting rejections${world.chosen ? ". A value was chosen, so reset and try again." : "."}`;
  }
}

export function hashForScenario(id: ScenarioId): string {
  return id === "free" ? "#/" : `#/c/${id}`;
}

export function scenarioFromHash(hash: string): ScenarioId | null {
  if (hash === "#/" || hash === "#/c/free") return "free";
  if (hash === "" || hash === "#") return null;
  const match = hash.match(/^#\/c\/(first|crash|unfinished|partition|duel)$/);
  if (!match) return null;
  return match[1] as ScenarioId;
}

export function recommendedProposer(id: ScenarioId): ServerId {
  if (id === "crash") return "D";
  if (id === "unfinished") return "B";
  if (id === "partition") return "A";
  return "A";
}
