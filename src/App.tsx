import { useEffect, useReducer, useState } from "react";
import { Timeline } from "./Timeline";
import { formatBallot } from "./paxos/ballot";
import {
  crash,
  delay,
  deliver,
  deliveryBlock,
  drop,
  heal,
  nextAutoMessage,
  propose,
  restart,
  setPartition,
  setPartitionMode,
  splitThreeTwo,
} from "./paxos/engine";
import {
  SCENARIOS,
  hashForScenario,
  isComplete,
  progressLabel,
  recommendedProposer,
  scenarioById,
  scenarioFromHash,
} from "./paxos/scenarios";
import { MAJORITY, SERVER_IDS, type ScenarioId, type ServerId, type World } from "./paxos/types";

const PRESETS = ["Withdraw $80", "Withdraw $50", "red", "blue"] as const;

type Pin = { kind: "server"; id: ServerId } | { kind: "message"; id: string };

type Hover = { title: string; detail: string; messageId?: string } | null;

type AppState = {
  scenario: ScenarioId;
  past: World[];
  world: World;
  selected: ServerId;
  autoplay: boolean;
  draft: string;
};

type Action =
  | { type: "scenario"; id: ScenarioId }
  | { type: "mutate"; op: (world: World) => World }
  | { type: "undo" }
  | { type: "select"; id: ServerId }
  | { type: "draft"; value: string }
  | { type: "autoplay"; on: boolean };

function fresh(id: ScenarioId): Pick<AppState, "scenario" | "past" | "world" | "selected" | "draft"> {
  return {
    scenario: id,
    past: [],
    world: scenarioById(id).build(),
    selected: recommendedProposer(id),
    draft: id === "crash" ? "Withdraw $50" : id === "unfinished" ? "blue" : "Withdraw $80",
  };
}

function initialState(): AppState {
  const id = scenarioFromHash(window.location.hash) ?? "first";
  return { ...fresh(id), autoplay: false };
}

function apply(state: AppState, world: World): AppState {
  if (world === state.world) return state;
  return { ...state, past: [...state.past, state.world].slice(-150), world };
}

function reduce(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "scenario":
      return { ...state, ...fresh(action.id), autoplay: false };
    case "mutate":
      return apply(state, action.op(state.world));
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { ...state, past: state.past.slice(0, -1), world: previous, autoplay: false };
    }
    case "select":
      return { ...state, selected: action.id };
    case "draft":
      return { ...state, draft: action.value.slice(0, 48) };
    case "autoplay":
      return { ...state, autoplay: action.on };
  }
}

export function App() {
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const { world, scenario } = state;
  const active = scenarioById(scenario);
  const done = isComplete(scenario, world);
  const server = world.servers.find((item) => item.id === state.selected) ?? world.servers[0]!;
  const [pin, setPin] = useState<Pin>({ kind: "server", id: server.id });
  const [hover, setHover] = useState<Hover>(null);
  const showNetwork = scenario === "free" || scenario === "partition";

  useEffect(() => {
    const onHash = () => {
      const id = scenarioFromHash(window.location.hash);
      if (id) dispatch({ type: "scenario", id });
    };
    window.addEventListener("hashchange", onHash);
    if (!scenarioFromHash(window.location.hash)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/c/first`);
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, [dispatch]);

  useEffect(() => {
    if (!state.autoplay) return;
    const timer = window.setInterval(() => {
      dispatch({
        type: "mutate",
        op: (current) => {
          const message = nextAutoMessage(current);
          return message ? deliver(current, message.id) : current;
        },
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [state.autoplay, dispatch]);

  useEffect(() => {
    setPin({ kind: "server", id: recommendedProposer(scenario) });
    setHover(null);
  }, [scenario]);

  const mutate = (op: (world: World) => World) => dispatch({ type: "mutate", op });
  const pinnedMessage = pin.kind === "message" ? world.diagram.arrows.find((arrow) => arrow.messageId === pin.id) : undefined;
  const activeMessageId = hover?.messageId ?? (pin.kind === "message" ? pin.id : undefined);
  const activeQueued = activeMessageId ? world.queue.find((message) => message.id === activeMessageId) : undefined;
  const explanation =
    hover?.detail ??
    pinnedMessage?.detail ??
    `${server.id} is ${server.online ? "online" : "offline"} on side ${server.partition}. Highest promised ballot: ${
      server.promised ? formatBallot(server.promised) : "none"
    }. Last accepted: ${server.accepted ? `“${server.accepted.value}” at ${formatBallot(server.accepted.ballot)}` : "nothing"}. ${
      server.learned ? `It knows “${server.learned.value}” was chosen.` : "It has not learned a chosen value."
    }`;
  const explanationTitle = hover?.title ?? (pinnedMessage ? `${pinnedMessage.label} ${pinnedMessage.from} → ${pinnedMessage.to}` : `Server ${server.id}`);

  const activateMessage = (messageId: string) => {
    const message = world.queue.find((item) => item.id === messageId);
    if (!message || deliveryBlock(world, message) === "held") {
      setPin({ kind: "message", id: messageId });
      return;
    }
    setPin({ kind: "message", id: messageId });
    mutate((current) => deliver(current, messageId));
  };

  return (
    <div className="mx-auto min-h-screen max-w-[1440px] px-4 py-4 sm:px-6">
      <header className="flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-clay uppercase">Single decree</p>
          <h1 className="font-serif text-3xl leading-none">Paxos playground</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuietButton onClick={() => dispatch({ type: "undo" })} disabled={state.past.length === 0}>
            Undo
          </QuietButton>
          <QuietButton onClick={() => dispatch({ type: "scenario", id: scenario })}>Reset</QuietButton>
          <QuietButton
            onClick={() =>
              mutate((current) => {
                const message = nextAutoMessage(current);
                return message ? deliver(current, message.id) : current;
              })
            }
            disabled={!nextAutoMessage(world)}
          >
            Step
          </QuietButton>
          <QuietButton pressed={state.autoplay} onClick={() => dispatch({ type: "autoplay", on: !state.autoplay })}>
            {state.autoplay ? "Stop" : "Autoplay"}
          </QuietButton>
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold">
              Network
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-2xl border border-line bg-card p-3 text-sm shadow-sm">
              <div className="flex flex-wrap gap-2">
                <QuietButton onClick={() => mutate(heal)}>Heal</QuietButton>
                <QuietButton onClick={() => mutate(splitThreeTwo)}>Split 3/2</QuietButton>
              </div>
              <label className="mt-3 flex items-center justify-between gap-2 text-muted">
                Cross-side messages
                <select
                  className="rounded-full border border-line bg-paper px-2 py-1 text-ink"
                  value={world.partitionMode}
                  onChange={(event) => mutate((current) => setPartitionMode(current, event.target.value === "drop" ? "drop" : "hold"))}
                >
                  <option value="hold">Hold</option>
                  <option value="drop">Drop</option>
                </select>
              </label>
              <div className="mt-3 grid gap-2">
                {world.servers.map((item) => (
                  <label key={item.id} className="flex items-center justify-between gap-2">
                    <span>{item.id}</span>
                    <select
                      aria-label={`Side for ${item.id}`}
                      className="rounded-full border border-line bg-paper px-2 py-1"
                      value={item.partition}
                      onChange={(event) => mutate((current) => setPartition(current, item.id, Number(event.target.value)))}
                    >
                      <option value={1}>Side 1</option>
                      <option value={2}>Side 2</option>
                      <option value={3}>Side 3</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </details>
        </div>
      </header>

      <details className="mt-2 text-sm text-muted">
        <summary className="cursor-pointer text-ink">Rules in one minute</summary>
        <ul className="mt-2 grid list-disc gap-1 pl-4">
          <li>Ballots look like 1.A. Higher round wins. Same round, later letter wins.</li>
          <li>The first three promises lock phase 2. A later promise does not rewrite it.</li>
          <li>If that quorum reported an accept, the proposer must reuse the highest one.</li>
          <li>Chosen means 3 of 5 acceptors wrote the same ballot and value. Learning it is separate.</li>
        </ul>
      </details>

      <div className="mt-3 flex gap-2 overflow-x-auto" role="tablist" aria-label="Challenges">
        {SCENARIOS.map((item) => {
          const selectedTab = item.id === scenario;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selectedTab}
              className={`shrink-0 rounded-full px-3 py-1 text-sm ${selectedTab ? "bg-ink text-card" : "text-muted hover:text-ink"}`}
              onClick={() => {
                const hash = hashForScenario(item.id);
                if (window.location.hash === hash) dispatch({ type: "scenario", id: item.id });
                else window.location.hash = hash;
              }}
            >
              {item.name}
            </button>
          );
        })}
      </div>

      <section role="tabpanel" aria-labelledby={`tab-${scenario}`} className="mt-2">
        <p className="max-w-4xl text-sm leading-relaxed">{active.goal}</p>
        <p className="mt-1 text-sm font-semibold text-pine">{progressLabel(scenario, world)}</p>
        {done && active.debrief ? <p className="mt-2 max-w-4xl text-sm leading-relaxed text-pine">{active.debrief}</p> : null}
      </section>

      <p className="mt-3 text-sm" role="status" aria-label="Chosen value">
        {world.chosen ? (
          <>
            <span className="font-semibold text-pine">Chosen</span> “{world.chosen.value}” at {formatBallot(world.chosen.ballot)}, accepted by{" "}
            {world.chosen.acceptors.join(", ")}.
            {world.servers.some((item) => item.learned?.value !== world.chosen?.value)
              ? " Some servers still have not learned it."
              : " Every server has learned it."}
          </>
        ) : (
          <span className="text-muted">Nothing is chosen yet. A majority is {MAJORITY} of {SERVER_IDS.length}.</span>
        )}
      </p>

      <div className="mt-3">
        <Timeline
          world={world}
          selectedServer={state.selected}
          onSelectServer={(id) => {
            dispatch({ type: "select", id });
            setPin({ kind: "server", id });
            setHover(null);
          }}
          onActivateMessage={activateMessage}
          onHover={setHover}
        />
      </div>

      <section className="mt-3 rounded-2xl border border-line bg-card p-4" aria-label="Selection">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <h2 className="font-serif text-xl">{explanationTitle}</h2>
            <p className="mt-1 text-sm leading-relaxed" aria-live="polite">
              {explanation}
            </p>
          </div>
          {activeQueued ? (
            <MessageActions
              held={deliveryBlock(world, activeQueued) === "held"}
              offline={!world.servers.find((item) => item.id === activeQueued.to)?.online}
              canDelay={world.queue[world.queue.length - 1]?.id !== activeQueued.id}
              onDeliver={() => activateMessage(activeQueued.id)}
              onDelay={() => mutate((current) => delay(current, activeQueued.id))}
              onDrop={() => mutate((current) => drop(current, activeQueued.id))}
            />
          ) : pin.kind === "server" || hover !== null ? (
            <ServerActions
              serverId={server.id}
              online={server.online}
              promised={server.promised ? formatBallot(server.promised) : "none"}
              accepted={server.accepted ? `“${server.accepted.value}” at ${formatBallot(server.accepted.ballot)}` : "nothing"}
              knows={server.learned ? `“${server.learned.value}”` : "has not learned"}
              draft={state.draft}
              showSides={showNetwork}
              partition={server.partition}
              onDraft={(value) => dispatch({ type: "draft", value })}
              onPropose={() => mutate((current) => propose(current, server.id, state.draft))}
              onPower={() =>
                mutate((current) => {
                  const live = current.servers.find((item) => item.id === server.id);
                  return live?.online ? crash(current, server.id) : restart(current, server.id);
                })
              }
              onPartition={(partition) => mutate((current) => setPartition(current, server.id, partition))}
            />
          ) : null}
        </div>
        <details className="mt-3 text-sm text-muted">
          <summary className="cursor-pointer">Earlier steps</summary>
          <ol className="mt-2 max-h-48 space-y-1 overflow-auto">
            {world.log.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
          </ol>
        </details>
      </section>
    </div>
  );
}

function MessageActions({
  held,
  offline,
  canDelay,
  onDeliver,
  onDelay,
  onDrop,
}: {
  held: boolean;
  offline: boolean;
  canDelay: boolean;
  onDeliver: () => void;
  onDelay: () => void;
  onDrop: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Message actions">
      <button
        type="button"
        className="rounded-full bg-ink px-3 py-1.5 text-sm font-semibold text-card disabled:opacity-40"
        disabled={held}
        onClick={onDeliver}
      >
        {offline && !held ? "Deliver (drops)" : "Deliver"}
      </button>
      <QuietButton onClick={onDelay} disabled={!canDelay}>
        Delay
      </QuietButton>
      <QuietButton onClick={onDrop}>Drop</QuietButton>
      {held ? <span className="self-center text-xs text-gold">Held by the partition</span> : null}
    </div>
  );
}

function ServerActions({
  serverId,
  online,
  promised,
  accepted,
  knows,
  draft,
  showSides,
  partition,
  onDraft,
  onPropose,
  onPower,
  onPartition,
}: {
  serverId: ServerId;
  online: boolean;
  promised: string;
  accepted: string;
  knows: string;
  draft: string;
  showSides: boolean;
  partition: number;
  onDraft: (value: string) => void;
  onPropose: () => void;
  onPower: () => void;
  onPartition: (partition: number) => void;
}) {
  return (
    <div className="grid justify-items-end gap-2">
      <p className="text-right text-xs text-muted">
        Promised {promised} · Accepted {accepted} · {knows}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={draft === preset}
            className={`rounded-full px-2.5 py-1 text-sm ${draft === preset ? "bg-ink text-card" : "text-muted"}`}
            onClick={() => onDraft(preset)}
          >
            {preset}
          </button>
        ))}
        <input
          aria-label="Custom proposal value"
          value={PRESETS.includes(draft as (typeof PRESETS)[number]) ? "" : draft}
          placeholder="Custom"
          maxLength={48}
          className="w-28 rounded-full border border-line bg-paper px-3 py-1 text-sm"
          onChange={(event) => onDraft(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="rounded-full bg-clay px-3 py-1.5 text-sm font-semibold text-card disabled:opacity-40"
          disabled={!online || draft.trim().length === 0}
          onClick={onPropose}
        >
          Propose from {serverId}
        </button>
        <QuietButton onClick={onPower}>{online ? "Crash" : "Restart"}</QuietButton>
        {showSides ? (
          <select
            aria-label={`Side for ${serverId}`}
            className="rounded-full border border-line bg-paper px-2 py-1 text-sm"
            value={partition}
            onChange={(event) => onPartition(Number(event.target.value))}
          >
            <option value={1}>Side 1</option>
            <option value={2}>Side 2</option>
            <option value={3}>Side 3</option>
          </select>
        ) : null}
      </div>
    </div>
  );
}

function QuietButton({
  children,
  onClick,
  disabled,
  pressed,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${
        pressed ? "border-ink bg-ink text-card" : "border-line bg-card text-ink"
      }`}
    >
      {children}
    </button>
  );
}
