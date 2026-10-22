import { ballotEq, compareBallot, formatBallot } from "./ballot";
import {
  MAJORITY,
  SERVER_IDS,
  type AcceptRecord,
  type AcceptedValue,
  type Ballot,
  type LogTone,
  type Message,
  type PartitionMode,
  type PromiseInfo,
  type ServerId,
  type ServerState,
  type World,
} from "./types";

export function createWorld(): World {
  return {
    servers: SERVER_IDS.map(createServer),
    queue: [],
    log: [
      {
        id: "l0",
        tone: "info",
        text: "Five servers, A through E, each act as proposer and acceptor. Nothing is chosen until three of them accept the same ballot and value. A server only knows about that choice once it learns it.",
      },
    ],
    events: [],
    accepts: [],
    chosen: null,
    partitionMode: "hold",
    msgSeq: 1,
    logSeq: 1,
  };
}

function createServer(id: ServerId): ServerState {
  return {
    id,
    online: true,
    partition: 1,
    promised: null,
    accepted: null,
    learned: null,
    minNextRound: 1,
    proposal: null,
  };
}

function draft(world: World): World {
  return structuredClone(world);
}

function server(world: World, id: ServerId): ServerState {
  const found = world.servers.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown server ${id}`);
  return found;
}

function log(world: World, text: string, tone: LogTone = "info"): void {
  world.log.push({ id: `l${world.logSeq++}`, tone, text });
}

function noteBallot(serverState: ServerState, ballot: Ballot): void {
  const floor = ballot.round + 1;
  if (floor > serverState.minNextRound) serverState.minNextRound = floor;
}

function takeBallot(serverState: ServerState): Ballot {
  const ballot = { round: serverState.minNextRound, serverId: serverState.id };
  serverState.minNextRound = ballot.round + 1;
  return ballot;
}

function partitioned(world: World, from: ServerId, to: ServerId): boolean {
  return server(world, from).partition !== server(world, to).partition;
}

export function describeMessage(message: Message): string {
  const route = `${message.from} → ${message.to}`;
  const ballot = formatBallot(message.ballot);
  switch (message.type) {
    case "prepare":
      return `Prepare ${ballot} (${route})`;
    case "promise": {
      const prior = message.accepted
        ? `previously accepted "${message.accepted.value}" at ${formatBallot(message.accepted.ballot)}`
        : "no accepted value";
      return `Promise ${ballot} (${route}, ${prior})`;
    }
    case "nack":
      return `Nack ${ballot} (${route}, already promised ${message.promised ? formatBallot(message.promised) : "a higher ballot"})`;
    case "accept":
      return `Accept ${ballot} "${message.value ?? ""}" (${route})`;
    case "accepted":
      return `Accepted ${ballot} "${message.value ?? ""}" (${route})`;
    case "learn":
      return `Learn "${message.value ?? ""}" at ${ballot} (${route})`;
  }
}

function enqueue(world: World, message: Omit<Message, "id">): void {
  if (partitioned(world, message.from, message.to) && world.partitionMode === "drop") {
    log(
      world,
      `${describeMessage({ ...message, id: "x" })} was dropped at send time because ${message.from} and ${message.to} are in different partitions.`,
      "warn",
    );
    return;
  }
  world.queue.push({ ...message, id: `m${world.msgSeq++}` });
}

export type DeliveryBlock = "offline" | "held";

export function deliveryBlock(world: World, message: Message): DeliveryBlock | null {
  if (partitioned(world, message.from, message.to)) {
    return world.partitionMode === "hold" ? "held" : null;
  }
  return null;
}

export function nextAutoMessage(world: World): Message | null {
  return (
    world.queue.find((message) => {
      const to = server(world, message.to);
      if (!to.online) return false;
      if (partitioned(world, message.from, message.to)) return false;
      return true;
    }) ?? null
  );
}

function names(ids: ServerId[]): string {
  if (ids.length === 0) return "nobody";
  if (ids.length === 1) return ids[0];
  if (ids.length === 2) return `${ids[0]} and ${ids[1]}`;
  return `${ids.slice(0, -1).join(", ")}, and ${ids[ids.length - 1]}`;
}

function isSplit(world: World): boolean {
  return new Set(world.servers.map((item) => item.partition)).size > 1;
}

function recordAccept(world: World, acceptor: ServerId, ballot: Ballot, value: string): void {
  let record: AcceptRecord | undefined = world.accepts.find(
    (item) => ballotEq(item.ballot, ballot) && item.value === value,
  );
  if (!record) {
    record = { ballot, value, acceptors: [] };
    world.accepts.push(record);
  }
  if (!record.acceptors.includes(acceptor)) record.acceptors.push(acceptor);

  if (world.chosen && ballotEq(world.chosen.ballot, ballot) && world.chosen.value === value) {
    world.chosen = { ...world.chosen, acceptors: [...record.acceptors] };
  }

  if (!world.chosen && record.acceptors.length >= MAJORITY) {
    world.chosen = { ballot, value, acceptors: [...record.acceptors] };
    world.events.push({ kind: "chosen", ballot, value, split: isSplit(world) });
    const unaware = world.servers.filter((item) => item.learned?.value !== value).map((item) => item.id);
    const divergent = world.servers.filter((item) => item.accepted && item.accepted.value !== value);
    let text = `"${value}" is chosen at ballot ${formatBallot(ballot)} because ${names(record.acceptors)} have accepted it. Chosen is a fact about the acceptors (3 of 5), separate from what any one server knows.`;
    if (unaware.length > 0) {
      text += ` ${names(unaware)} still do not know.`;
    }
    if (divergent.length > 0) {
      const bits = divergent.map(
        (item) => `${item.id} last accepted "${item.accepted?.value}" at ${formatBallot(item.accepted!.ballot)}`,
      );
      text += ` ${bits.join("; ")}. A different last-accepted value does not undo the choice, and it was never chosen unless its own ballot reached a majority.`;
    }
    log(world, text, "good");
  }
}

function tryAccept(serverState: ServerState, ballot: Ballot, value: string): boolean {
  if (serverState.promised && compareBallot(ballot, serverState.promised) < 0) return false;
  if (
    serverState.accepted &&
    ballotEq(serverState.accepted.ballot, ballot) &&
    serverState.accepted.value !== value
  ) {
    return false;
  }
  if (!serverState.promised || compareBallot(ballot, serverState.promised) > 0) {
    serverState.promised = ballot;
  }
  if (!serverState.accepted || compareBallot(ballot, serverState.accepted.ballot) >= 0) {
    serverState.accepted = { ballot, value };
  }
  noteBallot(serverState, ballot);
  return true;
}

function highestConstraint(
  promises: PromiseInfo[],
): { server: ServerId; ballot: Ballot; value: string } | null {
  let best: { server: ServerId; ballot: Ballot; value: string } | null = null;
  for (const promise of promises) {
    if (!promise.accepted) continue;
    if (!best || compareBallot(promise.accepted.ballot, best.ballot) > 0) {
      best = {
        server: promise.from,
        ballot: promise.accepted.ballot,
        value: promise.accepted.value,
      };
    }
  }
  return best;
}

function explainPhase2(
  proposer: ServerId,
  requested: string,
  value: string,
  quorum: ServerId[],
  constraint: { server: ServerId; ballot: Ballot; value: string } | null,
): string {
  const who = names(quorum);
  if (constraint) {
    if (value !== requested) {
      return `${proposer} must propose "${value}" because a promise from ${constraint.server} reported it accepted "${constraint.value}" at ballot ${formatBallot(constraint.ballot)}, the highest accepted ballot in the quorum (${who}). The suggestion "${requested}" cannot be used.`;
    }
    return `${proposer} proposes "${value}". The quorum (${who}) reported an accepted value, and the highest one is already "${value}", accepted by ${constraint.server} at ballot ${formatBallot(constraint.ballot)}.`;
  }
  return `${proposer} may propose "${requested}" because none of the promises in its quorum (${who}) reported an accepted value.`;
}

function noteRejected(world: World, ballot: Ballot, proposerId: ServerId): void {
  const key = formatBallot(ballot);
  if (world.events.some((event) => event.kind === "preempt" && formatBallot(event.ballot) === key)) return;
  world.events.push({ kind: "preempt", server: proposerId, ballot });
}

function beginPhase2(world: World, proposer: ServerState): void {
  const proposal = proposer.proposal;
  if (!proposal || proposal.phase !== "preparing") return;
  if (proposal.promises.length < MAJORITY) return;

  const quorumPromises = proposal.promises.slice(0, MAJORITY);
  const quorum = quorumPromises.map((item) => item.from);
  const constraint = highestConstraint(quorumPromises);
  const value = constraint ? constraint.value : proposal.requested;
  proposer.proposal = {
    phase: "accepting",
    ballot: proposal.ballot,
    requested: proposal.requested,
    value,
    quorum,
    promises: quorumPromises,
    accepts: [],
    announced: false,
  };
  world.events.push({
    kind: "phase2",
    server: proposer.id,
    ballot: proposal.ballot,
    requested: proposal.requested,
    value,
    quorum,
    constraint,
  });
  log(world, explainPhase2(proposer.id, proposal.requested, value, quorum, constraint), "key");

  const ballot = proposal.ballot;
  if (tryAccept(proposer, ballot, value)) {
    recordAccept(world, proposer.id, ballot, value);
    if (proposer.proposal?.phase === "accepting") proposer.proposal.accepts.push(proposer.id);
    log(
      world,
      `${proposer.id}'s own acceptor accepted "${value}" at ballot ${formatBallot(ballot)}. That is 1 of 3. The other servers have not accepted it yet.`,
      "info",
    );
  } else {
    log(
      world,
      `${proposer.id}'s own acceptor refused ballot ${formatBallot(ballot)} because it has already promised ${proposer.promised ? formatBallot(proposer.promised) : "a higher ballot"}.`,
      "warn",
    );
  }

  for (const id of SERVER_IDS) {
    if (id === proposer.id) continue;
    enqueue(world, { type: "accept", from: proposer.id, to: id, ballot, value });
  }
  maybeAnnounce(world, proposer);
}

function maybeAnnounce(world: World, proposer: ServerState): void {
  const proposal = proposer.proposal;
  if (!proposal || proposal.phase !== "accepting" || proposal.announced) return;
  if (proposal.accepts.length < MAJORITY) return;
  proposal.announced = true;
  proposer.learned = { ballot: proposal.ballot, value: proposal.value };
  const unaware = world.servers
    .filter((item) => item.id !== proposer.id && item.learned?.value !== proposal.value)
    .map((item) => item.id);
  log(
    world,
    `${proposer.id} has learned that "${proposal.value}" is chosen at ballot ${formatBallot(proposal.ballot)}, because it collected Accepted from a majority (${names(proposal.accepts)}). ${
      unaware.length
        ? `${names(unaware)} still do not know, so ${proposer.id} sends Learn.`
        : "Every server already knows."
    }`,
    "key",
  );
  for (const id of SERVER_IDS) {
    if (id === proposer.id) continue;
    enqueue(world, {
      type: "learn",
      from: proposer.id,
      to: id,
      ballot: proposal.ballot,
      value: proposal.value,
    });
  }
}

export function propose(world: World, id: ServerId, rawValue: string): World {
  const value = rawValue.trim();
  const next = draft(world);
  const proposer = server(next, id);
  if (!value) {
    log(next, "A proposal needs a value.", "warn");
    return next;
  }
  if (!proposer.online) {
    log(next, `${id} is offline and cannot start a proposal. Restart it first. Its promised ballot and last accepted value are still on disk.`, "warn");
    return next;
  }

  if (proposer.proposal) {
    log(
      next,
      `${id} abandons ballot ${formatBallot(proposer.proposal.ballot)} and starts a higher one. Messages from the old ballot may still be in the queue; if an acceptor has not promised higher, the old Accept can still succeed.`,
      "warn",
    );
  }

  const ballot = takeBallot(proposer);
  const previous = proposer.accepted;
  proposer.promised = ballot;
  noteBallot(proposer, ballot);
  proposer.proposal = {
    phase: "preparing",
    ballot,
    requested: value,
    promises: [{ from: id, accepted: previous }],
  };

  const prior = previous
    ? `${id} had already accepted "${previous.value}" at ${formatBallot(previous.ballot)}, and its own promise reports that`
    : `${id} has not accepted anything yet`;
  log(
    next,
    `${id} starts ballot ${formatBallot(ballot)} proposing "${value}". Ballots order by round, then by server letter, so ${formatBallot(ballot)} is higher than every ballot ${id} has seen. ${id}'s acceptor promises it immediately (${prior}). Prepare goes to the other servers.`,
    "info",
  );

  for (const other of SERVER_IDS) {
    if (other === id) continue;
    enqueue(next, { type: "prepare", from: id, to: other, ballot });
  }
  return next;
}

function onPrepare(world: World, message: Message): void {
  const acceptor = server(world, message.to);
  noteBallot(acceptor, message.ballot);
  const promised = acceptor.promised;
  if (promised && compareBallot(message.ballot, promised) < 0) {
    enqueue(world, {
      type: "nack",
      from: acceptor.id,
      to: message.from,
      ballot: message.ballot,
      promised,
      nackPhase: "prepare",
    });
    log(
      world,
      `${acceptor.id} rejected ballot ${formatBallot(message.ballot)} because it already promised ballot ${formatBallot(promised)}.`,
      "bad",
    );
    noteRejected(world, message.ballot, message.from);
    return;
  }

  if (promised && ballotEq(promised, message.ballot)) {
    enqueue(world, {
      type: "promise",
      from: acceptor.id,
      to: message.from,
      ballot: message.ballot,
      accepted: acceptor.accepted,
    });
    log(
      world,
      `${acceptor.id} repeats its promise for ballot ${formatBallot(message.ballot)}. ${acceptedPhrase(acceptor.accepted)}`,
      "info",
    );
    return;
  }

  const prior = acceptor.accepted;
  acceptor.promised = message.ballot;
  enqueue(world, {
    type: "promise",
    from: acceptor.id,
    to: message.from,
    ballot: message.ballot,
    accepted: prior,
  });
  log(
    world,
    `${acceptor.id} promises ballot ${formatBallot(message.ballot)}. ${acceptedPhrase(prior)} It will reject anything lower from now on.`,
    "info",
  );
}

function acceptedPhrase(accepted: AcceptedValue | null): string {
  if (!accepted) return "It has no accepted value.";
  return `It reports its last accepted value, "${accepted.value}" at ballot ${formatBallot(accepted.ballot)}.`;
}

function onPromise(world: World, message: Message): void {
  const proposer = server(world, message.to);
  noteBallot(proposer, message.ballot);
  const proposal = proposer.proposal;
  if (!proposal || !ballotEq(proposal.ballot, message.ballot)) {
    log(
      world,
      `${proposer.id} ignores the promise from ${message.from} for ballot ${formatBallot(message.ballot)} because that is not ${proposer.id}'s current proposal.`,
      "info",
    );
    return;
  }
  if (proposal.phase !== "preparing") {
    log(
      world,
      `A promise from ${message.from} arrived after ${proposer.id} had already locked its phase-2 value from an earlier quorum. Later promises do not change that value.`,
      "info",
    );
    return;
  }
  if (proposal.promises.some((item) => item.from === message.from)) {
    log(world, `${proposer.id} already counted ${message.from}'s promise for ballot ${formatBallot(message.ballot)}.`, "info");
    return;
  }
  proposal.promises.push({
    from: message.from,
    accepted: message.accepted ?? null,
  });
  const prior = message.accepted
    ? `${message.from} had accepted "${message.accepted.value}" at ${formatBallot(message.accepted.ballot)}`
    : `${message.from} had not accepted a value`;
  log(
    world,
    `${proposer.id} collects a promise from ${message.from} for ballot ${formatBallot(message.ballot)} (${prior}). Promises so far: ${proposal.promises.length} of ${MAJORITY}.`,
    "info",
  );
  if (proposal.promises.length >= MAJORITY) beginPhase2(world, proposer);
}

function onNack(world: World, message: Message): void {
  const proposer = server(world, message.to);
  if (message.promised) noteBallot(proposer, message.promised);
  const higher = message.promised ? formatBallot(message.promised) : "a higher ballot";
  if (message.nackPhase === "accept") {
    log(
      world,
      `${message.from} rejected Accept for ballot ${formatBallot(message.ballot)}${message.value ? ` ("${message.value}")` : ""} because it already promised ballot ${higher}.`,
      "bad",
    );
  } else {
    log(
      world,
      `${message.from} rejected ballot ${formatBallot(message.ballot)} because it already promised ballot ${higher}.`,
      "bad",
    );
  }
  const proposal = proposer.proposal;
  if (proposal && ballotEq(proposal.ballot, message.ballot)) {
    if (proposal.phase === "preparing") {
      log(
        world,
        `${proposer.id} still needs ${MAJORITY} promises. A rejection does not vote no on the value; it only means this acceptor will not help ballot ${formatBallot(message.ballot)}.`,
        "warn",
      );
    } else {
      log(
        world,
        `${proposer.id} may fail to reach a majority of accepts for ballot ${formatBallot(message.ballot)}. A higher ballot has to start over, and if a value was already chosen it must carry that value forward.`,
        "warn",
      );
    }
  }
}

function onAccept(world: World, message: Message): void {
  const acceptor = server(world, message.to);
  const value = message.value ?? "";
  noteBallot(acceptor, message.ballot);
  if (acceptor.promised && compareBallot(message.ballot, acceptor.promised) < 0) {
    enqueue(world, {
      type: "nack",
      from: acceptor.id,
      to: message.from,
      ballot: message.ballot,
      value,
      promised: acceptor.promised,
      nackPhase: "accept",
    });
    log(
      world,
      `${acceptor.id} rejected Accept for ballot ${formatBallot(message.ballot)} ("${value}") because it already promised ballot ${formatBallot(acceptor.promised)}.`,
      "bad",
    );
    noteRejected(world, message.ballot, message.from);
    return;
  }
  if (!tryAccept(acceptor, message.ballot, value)) {
    log(world, `${acceptor.id} could not accept "${value}" at ballot ${formatBallot(message.ballot)}.`, "bad");
    return;
  }
  recordAccept(world, acceptor.id, message.ballot, value);
  enqueue(world, {
    type: "accepted",
    from: acceptor.id,
    to: message.from,
    ballot: message.ballot,
    value,
  });
  const count =
    world.accepts.find((item) => ballotEq(item.ballot, message.ballot) && item.value === value)?.acceptors
      .length ?? 0;
  log(
    world,
    `${acceptor.id} accepts "${value}" at ballot ${formatBallot(message.ballot)}. Its promised ballot is now at least ${formatBallot(acceptor.promised!)}. ${count} of ${MAJORITY} acceptors have accepted this ballot and value.`,
    "info",
  );
}

function onAccepted(world: World, message: Message): void {
  const proposer = server(world, message.to);
  const value = message.value ?? "";
  noteBallot(proposer, message.ballot);
  const proposal = proposer.proposal;
  if (!proposal || proposal.phase !== "accepting" || !ballotEq(proposal.ballot, message.ballot)) {
    log(
      world,
      `${proposer.id} received Accepted for ballot ${formatBallot(message.ballot)} from ${message.from}, but it is not collecting that ballot anymore. The acceptor's vote still stands.`,
      "info",
    );
    return;
  }
  if (!proposal.accepts.includes(message.from)) proposal.accepts.push(message.from);
  log(
    world,
    `${proposer.id} records Accepted from ${message.from} for "${value}" at ballot ${formatBallot(message.ballot)} (${proposal.accepts.length} of ${MAJORITY}, counting itself if it accepted).`,
    "info",
  );
  maybeAnnounce(world, proposer);
}

function onLearn(world: World, message: Message): void {
  const learner = server(world, message.to);
  const value = message.value ?? "";
  noteBallot(learner, message.ballot);
  const previous = learner.learned;
  learner.learned = { ballot: message.ballot, value };
  if (previous && previous.value !== value) {
    log(
      world,
      `${learner.id} was told "${value}", but it already knew "${previous.value}". That would break single-decree safety.`,
      "bad",
    );
    return;
  }
  log(
    world,
    `${learner.id} learns that "${value}" was chosen at ballot ${formatBallot(message.ballot)} from ${message.from}'s announcement. Before this message, ${learner.id}'s own view was ${previous ? `already "${previous.value}"` : "still undecided"}, even if a majority had already accepted the value.`,
    "key",
  );
}

export function deliver(world: World, messageId: string): World {
  const existing = world.queue.find((message) => message.id === messageId);
  if (!existing) return world;
  const next = draft(world);
  const index = next.queue.findIndex((message) => message.id === messageId);
  const message = next.queue[index];
  if (!message) return world;

  if (partitioned(next, message.from, message.to)) {
    if (next.partitionMode === "hold") {
      log(
        next,
        `${describeMessage(message)} is held. ${message.from} is in partition ${server(next, message.from).partition} and ${message.to} is in partition ${server(next, message.to).partition}. Merge the partitions, delay it, or drop it.`,
        "warn",
      );
      return next;
    }
    next.queue.splice(index, 1);
    log(
      next,
      `Dropped ${describeMessage(message)} because ${message.from} and ${message.to} are partitioned.`,
      "warn",
    );
    return next;
  }

  next.queue.splice(index, 1);
  const recipient = server(next, message.to);
  if (!recipient.online) {
    log(
      next,
      `Dropped ${describeMessage(message)} because ${message.to} is offline. A crashed server ignores incoming messages. Promised and accepted state stay on disk; the in-flight proposal and the learned decision do not.`,
      "warn",
    );
    return next;
  }

  switch (message.type) {
    case "prepare":
      onPrepare(next, message);
      break;
    case "promise":
      onPromise(next, message);
      break;
    case "nack":
      onNack(next, message);
      break;
    case "accept":
      onAccept(next, message);
      break;
    case "accepted":
      onAccepted(next, message);
      break;
    case "learn":
      onLearn(next, message);
      break;
  }
  return next;
}

export function delay(world: World, messageId: string): World {
  const index = world.queue.findIndex((message) => message.id === messageId);
  if (index < 0 || index === world.queue.length - 1) return world;
  const next = draft(world);
  const [message] = next.queue.splice(index, 1);
  if (!message) return world;
  next.queue.push(message);
  log(next, `Delayed ${describeMessage(message)} to the back of the queue. Any message can still be delivered out of order.`, "info");
  return next;
}

export function drop(world: World, messageId: string): World {
  const index = world.queue.findIndex((message) => message.id === messageId);
  if (index < 0) return world;
  const next = draft(world);
  const [message] = next.queue.splice(index, 1);
  if (!message) return world;
  log(next, `Dropped ${describeMessage(message)}. It will never be delivered.`, "warn");
  return next;
}

export function crash(world: World, id: ServerId): World {
  const next = draft(world);
  const target = server(next, id);
  if (!target.online && !target.proposal && !target.learned) return world;
  target.online = false;
  target.proposal = null;
  target.learned = null;
  const disk = [
    target.promised ? `promised ballot ${formatBallot(target.promised)}` : "no promised ballot",
    target.accepted
      ? `last accepted "${target.accepted.value}" at ${formatBallot(target.accepted.ballot)}`
      : "nothing accepted",
  ].join(", ");
  log(
    next,
    `${id} crashes. Disk keeps ${disk}. The in-flight proposal and ${id}'s view of the chosen value are wiped. Messages already in the network stay there, and anything delivered to ${id} while it is down is dropped.`,
    "bad",
  );
  return next;
}

export function restart(world: World, id: ServerId): World {
  const next = draft(world);
  const target = server(next, id);
  if (target.online) return world;
  target.online = true;
  const disk = [
    target.promised ? `it still promises ${formatBallot(target.promised)}` : "it has not promised a ballot",
    target.accepted
      ? `it still has "${target.accepted.value}" accepted at ${formatBallot(target.accepted.ballot)}`
      : "it has no accepted value",
  ].join(", and ");
  log(
    next,
    `${id} restarts. ${disk}. It does not remember whether a value was chosen until a Learn message arrives or it proposes again and hears a majority.`,
    "good",
  );
  return next;
}

export function setPartition(world: World, id: ServerId, partition: number): World {
  const group = Math.min(3, Math.max(1, partition));
  const target = server(world, id);
  if (target.partition === group) return world;
  const next = draft(world);
  server(next, id).partition = group;
  log(
    next,
    `${id} moves to partition ${group}. Messages between different partitions are ${next.partitionMode === "hold" ? "held in the queue" : "dropped"}. A majority is still 3 of all 5 servers, not 3 of whoever is nearby.`,
    "warn",
  );
  return next;
}

export function setPartitionMode(world: World, mode: PartitionMode): World {
  if (world.partitionMode === mode) return world;
  const next = draft(world);
  next.partitionMode = mode;
  log(
    next,
    mode === "hold"
      ? "Cross-partition messages are now held in the queue until the partitions merge."
      : "Cross-partition messages are now dropped. Messages already in the queue stay until you deliver or drop them.",
    "info",
  );
  return next;
}

export function splitThreeTwo(world: World): World {
  const next = draft(world);
  for (const item of next.servers) {
    item.partition = item.id === "D" || item.id === "E" ? 2 : 1;
  }
  log(
    next,
    "The network splits 3/2. A, B, and C are in partition 1. D and E are in partition 2. Only a side that can still talk to 3 servers can choose a value. The pair cannot.",
    "key",
  );
  return next;
}

export function heal(world: World): World {
  if (world.servers.every((item) => item.partition === 1)) return world;
  const next = draft(world);
  for (const item of next.servers) item.partition = 1;
  log(
    next,
    "The partitions heal. Every server is in partition 1 again. Held messages between the old sides can now be delivered.",
    "good",
  );
  return next;
}

export function withIntro(world: World, intro: string, clearProposals = false): World {
  const next = draft(world);
  next.queue = [];
  next.events = [];
  next.log = [{ id: `l${next.logSeq++}`, tone: "key", text: intro }];
  if (clearProposals) {
    for (const item of next.servers) item.proposal = null;
  }
  return next;
}

export function preemptCount(world: World): number {
  return world.events.filter((event) => event.kind === "preempt").length;
}

export function checkInvariants(world: World): string[] {
  const errors: string[] = [];
  const chosenValues = new Set<string>();
  for (const record of world.accepts) {
    if (new Set(record.acceptors).size !== record.acceptors.length) {
      errors.push(`duplicate acceptor on ${formatBallot(record.ballot)}`);
    }
    if (record.acceptors.length >= MAJORITY) chosenValues.add(record.value);
  }
  if (chosenValues.size > 1) errors.push(`two values chosen: ${[...chosenValues].join(", ")}`);
  if (world.chosen && !chosenValues.has(world.chosen.value)) {
    errors.push("chosen flag does not match a majority accept");
  }
  if (!world.chosen && chosenValues.size > 0) errors.push("majority accept missing chosen flag");
  for (const item of world.servers) {
    if (item.accepted && item.promised && compareBallot(item.accepted.ballot, item.promised) > 0) {
      errors.push(`${item.id} accepted a ballot above its promise`);
    }
    if (item.learned && (!world.chosen || item.learned.value !== world.chosen.value)) {
      errors.push(`${item.id} learned a value that is not the chosen value`);
    }
    if (!item.online && item.proposal) errors.push(`${item.id} is offline with a live proposal`);
    if (!item.online && item.learned) errors.push(`${item.id} kept a learned value across a crash`);
  }
  const ids = world.queue.map((message) => message.id);
  if (new Set(ids).size !== ids.length) errors.push("duplicate message ids");
  return errors;
}
