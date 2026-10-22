import { useEffect, useMemo, useReducer, useRef } from "react";
import { formatBallot } from "./paxos/ballot";
import {
  crash,
  delay,
  deliver,
  deliveryBlock,
  describeMessage,
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
import {
  MAJORITY,
  SERVER_IDS,
  type LogEntry,
  type Message,
  type ScenarioId,
  type ServerId,
  type ServerState,
  type World,
} from "./paxos/types";

const PRESETS = ["Withdraw $80", "Withdraw $50", "red", "blue"] as const;

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
  const transcriptRef = useRef<HTMLDivElement>(null);
  const { world, scenario } = state;
  const active = scenarioById(scenario);
  const done = isComplete(scenario, world);
  const selected = world.servers.find((server) => server.id === state.selected) ?? world.servers[0]!;

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
  }, []);

  useEffect(() => {
    if (!state.autoplay) return;
    const timer = window.setInterval(() => {
      dispatch({
        type: "mutate",
        op: (world) => {
          const message = nextAutoMessage(world);
          return message ? deliver(world, message.id) : world;
        },
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, [state.autoplay]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [world.log.length, scenario]);

  const openScenario = (id: ScenarioId) => {
    const hash = hashForScenario(id);
    if (window.location.hash === hash) dispatch({ type: "scenario", id });
    else window.location.hash = hash;
  };

  const mutate = (op: (world: World) => World) => dispatch({ type: "mutate", op });

  const latest = world.log[world.log.length - 1];

  return (
    <div className="mx-auto min-h-screen max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-clay uppercase">Single decree</p>
          <h1 className="font-serif text-3xl leading-tight text-ink sm:text-4xl">Paxos playground</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Five servers, one decision. You are the network: deliver, delay, or drop each message.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToolbarButton onClick={() => dispatch({ type: "undo" })} disabled={state.past.length === 0}>
            Undo
          </ToolbarButton>
          <ToolbarButton onClick={() => dispatch({ type: "scenario", id: scenario })}>Reset</ToolbarButton>
          <ToolbarButton
            onClick={() =>
              mutate((current) => {
                const message = nextAutoMessage(current);
                return message ? deliver(current, message.id) : current;
              })
            }
            disabled={!nextAutoMessage(world)}
          >
            Step
          </ToolbarButton>
          <ToolbarButton pressed={state.autoplay} onClick={() => dispatch({ type: "autoplay", on: !state.autoplay })}>
            {state.autoplay ? "Stop autoplay" : "Autoplay"}
          </ToolbarButton>
        </div>
      </header>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Challenges">
        {SCENARIOS.map((item) => {
          const selectedTab = item.id === scenario;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selectedTab}
              id={`tab-${item.id}`}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-left text-sm ${
                selectedTab ? "border-ink bg-ink text-card" : "border-line bg-card text-ink hover:border-ink"
              }`}
              onClick={() => openScenario(item.id)}
            >
              <span className={`block text-[10px] tracking-wide uppercase ${selectedTab ? "text-card/70" : "text-muted"}`}>
                {item.kicker}
              </span>
              {item.name}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        aria-labelledby={`tab-${scenario}`}
        className="mt-3 rounded-2xl border border-line bg-card px-4 py-3"
      >
        <p className="text-sm leading-relaxed text-ink">{active.goal}</p>
        <p className="mt-2 text-sm font-semibold text-pine">{progressLabel(scenario, world)}</p>
        {done && active.debrief ? (
          <div className="mt-3 rounded-xl bg-pine-soft px-3 py-2 text-sm leading-relaxed text-ink">
            <p className="font-semibold text-pine">Challenge complete</p>
            <p className="mt-1">{active.debrief}</p>
          </div>
        ) : null}
      </section>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="grid gap-4">
          <ChosenBanner world={world} />
          <section aria-label="Servers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {world.servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                selected={server.id === selected.id}
                chosenValue={world.chosen?.value ?? null}
                onSelect={() => dispatch({ type: "select", id: server.id })}
                onTogglePower={() =>
                  mutate((current) => {
                    const live = current.servers.find((item) => item.id === server.id);
                    return live?.online ? crash(current, server.id) : restart(current, server.id);
                  })
                }
                onPartition={(partition) => mutate((current) => setPartition(current, server.id, partition))}
              />
            ))}
          </section>

          <section className="rounded-2xl border border-line bg-card p-4" aria-label="Propose a value">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl">Propose from {selected.id}</h2>
                <p className="text-sm text-muted">
                  {selected.online
                    ? "The new ballot is higher than anything this server has seen. Its own acceptor promises immediately."
                    : `${selected.id} is offline. Restart it before it can propose.`}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full bg-clay px-4 py-2 text-sm font-semibold text-card disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!selected.online || state.draft.trim().length === 0}
                onClick={() => mutate((current) => propose(current, selected.id, state.draft))}
              >
                Propose “{state.draft.trim() || "…"}”
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={state.draft === preset}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    state.draft === preset ? "border-ink bg-ink text-card" : "border-line bg-paper text-ink"
                  }`}
                  onClick={() => dispatch({ type: "draft", value: preset })}
                >
                  {preset}
                </button>
              ))}
              <label className="flex items-center gap-2 text-sm text-muted">
                Custom
                <input
                  value={PRESETS.includes(state.draft as (typeof PRESETS)[number]) ? "" : state.draft}
                  placeholder="your value"
                  maxLength={48}
                  className="w-36 rounded-full border border-line bg-paper px-3 py-1 text-ink"
                  onChange={(event) => dispatch({ type: "draft", value: event.target.value })}
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
              <span className="text-muted">Network</span>
              <ToolbarButton onClick={() => mutate(heal)}>Heal</ToolbarButton>
              <ToolbarButton onClick={() => mutate(splitThreeTwo)}>Split 3/2</ToolbarButton>
              <label className="ml-auto flex items-center gap-2 text-muted">
                Cross-partition messages
                <select
                  className="rounded-full border border-line bg-paper px-2 py-1 text-ink"
                  value={world.partitionMode}
                  onChange={(event) =>
                    mutate((current) => setPartitionMode(current, event.target.value === "drop" ? "drop" : "hold"))
                  }
                >
                  <option value="hold">Hold</option>
                  <option value="drop">Drop</option>
                </select>
              </label>
            </div>
          </section>

          <MessageQueue
            world={world}
            onDeliver={(id) => mutate((current) => deliver(current, id))}
            onDelay={(id) => mutate((current) => delay(current, id))}
            onDrop={(id) => mutate((current) => drop(current, id))}
          />
        </main>

        <aside className="grid gap-3 lg:sticky lg:top-4">
          <details className="rounded-2xl border border-line bg-card px-4 py-3 text-sm leading-relaxed">
            <summary className="cursor-pointer font-semibold">Rules in one minute</summary>
            <ul className="mt-2 grid list-disc gap-2 pl-4 text-muted">
              <li>Ballots look like 1.A. Higher round wins. Same round, later letter wins, so 1.D beats 1.A and 2.A beats 1.E.</li>
              <li>A promise reports the last accepted value. The first 3 promises lock phase 2. A later promise does not rewrite it.</li>
              <li>If any promise in that quorum has an accepted value, the proposer must use the one from the highest accepted ballot.</li>
              <li>Chosen means 3 of 5 acceptors wrote down the same ballot and value. Knowing that is a separate Learn step.</li>
              <li>A crash keeps the promise and the last accept, and forgets the proposal and the learned decision.</li>
            </ul>
          </details>
          <section className="rounded-2xl border border-line bg-card p-4" aria-label="Explanation">
            <h2 className="font-serif text-xl">What just happened</h2>
            {latest ? (
              <p className={`mt-2 font-serif text-lg leading-snug ${toneClass(latest.tone)}`} aria-live="polite">
                {latest.text}
              </p>
            ) : null}
            <div id="transcript" ref={transcriptRef} className="mt-4 max-h-[520px] overflow-auto pr-1">
              <ol className="grid gap-2">
                {world.log.map((entry) => (
                  <li key={entry.id} className={`rounded-xl border px-3 py-2 text-sm leading-relaxed ${logClass(entry)}`}>
                    {entry.text}
                  </li>
                ))}
              </ol>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ChosenBanner({ world }: { world: World }) {
  const closest = useMemo(() => {
    return [...world.accepts].sort((a, b) => b.acceptors.length - a.acceptors.length)[0] ?? null;
  }, [world.accepts]);
  const chosen = world.chosen;
  const extras =
    chosen === null
      ? []
      : world.accepts.filter(
          (record) =>
            record.acceptors.length >= MAJORITY &&
            !(record.value === chosen.value && record.ballot.round === chosen.ballot.round && record.ballot.serverId === chosen.ballot.serverId),
        );

  return (
    <section
      className={`rounded-2xl border p-4 ${chosen ? "border-pine bg-pine-soft" : "border-line bg-card"}`}
      aria-label="Chosen value"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl">{chosen ? "Chosen" : "Not chosen"}</h2>
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Majority is {MAJORITY} of {SERVER_IDS.length}</p>
      </div>
      {chosen ? (
        <>
          <p className="mt-1 text-lg font-semibold text-pine" role="status">
            “{chosen.value}” at ballot {formatBallot(chosen.ballot)}
          </p>
          <p className="mt-1 text-sm leading-relaxed">
            Accepted by {chosen.acceptors.join(", ")}. This is true even when some servers have not learned it.
          </p>
          {extras.length > 0 ? (
            <p className="mt-1 text-sm text-muted">
              Also accepted by a majority at{" "}
              {extras.map((record) => `${formatBallot(record.ballot)} (“${record.value}”)`).join(", ")}.
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-sm leading-relaxed" role="status">
          {closest
            ? `${closest.acceptors.length} of ${MAJORITY} have accepted “${closest.value}” at ${formatBallot(closest.ballot)} (${closest.acceptors.join(", ")}).`
            : "No acceptor has written down a value yet."}
        </p>
      )}
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="What each server knows">
        {world.servers.map((server) => {
          const knows = server.learned?.value ?? null;
          const divergent = Boolean(chosen && knows && knows !== chosen.value);
          const missing = Boolean(chosen && !knows);
          return (
            <li
              key={server.id}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                divergent ? "border-wine bg-wine-soft" : missing ? "border-gold bg-gold-soft" : knows ? "border-pine bg-card" : "border-line bg-card"
              }`}
            >
              <span className="font-semibold">{server.id}</span>{" "}
              {!server.online ? "offline · " : ""}
              {knows ? `knows “${knows}”` : "has not learned"}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ServerCard({
  server,
  selected,
  chosenValue,
  onSelect,
  onTogglePower,
  onPartition,
}: {
  server: ServerState;
  selected: boolean;
  chosenValue: string | null;
  onSelect: () => void;
  onTogglePower: () => void;
  onPartition: (partition: number) => void;
}) {
  const proposal = server.proposal;
  const knows = server.learned?.value ?? null;
  return (
    <article
      className={`rounded-2xl border bg-card p-3 ${selected ? "border-ink ring-2 ring-ink" : "border-line"} ${
        server.online ? "" : "border-dashed opacity-80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="text-left" onClick={onSelect} aria-pressed={selected}>
          <span className="font-serif text-3xl leading-none">{server.id}</span>
          <span className="mt-1 block text-xs text-muted">{selected ? "Selected proposer" : "Select as proposer"}</span>
        </button>
        <span className={`mt-1 h-2.5 w-2.5 rounded-full ${server.online ? "bg-pine" : "bg-wine"}`} aria-hidden="true" />
      </div>
      <dl className="mt-3 grid gap-2 text-xs">
        <Field label="Highest promised" value={server.promised ? formatBallot(server.promised) : "none"} />
        <Field
          label="Last accepted"
          value={server.accepted ? `“${server.accepted.value}” at ${formatBallot(server.accepted.ballot)}` : "nothing"}
        />
        <Field
          label="Knows chosen"
          value={
            knows
              ? `“${knows}”${chosenValue && knows !== chosenValue ? " (disagrees)" : ""}`
              : chosenValue
                ? "not yet"
                : "nothing chosen"
          }
        />
      </dl>
      {proposal ? (
        <p className="mt-2 rounded-lg bg-paper px-2 py-1 text-xs leading-snug">
          {proposal.phase === "preparing"
            ? `Preparing ${formatBallot(proposal.ballot)} for “${proposal.requested}”. Promises ${proposal.promises.length} of ${MAJORITY}.`
            : `Accepting “${proposal.value}” at ${formatBallot(proposal.ballot)}${
                proposal.value !== proposal.requested ? ` (asked for “${proposal.requested}”)` : ""
              }. Accepts ${proposal.accepts.length} of ${MAJORITY}.`}
        </p>
      ) : null}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" className="rounded-full border border-line px-2 py-1 text-xs" onClick={onTogglePower}>
          {server.online ? "Crash" : "Restart"}
        </button>
        <label className="ml-auto flex items-center gap-1 text-xs text-muted">
          Side
          <select
            aria-label={`Partition for ${server.id}`}
            className="rounded-full border border-line bg-paper px-1 py-1 text-ink"
            value={server.partition}
            onChange={(event) => onPartition(Number(event.target.value))}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}

function MessageQueue({
  world,
  onDeliver,
  onDelay,
  onDrop,
}: {
  world: World;
  onDeliver: (id: string) => void;
  onDelay: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  return (
    <section className="rounded-2xl border border-line bg-card p-4" aria-label="Pending messages">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-xl">Pending messages</h2>
        <p className="text-xs text-muted">{world.queue.length} in flight · deliver any, not only the first</p>
      </div>
      {world.queue.length === 0 ? (
        <p className="mt-3 text-sm text-muted">The network is empty. Propose a value to send Prepare messages.</p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {world.queue.map((message, index) => (
            <MessageRow
              key={message.id}
              message={message}
              index={index}
              last={index === world.queue.length - 1}
              world={world}
              onDeliver={onDeliver}
              onDelay={onDelay}
              onDrop={onDrop}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function MessageRow({
  message,
  index,
  last,
  world,
  onDeliver,
  onDelay,
  onDrop,
}: {
  message: Message;
  index: number;
  last: boolean;
  world: World;
  onDeliver: (id: string) => void;
  onDelay: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const block = deliveryBlock(world, message);
  const recipient = world.servers.find((server) => server.id === message.to);
  const offline = recipient ? !recipient.online : false;
  const held = block === "held";
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
      <span className="w-5 text-xs text-muted">{index + 1}</span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${messageClass(message.type)}`}>{labelFor(message.type)}</span>
      <p className="min-w-0 flex-1 text-sm">
        {describeMessage(message)}
        {held ? <span className="ml-2 text-xs font-semibold text-gold">Held by the partition</span> : null}
        {offline ? <span className="ml-2 text-xs font-semibold text-wine">Recipient is offline</span> : null}
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-card disabled:cursor-not-allowed disabled:opacity-40"
          disabled={held}
          onClick={() => onDeliver(message.id)}
        >
          {offline ? "Deliver (drops)" : "Deliver"}
        </button>
        <button
          type="button"
          className="rounded-full border border-line bg-card px-3 py-1 text-xs disabled:opacity-40"
          disabled={last}
          onClick={() => onDelay(message.id)}
        >
          Delay
        </button>
        <button type="button" className="rounded-full border border-line bg-card px-3 py-1 text-xs" onClick={() => onDrop(message.id)}>
          Drop
        </button>
      </div>
    </li>
  );
}

function ToolbarButton({
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
      className={`rounded-full border px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed ? "border-ink bg-ink text-card" : "border-line bg-card text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

function labelFor(type: Message["type"]): string {
  switch (type) {
    case "prepare":
      return "Prepare";
    case "promise":
      return "Promise";
    case "nack":
      return "Nack";
    case "accept":
      return "Accept";
    case "accepted":
      return "Accepted";
    case "learn":
      return "Learn";
  }
}

function messageClass(type: Message["type"]): string {
  switch (type) {
    case "prepare":
      return "bg-card text-ink";
    case "promise":
      return "bg-pine-soft text-pine";
    case "nack":
      return "bg-wine-soft text-wine";
    case "accept":
      return "bg-gold-soft text-gold";
    case "accepted":
      return "bg-sea-soft text-sea";
    case "learn":
      return "bg-clay-soft text-clay";
  }
}

function toneClass(tone: LogEntry["tone"]): string {
  if (tone === "good") return "text-pine";
  if (tone === "bad" || tone === "warn") return "text-wine";
  if (tone === "key") return "text-clay";
  return "text-ink";
}

function logClass(entry: LogEntry): string {
  if (entry.tone === "good") return "border-pine/30 bg-pine-soft";
  if (entry.tone === "bad") return "border-wine/30 bg-wine-soft";
  if (entry.tone === "warn") return "border-gold/40 bg-gold-soft";
  if (entry.tone === "key") return "border-clay/30 bg-clay-soft";
  return "border-line bg-paper";
}
