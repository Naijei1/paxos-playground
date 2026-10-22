export const SERVER_IDS = ["A", "B", "C", "D", "E"] as const;

export type ServerId = (typeof SERVER_IDS)[number];

export const MAJORITY = 3;

export type Ballot = {
  round: number;
  serverId: ServerId;
};

export type AcceptedValue = {
  ballot: Ballot;
  value: string;
};

export type PromiseInfo = {
  from: ServerId;
  accepted: AcceptedValue | null;
};

export type Proposal =
  | {
      phase: "preparing";
      ballot: Ballot;
      requested: string;
      promises: PromiseInfo[];
    }
  | {
      phase: "accepting";
      ballot: Ballot;
      requested: string;
      value: string;
      quorum: ServerId[];
      promises: PromiseInfo[];
      accepts: ServerId[];
      announced: boolean;
    };

export type ServerState = {
  id: ServerId;
  online: boolean;
  partition: number;
  promised: Ballot | null;
  accepted: AcceptedValue | null;
  learned: AcceptedValue | null;
  minNextRound: number;
  proposal: Proposal | null;
};

export type MessageType = "prepare" | "promise" | "nack" | "accept" | "accepted" | "learn";

export type Message = {
  id: string;
  type: MessageType;
  from: ServerId;
  to: ServerId;
  ballot: Ballot;
  value?: string;
  accepted?: AcceptedValue | null;
  promised?: Ballot;
  nackPhase?: "prepare" | "accept";
};

export type LogTone = "info" | "warn" | "good" | "bad" | "key";

export type LogEntry = {
  id: string;
  tone: LogTone;
  text: string;
};

export type TraceEvent =
  | {
      kind: "phase2";
      server: ServerId;
      ballot: Ballot;
      requested: string;
      value: string;
      quorum: ServerId[];
      constraint: { server: ServerId; ballot: Ballot; value: string } | null;
    }
  | { kind: "preempt"; server: ServerId; ballot: Ballot }
  | { kind: "chosen"; ballot: Ballot; value: string; split: boolean };

export type AcceptRecord = {
  ballot: Ballot;
  value: string;
  acceptors: ServerId[];
};

export type Decision = {
  ballot: Ballot;
  value: string;
  acceptors: ServerId[];
};

export type PartitionMode = "hold" | "drop";

export type DiagramKind = "promise" | "accept" | "learn" | "crash" | "restart" | "partition";

export type DiagramEvent = {
  id: string;
  time: number;
  server: ServerId;
  kind: DiagramKind;
  label: string;
  detail: string;
  partition?: number;
};

export type DiagramArrow = {
  messageId: string;
  type: MessageType;
  from: ServerId;
  to: ServerId;
  label: string;
  detail: string;
  sendTime: number;
  endTime: number | null;
  status: "inflight" | "delivered" | "dropped";
};

export type Diagram = {
  clock: number;
  events: DiagramEvent[];
  arrows: DiagramArrow[];
  chosenAt: { time: number; label: string; detail: string } | null;
};

export type ScenarioId = "free" | "first" | "crash" | "unfinished" | "partition" | "duel";

export type World = {
  servers: ServerState[];
  queue: Message[];
  log: LogEntry[];
  events: TraceEvent[];
  accepts: AcceptRecord[];
  chosen: Decision | null;
  partitionMode: PartitionMode;
  diagram: Diagram;
  msgSeq: number;
  logSeq: number;
};
