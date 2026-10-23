import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { RoleGlyph } from "./RoleGlyph";
import { Timeline, type Packet } from "./Timeline";
import { nextHover, type HoverState } from "./hover";
import { formatBallot } from "./paxos/ballot";
import {
  crash,
  delay,
  deliver,
  drop,
  heal,
  isolate,
  nextAutoMessage,
  propose,
  restart,
  setPartition,
  setPartitionMode,
  splitThreeTwo,
} from "./paxos/engine";
import { ROLE_LEGEND, serverRoleLine } from "./paxos/roles";
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
  const [hover, setHover] = useState<HoverState>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [networkOpen, setNetworkOpen] = useState(false);
  const flying = useRef(false);
  const raf = useRef(0);
  const flightGen = useRef(0);
  const showNetwork = scenario === "free" || scenario === "partition";
  const animating = packet !== null;

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
    setPin({ kind: "server", id: recommendedProposer(scenario) });
    setHover(null);
    setNetworkOpen(false);
    flightGen.current += 1;
    flying.current = false;
    cancelAnimationFrame(raf.current);
    setPacket(null);
  }, [scenario]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const mutate = (op: (world: World) => World) => dispatch({ type: "mutate", op });
  const pinnedMessage = pin.kind === "message" ? world.diagram.arrows.find((arrow) => arrow.messageId === pin.id) : undefined;
  const explanation =
    hover?.detail ??
    pinnedMessage?.detail ??
    `${server.id} is ${server.online ? "online" : "offline"} on side ${server.partition}. Highest promised ballot: ${
      server.promised ? formatBallot(server.promised) : "none"
    }. Last accepted: ${server.accepted ? `“${server.accepted.value}” at ${formatBallot(server.accepted.ballot)}` : "nothing"}. ${
      server.learned ? `It knows “${server.learned.value}” was chosen.` : "It has not learned a chosen value."
    }`;
  const explanationTitle = hover?.title ?? (pinnedMessage ? `${pinnedMessage.label} ${pinnedMessage.from} → ${pinnedMessage.to}` : `Server ${server.id}`);

  const onHover = (info: HoverState) => setHover((current) => nextHover(current, info));

  const startFlight = (messageId: string) => {
    if (flying.current) return;
    if (!world.queue.some((message) => message.id === messageId)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      mutate((current) => deliver(current, messageId));
      return;
    }
    const generation = flightGen.current + 1;
    flightGen.current = generation;
    flying.current = true;
    const started = performance.now();
    const duration = 560;
    const tick = (now: number) => {
      if (flightGen.current !== generation) return;
      const progress = Math.min(1, (now - started) / duration);
      setPacket({ messageId, progress });
      if (progress < 1) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      flying.current = false;
      setPacket(null);
      dispatch({ type: "mutate", op: (current) => deliver(current, messageId) });
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (!state.autoplay || animating || flying.current) return;
    const message = nextAutoMessage(world);
    if (!message) return;
    const timer = window.setTimeout(() => startFlight(message.id), 240);
    return () => window.clearTimeout(timer);
  }, [state.autoplay, world, animating]);

  const network = (
    <NetworkControls
      world={world}
      selected={server.id}
      onHeal={() => mutate(heal)}
      onSplit={() => mutate(splitThreeTwo)}
      onIsolate={() => mutate((current) => isolate(current, server.id))}
      onMove={(id) =>
        mutate((current) => {
          const live = current.servers.find((item) => item.id === id);
          return setPartition(current, id, live && live.partition === 1 ? 2 : 1);
        })
      }
      onMode={(mode) => mutate((current) => setPartitionMode(current, mode))}
    />
  );

  return (
    <div className="no-anchor mx-auto min-h-screen max-w-[1440px] px-4 py-4 sm:px-6">
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
            onClick={() => {
              const message = nextAutoMessage(world);
              if (message) startFlight(message.id);
            }}
            disabled={!nextAutoMessage(world) || packet !== null}
          >
            Step
          </QuietButton>
          <QuietButton pressed={state.autoplay} onClick={() => dispatch({ type: "autoplay", on: !state.autoplay })}>
            {state.autoplay ? "Stop" : "Autoplay"}
          </QuietButton>
          {showNetwork ? null : (
            <button
              type="button"
              className="btn btn-quiet rounded-full px-3 py-1.5 text-sm font-semibold"
              aria-expanded={networkOpen}
              aria-controls="network-sheet"
              onClick={() => setNetworkOpen((open) => !open)}
            >
              Network
            </button>
          )}
        </div>
      </header>

      {showNetwork ? <div className="mt-3">{network}</div> : null}
      {networkOpen && !showNetwork ? (
        <>
          <button type="button" className="network-backdrop" aria-label="Close network" onClick={() => setNetworkOpen(false)} />
          <div id="network-sheet" className="network-sheet" role="dialog" aria-label="Network">
            {network}
          </div>
        </>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-x-4 text-sm text-muted">
        <details>
          <summary className="btn btn-ghost rounded-full px-2 py-1 text-ink">Rules in one minute</summary>
          <ul className="mt-2 grid list-disc gap-1 pl-4">
            <li>Ballots look like 1.A. Higher round wins. Same round, later letter wins.</li>
            <li>The first three promises lock phase 2. A later promise does not rewrite it.</li>
            <li>If that quorum reported an accept, the proposer must reuse the highest one.</li>
            <li>Chosen means 3 of 5 acceptors wrote the same ballot and value. Learning it is separate.</li>
          </ul>
        </details>
        <details>
          <summary className="btn btn-ghost rounded-full px-2 py-1 text-ink">Roles</summary>
          <div className="mt-2 grid max-w-3xl gap-2">
            <p>Every server is an acceptor. It can also propose, and it learns a value only when a Learn message or its own majority of Accepted replies tells it.</p>
            <p>
              In Paxos Made Moderately Complex, each server is a replica. A proposer acting as leader sends a scout for phase 1 and a commander for phase 2.
              The icons on a Step animation are that role.
            </p>
            <ul className="flex flex-wrap gap-3">
              {ROLE_LEGEND.map((role) => (
                <li key={role.kind} className="flex items-center gap-2">
                  <RoleGlyph kind={role.kind} />
                  <span>
                    <span className="font-semibold text-ink">{role.short}.</span> {role.caption}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="grid gap-1 text-ink">
              {world.servers.map((item) => (
                <li key={item.id}>{serverRoleLine(item)}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Challenges">
        {SCENARIOS.map((item) => {
          const selectedTab = item.id === scenario;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`tab-${item.id}`}
              aria-selected={selectedTab}
              className={`btn rounded-full px-3 py-1 text-sm ${selectedTab ? "btn-ink" : "btn-ghost"}`}
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

      <section role="tabpanel" aria-labelledby={`tab-${scenario}`} className="challenge-copy mt-2">
        <p className="max-w-4xl text-sm leading-relaxed">{active.goal}</p>
        <p className="mt-1 text-sm font-semibold text-pine">{progressLabel(scenario, world)}</p>
        {done && active.debrief ? <p className="mt-2 max-w-4xl text-sm leading-relaxed text-pine">{active.debrief}</p> : null}
      </section>

      <p className="mt-3 min-h-12 text-sm" role="status" aria-label="Chosen value">
        {world.chosen ? (
          <>
            <span className="font-semibold text-pine">Chosen</span> “{world.chosen.value}” at {formatBallot(world.chosen.ballot)}, accepted by{" "}
            {world.chosen.acceptors.join(", ")}.
            {world.servers.some((item) => item.learned?.value !== world.chosen?.value)
              ? " Some servers still have not learned it."
              : " Every server has learned it."}
          </>
        ) : (
          <span className="text-muted">
            Nothing is chosen yet. A majority is {MAJORITY} of {SERVER_IDS.length}.
          </span>
        )}
      </p>

      <div className="mt-3">
        <Timeline
          world={world}
          selectedServer={state.selected}
          selectedMessageId={pin.kind === "message" ? pin.id : null}
          packet={packet}
          onSelectServer={(id) => {
            dispatch({ type: "select", id });
            setPin({ kind: "server", id });
            setHover(null);
          }}
          onSelectMessage={(id) => setPin({ kind: "message", id })}
          onHover={onHover}
          onDeliver={startFlight}
          onDelay={(id) => mutate((current) => delay(current, id))}
          onDrop={(id) => {
            setPin({ kind: "server", id: state.selected });
            mutate((current) => drop(current, id));
          }}
        />
      </div>

      <section className="no-anchor mt-3 rounded-2xl border border-line bg-card p-4" aria-label="Selection">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="h-28 min-w-0 max-w-2xl overflow-y-auto">
            <h2 className="font-serif text-xl">{explanationTitle}</h2>
            <p className="mt-1 text-sm leading-relaxed">{explanation}</p>
          </div>
          <ServerActions
            serverId={server.id}
            online={server.online}
            promised={server.promised ? formatBallot(server.promised) : "none"}
            accepted={server.accepted ? `“${server.accepted.value}” at ${formatBallot(server.accepted.ballot)}` : "nothing"}
            knows={server.learned ? `“${server.learned.value}”` : "has not learned"}
            role={serverRoleLine(server)}
            draft={state.draft}
            onDraft={(value) => dispatch({ type: "draft", value })}
            onPropose={() => mutate((current) => propose(current, server.id, state.draft))}
            onPower={() =>
              mutate((current) => {
                const live = current.servers.find((item) => item.id === server.id);
                return live?.online ? crash(current, server.id) : restart(current, server.id);
              })
            }
          />
        </div>
        <details className="mt-3 text-sm text-muted">
          <summary className="btn btn-ghost rounded-full px-2 py-1">Earlier steps</summary>
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

function NetworkControls({
  world,
  selected,
  onHeal,
  onSplit,
  onIsolate,
  onMove,
  onMode,
}: {
  world: World;
  selected: ServerId;
  onHeal: () => void;
  onSplit: () => void;
  onIsolate: () => void;
  onMove: (id: ServerId) => void;
  onMode: (mode: "hold" | "drop") => void;
}) {
  const together = world.servers.filter((item) => item.partition === 1);
  const cutoff = world.servers.filter((item) => item.partition !== 1);
  return (
    <div className="grid gap-3" aria-label="Network">
      <div className="flex flex-wrap items-center gap-2">
        <QuietButton onClick={onHeal}>Heal all</QuietButton>
        <QuietButton onClick={onSplit}>Split 3/2</QuietButton>
        <QuietButton onClick={onIsolate}>Isolate {selected}</QuietButton>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm whitespace-nowrap text-muted">Crossing messages</span>
        <QuietButton pressed={world.partitionMode === "hold"} onClick={() => onMode("hold")}>
          Hold
        </QuietButton>
        <QuietButton pressed={world.partitionMode === "drop"} onClick={() => onMode("drop")}>
          Discard
        </QuietButton>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ServerGroup title="Together" empty="Nobody is in the main group." servers={together} onMove={onMove} />
        <ServerGroup title="Cut off" empty="Nobody is cut off. Click a server to separate it." servers={cutoff} onMove={onMove} />
      </div>
    </div>
  );
}

function ServerGroup({
  title,
  empty,
  servers,
  onMove,
}: {
  title: string;
  empty: string;
  servers: World["servers"];
  onMove: (id: ServerId) => void;
}) {
  return (
    <div className="min-h-[4.75rem] rounded-2xl border border-line bg-paper px-3 py-2">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</p>
      {servers.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {servers.map((item) => (
            <button
              key={item.id}
              type="button"
              className="btn btn-quiet rounded-full px-3 py-1 font-serif text-lg"
              onClick={() => onMove(item.id)}
            >
              {item.id}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ServerActions({
  serverId,
  online,
  promised,
  accepted,
  knows,
  role,
  draft,
  onDraft,
  onPropose,
  onPower,
}: {
  serverId: ServerId;
  online: boolean;
  promised: string;
  accepted: string;
  knows: string;
  role: string;
  draft: string;
  onDraft: (value: string) => void;
  onPropose: () => void;
  onPower: () => void;
}) {
  return (
    <div className="grid justify-items-end gap-2">
      <p className="text-right text-xs text-muted">
        {role}. Promised {promised} · Accepted {accepted} · {knows}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={draft === preset}
            className={`btn rounded-full px-2.5 py-1 text-sm ${draft === preset ? "btn-ink" : "btn-ghost"}`}
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
          className="btn btn-clay rounded-full px-3 py-1.5 text-sm font-semibold"
          disabled={!online || draft.trim().length === 0}
          onClick={onPropose}
        >
          Propose from {serverId}
        </button>
        <QuietButton onClick={onPower}>{online ? "Crash" : "Restart"}</QuietButton>
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
  children: ReactNode;
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
      className={`btn rounded-full px-3 py-1.5 text-sm font-semibold ${pressed ? "btn-ink" : "btn-quiet"}`}
    >
      {children}
    </button>
  );
}
