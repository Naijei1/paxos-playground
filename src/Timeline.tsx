import { useEffect, useRef } from "react";
import { popoverBox } from "./popover";
import { deliveryBlock } from "./paxos/engine";
import { messageRole, serverRoleLine, serverRoleTag, type RoleKind } from "./paxos/roles";
import { SERVER_IDS, type DiagramArrow, type ServerId, type World } from "./paxos/types";

const ROW = 78;
const TOP = 28;
const PX = 52;
const NOW_GAP = 128;

export type HoverInfo = { title: string; detail: string; messageId?: string };
export type Packet = { messageId: string; progress: number };

type TimelineProps = {
  world: World;
  selectedServer: ServerId;
  selectedMessageId: string | null;
  packet: Packet | null;
  onSelectServer: (id: ServerId) => void;
  onSelectMessage: (messageId: string) => void;
  onHover: (info: HoverInfo | null) => void;
  onDeliver: (messageId: string) => void;
  onDelay: (messageId: string) => void;
  onDrop: (messageId: string) => void;
};

const strokeFor: Record<DiagramArrow["type"], string> = {
  prepare: "#1b1714",
  promise: "#1c6b45",
  nack: "#8d2e2e",
  accept: "#8a5a12",
  accepted: "#1d4e89",
  learn: "#b34a22",
};

const roleFill: Record<RoleKind, string> = {
  scout: "#1b1714",
  commander: "#8a5a12",
  acceptor: "#1c6b45",
  learner: "#b34a22",
};

const partitionColor = (partition: number) => (partition === 2 ? "#b34a22" : partition === 3 ? "#1d4e89" : "#1b1714");

export function Timeline({
  world,
  selectedServer,
  selectedMessageId,
  packet,
  onSelectServer,
  onSelectMessage,
  onHover,
  onDeliver,
  onDelay,
  onDrop,
}: TimelineProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const clock = world.diagram.clock;
  const xOf = (time: number) => 16 + time * PX;
  const nowX = xOf(clock) + NOW_GAP;
  const width = nowX + 28;
  const height = TOP + SERVER_IDS.length * ROW + 18;
  const yOf = (id: ServerId) => TOP + SERVER_IDS.indexOf(id) * ROW + ROW / 2;

  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
  }, [clock, world.diagram.arrows.length]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !packet) return;
    const arrow = world.diagram.arrows.find((item) => item.messageId === packet.messageId);
    if (!arrow) return;
    const x = xOf(arrow.sendTime);
    if (x < node.scrollLeft + 24 || x > node.scrollLeft + node.clientWidth - 180) {
      node.scrollLeft = Math.max(0, x - 48);
    }
  }, [packet?.messageId]);

  const selected = world.diagram.arrows.find((arrow) => arrow.messageId === selectedMessageId);
  const queued = selected ? world.queue.find((message) => message.id === selected.messageId) : undefined;
  const popover = selected && queued ? popoverBox(selected, xOf, yOf, nowX, width, height) : null;

  return (
    <section className="no-anchor rounded-2xl border border-line bg-card" aria-label="Message timeline">
      <div className="flex flex-col gap-1 px-4 pt-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="font-serif text-xl">Timeline</h2>
        <p className="text-xs text-muted">Time runs to the right. Click an arrow for Deliver, Delay, or Drop.</p>
      </div>
      <div className="flex">
        <div className="w-16 shrink-0" style={{ paddingTop: TOP }}>
          {SERVER_IDS.map((id) => {
            const server = world.servers.find((item) => item.id === id);
            const pressed = id === selectedServer;
            const tag = server ? serverRoleTag(server) : null;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={pressed}
                aria-label={server ? serverRoleLine(server) : id}
                className={`btn btn-row flex w-full flex-col items-center justify-center font-serif ${pressed ? "text-ink" : "btn-ghost"}`}
                style={{ height: ROW }}
                onClick={() => onSelectServer(id)}
              >
                <span className={`text-lg leading-none ${server && !server.online ? "opacity-40" : ""}`}>{id}</span>
                {tag ? <span className="mt-1 text-[10px] leading-none font-sans font-semibold tracking-wide uppercase">{tag}</span> : null}
              </button>
            );
          })}
        </div>
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto" onMouseLeave={() => onHover(null)}>
          <div className="relative" style={{ width, height }}>
            <svg width={width} height={height} aria-label="Space-time diagram of the five servers">
              <defs>
                <marker id="arrowhead" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 Z" fill="context-stroke" />
                </marker>
              </defs>
              {SERVER_IDS.map((id, index) => {
                const pressed = id === selectedServer;
                const side = world.servers.find((item) => item.id === id)?.partition ?? 1;
                const wash = pressed ? "#f3ecdf" : side === 2 ? "#f6e4d8" : side === 3 ? "#e6eef6" : "transparent";
                return (
                  <rect
                    key={id}
                    x={0}
                    y={TOP + index * ROW}
                    width={width}
                    height={ROW}
                    fill={wash}
                    onClick={() => onSelectServer(id)}
                  />
                );
              })}
              {SERVER_IDS.map((id) =>
                segments(world, id, clock).map((segment, index) => (
                  <line
                    key={`${id}-${index}`}
                    x1={Math.min(xOf(segment.start), nowX)}
                    x2={segment.end >= clock ? nowX : xOf(segment.end)}
                    y1={yOf(id)}
                    y2={yOf(id)}
                    stroke={partitionColor(segment.partition)}
                    strokeWidth={segment.partition === 1 ? (selectedServer === id ? 2.5 : 1.5) : 3}
                    strokeDasharray={segment.offline ? "2 5" : undefined}
                    opacity={segment.offline ? 0.45 : 1}
                    pointerEvents="none"
                  />
                )),
              )}
              <line x1={nowX} y1={TOP} x2={nowX} y2={height - 12} stroke="#5e574e" strokeDasharray="3 4" pointerEvents="none" />
              <text x={nowX - 4} y={14} textAnchor="end" fontSize="11" fill="#5e574e">
                now
              </text>
              {world.diagram.chosenAt ? (
                <g pointerEvents="none">
                  <line
                    x1={xOf(world.diagram.chosenAt.time)}
                    x2={xOf(world.diagram.chosenAt.time)}
                    y1={16}
                    y2={height - 12}
                    stroke="#1c6b45"
                    strokeWidth={1.5}
                  />
                  <text x={xOf(world.diagram.chosenAt.time) + 6} y={16} fontSize="11" fill="#1c6b45">
                    {compactDiagramText(world.diagram.chosenAt.label)}
                  </text>
                </g>
              ) : null}
              {labeledArrows(world).map((arrow) => {
                const from = world.servers.find((item) => item.id === arrow.from);
                const to = world.servers.find((item) => item.id === arrow.to);
                const held = Boolean(arrow.status === "inflight" && from && to && from.partition !== to.partition);
                return (
                  <ArrowGlyph
                    key={arrow.messageId}
                    arrow={arrow}
                    held={held}
                    selected={arrow.messageId === selectedMessageId}
                    x1={xOf(arrow.sendTime)}
                    y1={yOf(arrow.from)}
                    x2={arrow.status === "inflight" ? nowX : endX(arrow, xOf)}
                    y2={yOf(arrow.to)}
                    showLabel={arrow.showLabel}
                    labelX={arrow.labelX}
                    labelY={arrow.labelY}
                    onSelect={() => onSelectMessage(arrow.messageId)}
                    onHover={onHover}
                  />
                );
              })}
              {packet ? <PacketDot world={world} packet={packet} xOf={xOf} yOf={yOf} nowX={nowX} /> : null}
              {localMarks(world).map((mark) => (
                <g
                  key={mark.id}
                  tabIndex={0}
                  role="button"
                  className="arrow-hit"
                  aria-label={`${mark.label} on ${mark.server}. ${mark.detail}`}
                  onMouseEnter={() => onHover({ title: `${mark.server} · ${mark.label}`, detail: mark.detail })}
                  onFocus={() => onHover({ title: `${mark.server} · ${mark.label}`, detail: mark.detail })}
                  onClick={() => onHover({ title: `${mark.server} · ${mark.label}`, detail: mark.detail })}
                >
                  <circle
                    className="arrow-focus"
                    cx={xOf(mark.time)}
                    cy={yOf(mark.server) - 14 - mark.stack * 14}
                    r={12}
                    fill="none"
                    stroke="#1d4e89"
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                  <Mark x={xOf(mark.time)} y={yOf(mark.server) - 14 - mark.stack * 14} kind={mark.kind} />
                  <text x={xOf(mark.time) + 7} y={yOf(mark.server) - 10 - mark.stack * 13} fontSize="11" fill="#5e574e" pointerEvents="none">
                    {compactDiagramText(mark.label)}
                  </text>
                </g>
              ))}
            </svg>
            {popover && queued ? (
              <div
                className="absolute z-10 flex items-center gap-1 rounded-full border border-line bg-card p-1 shadow-sm"
                style={{ left: popover.left, top: popover.top }}
                role="group"
                aria-label="Message actions"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="btn btn-ink rounded-full px-2.5 py-1 text-xs font-semibold"
                  disabled={deliveryBlock(world, queued) === "held" || packet !== null}
                  onClick={() => onDeliver(queued.id)}
                >
                  {packet !== null
                    ? "Sending…"
                    : !world.servers.find((item) => item.id === queued.to)?.online && deliveryBlock(world, queued) !== "held"
                      ? "Deliver (drops)"
                      : "Deliver"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost rounded-full px-2.5 py-1 text-xs font-semibold"
                  disabled={world.queue[world.queue.length - 1]?.id === queued.id}
                  onClick={() => onDelay(queued.id)}
                >
                  Delay
                </button>
                <button type="button" className="btn btn-wine rounded-full px-2.5 py-1 text-xs font-semibold" onClick={() => onDrop(queued.id)}>
                  Drop
                </button>
                {deliveryBlock(world, queued) === "held" ? <span className="px-1 text-[11px] text-gold">Held</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <p className="px-4 pb-3 text-xs text-muted">
        Clay lifelines are side 2, blue are side 3. A broken lifeline is a crash. S scout, C commander, A acceptor, L learner.
      </p>
    </section>
  );
}

function PacketDot({
  world,
  packet,
  xOf,
  yOf,
  nowX,
}: {
  world: World;
  packet: Packet;
  xOf: (time: number) => number;
  yOf: (id: ServerId) => number;
  nowX: number;
}) {
  const arrow = world.diagram.arrows.find((item) => item.messageId === packet.messageId);
  if (!arrow) return null;
  const x1 = xOf(arrow.sendTime);
  const y1 = yOf(arrow.from);
  const x2 = arrow.status === "inflight" ? nowX : endX(arrow, xOf);
  const y2 = yOf(arrow.to);
  const x = x1 + (x2 - x1) * packet.progress;
  const y = y1 + (y2 - y1) * packet.progress;
  const role = messageRole(arrow.type);
  return (
    <g transform={`translate(${x}, ${y})`} pointerEvents="none" aria-hidden="true">
      <circle r="11" fill="#fbf7f0" stroke={roleFill[role.kind]} strokeWidth="2" />
      <circle r="8" fill={roleFill[role.kind]} />
      <text y="3.5" textAnchor="middle" fontSize="9" fontWeight={700} fill="#fbf7f0">
        {role.short.slice(0, 1)}
      </text>
    </g>
  );
}

function ArrowGlyph({
  arrow,
  held,
  selected,
  x1,
  y1,
  x2,
  y2,
  showLabel,
  labelX,
  labelY,
  onSelect,
  onHover,
}: {
  arrow: DiagramArrow;
  held: boolean;
  selected: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  showLabel: boolean;
  labelX: number;
  labelY: number;
  onSelect: () => void;
  onHover: (info: HoverInfo | null) => void;
}) {
  const color = strokeFor[arrow.type];
  const title = `${arrow.label} ${arrow.from} → ${arrow.to}`;
  const dropped = arrow.status === "dropped";
  const inflight = arrow.status === "inflight";
  const role = messageRole(arrow.type);
  const drawLabel = showLabel && Math.hypot(x2 - x1, y2 - y1) > 48;
  const info = { title: `${title} · ${role.caption}`, detail: arrow.detail, messageId: arrow.messageId };
  return (
    <g
      tabIndex={0}
      role="button"
      className={`arrow-hit cursor-pointer${selected ? " is-selected" : ""}`}
      aria-label={
        inflight
          ? `${title}, ${role.caption}, in flight. Activate to select it.`
          : dropped
            ? `${title}, dropped. ${arrow.detail}`
            : `${title}, delivered. ${arrow.detail}`
      }
      aria-pressed={selected}
      onMouseEnter={() => onHover(info)}
      onFocus={() => onHover(info)}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <line className="arrow-focus" x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e2b657" strokeWidth={5} strokeLinecap="round" pointerEvents="none" />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={inflight ? 1.75 : 1.35}
        strokeDasharray={inflight ? (held ? "1 5" : "5 4") : undefined}
        opacity={arrow.status === "delivered" ? 0.85 : 1}
        markerEnd={dropped ? undefined : "url(#arrowhead)"}
        pointerEvents="none"
      />
      {dropped ? (
        <g stroke={color} strokeWidth={1.6} pointerEvents="none">
          <line x1={x2 - 4} y1={y2 - 4} x2={x2 + 4} y2={y2 + 4} />
          <line x1={x2 - 4} y1={y2 + 4} x2={x2 + 4} y2={y2 - 4} />
        </g>
      ) : null}
      {drawLabel ? (
        <text x={labelX} y={labelY} textAnchor="middle" fontSize="11" fill={color} stroke="#fbf7f0" strokeWidth="4" paintOrder="stroke" pointerEvents="none">
          {arrow.label}
        </text>
      ) : null}
    </g>
  );
}

function Mark({ x, y, kind }: { x: number; y: number; kind: string }) {
  if (kind === "crash") {
    return (
      <g stroke="#8d2e2e" strokeWidth="1.6">
        <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
        <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} />
      </g>
    );
  }
  if (kind === "restart") {
    return <circle cx={x} cy={y} r={4} fill="#fbf7f0" stroke="#1c6b45" strokeWidth="1.6" />;
  }
  const fill = kind === "accept" ? "#8a5a12" : kind === "learn" ? "#b34a22" : kind === "promise" ? "#1c6b45" : "#5e574e";
  return <circle cx={x} cy={y} r={3.5} fill={fill} />;
}

function endX(arrow: DiagramArrow, xOf: (time: number) => number): number {
  const at = xOf(arrow.endTime ?? arrow.sendTime);
  if (arrow.status === "dropped" && arrow.endTime === arrow.sendTime) return at + 22;
  return at;
}

function segments(world: World, id: ServerId, clock: number) {
  const cuts = world.diagram.events
    .filter((event) => event.server === id && (event.kind === "crash" || event.kind === "restart" || event.kind === "partition"))
    .slice()
    .sort((a, b) => a.time - b.time);
  let partition = 1;
  let offline = false;
  let cursor = 0;
  const result: { start: number; end: number; partition: number; offline: boolean }[] = [];
  for (const event of cuts) {
    if (event.time > cursor) result.push({ start: cursor, end: event.time, partition, offline });
    if (event.kind === "partition" && event.partition) partition = event.partition;
    if (event.kind === "crash") offline = true;
    if (event.kind === "restart") offline = false;
    cursor = event.time;
  }
  result.push({ start: cursor, end: Math.max(clock, cursor), partition, offline });
  return result;
}

function compactDiagramText(label: string): string {
  return label.replaceAll("Withdraw ", "");
}

function labeledArrows(world: World) {
  const taken: { x: number; y: number; w: number; h: number }[] = [];
  const xOf = (time: number) => 16 + time * PX;
  const yOf = (id: ServerId) => TOP + SERVER_IDS.indexOf(id) * ROW + ROW / 2;
  const nowX = xOf(world.diagram.clock) + NOW_GAP;
  for (const mark of localMarks(world)) {
    const text = compactDiagramText(mark.label);
    const w = 6.2 * text.length + 12;
    taken.push({
      x: xOf(mark.time) + 7 + w / 2,
      y: yOf(mark.server) - 10 - mark.stack * 13,
      w,
      h: 14,
    });
  }
  if (world.diagram.chosenAt) {
    const text = compactDiagramText(world.diagram.chosenAt.label);
    const w = 6.2 * text.length + 12;
    taken.push({ x: xOf(world.diagram.chosenAt.time) + 6 + w / 2, y: 16, w, h: 14 });
  }
  const overlaps = (box: { x: number; y: number; w: number; h: number }) =>
    taken.some((item) => Math.abs(item.x - box.x) < (item.w + box.w) / 2 && Math.abs(item.y - box.y) < (item.h + box.h) / 2);

  return world.diagram.arrows.map((arrow) => {
    const x1 = xOf(arrow.sendTime);
    const y1 = yOf(arrow.from);
    const x2 = arrow.status === "inflight" ? nowX : endX(arrow, xOf);
    const y2 = yOf(arrow.to);
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy) || 1;
    let nx = -dy / length;
    let ny = dx / length;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const labelWidth = Math.min(148, 6.4 * arrow.label.length + 8);
    let placed: { x: number; y: number } | null = null;
    for (const along of [0.78, 0.52, 0.3]) {
      const px = x1 + dx * along + nx * 14;
      const py = y1 + dy * along + ny * 14;
      if (py < 12 || py > TOP + SERVER_IDS.length * ROW) continue;
      const box = { x: px, y: py, w: labelWidth, h: 16 };
      if (!overlaps(box)) {
        taken.push(box);
        placed = { x: box.x, y: box.y };
        break;
      }
    }
    return { ...arrow, showLabel: placed !== null, labelX: placed?.x ?? 0, labelY: placed?.y ?? 0 };
  });
}

function localMarks(world: World) {
  const counts = new Map<string, number>();
  return world.diagram.events
    .filter((event) => event.kind === "promise" || event.kind === "accept" || event.kind === "learn" || event.kind === "crash" || event.kind === "restart")
    .map((event) => {
      const key = `${event.server}:${event.time}`;
      const stack = counts.get(key) ?? 0;
      counts.set(key, stack + 1);
      return { ...event, stack };
    });
}
