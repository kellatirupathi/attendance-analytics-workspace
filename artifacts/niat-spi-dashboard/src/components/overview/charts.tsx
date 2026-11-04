import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Overview charts, plain SVG/HTML. Marks are thin (bars at most 24px, 2px lines, 8px+ dots with a surface ring), the grid is
 * a hairline, text wears text colours and the data colour sits on the mark. Every chart has a tooltip on hover and keyboard focus.
 */
const ACCENT = "#6D4AE0";
const INK = "#0B1F4D";
const MUTED = "#64708F";
const GRID = "#ECEEF7";

export interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** One tooltip layer per page: `props(content)` goes on a mark, `layer` is rendered once. */
export function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const props = (content: ReactNode) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, content }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const r = (e.currentTarget as Element).getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, content });
    },
    onBlur: () => setTip(null),
  });
  const layer = tip ? (
    <div role="tooltip" className="pointer-events-none fixed z-50 max-w-[16rem] rounded-lg bg-[#0B1F4D] px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg" style={{ left: Math.min(tip.x + 14, window.innerWidth - 260), top: Math.max(8, tip.y - 52) }}>
      {tip.content}
    </div>
  ) : null;
  return { props, layer };
}
export type TipProps = ReturnType<typeof useTip>["props"];

/* ---------------- donut ---------------- */
export interface DonutItem {
  key: string;
  label: string;
  hint: string;
  count: number;
  color: string;
}

export function Donut({ items, total, onSelect }: { items: DonutItem[]; total: number; onSelect?: (key: string) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const R = 54;
  const C = 2 * Math.PI * R;
  const GAP = 2;
  let offset = 0;
  const hit = items.find((i) => i.key === active);
  const pctOf = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const arcs = items.map((i) => {
    const len = total ? (i.count / total) * C : 0;
    const dash = Math.max(0, len - GAP);
    const node = len > 0 && (
      <circle
        key={i.key}
        cx={75}
        cy={75}
        r={R}
        fill="none"
        stroke={i.color}
        strokeWidth={active === i.key ? 18 : 16}
        strokeDasharray={`${dash} ${C - dash}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 75 75)"
        tabIndex={0}
        role="img"
        aria-label={`${i.label}: ${i.count}`}
        style={{ cursor: onSelect ? "pointer" : "default", transition: "stroke-width .15s" }}
        onMouseEnter={() => setActive(i.key)}
        onMouseLeave={() => setActive(null)}
        onFocus={() => setActive(i.key)}
        onBlur={() => setActive(null)}
        onClick={() => onSelect?.(i.key)}
      />
    );
    offset += len;
    return node;
  });
  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg viewBox="0 0 150 150" className="h-[150px] w-[150px] flex-none" role="group" aria-label="Attendance distribution">
        <circle cx={75} cy={75} r={R} fill="none" stroke="#F0F2FA" strokeWidth={16} />
        {arcs}
        <text x={75} y={72} textAnchor="middle" fontSize={22} fontWeight={700} fill={INK}>{(hit ? hit.count : total).toLocaleString("en-IN")}</text>
        <text x={75} y={90} textAnchor="middle" fontSize={11} fill={MUTED}>{hit ? `${hit.label} · ${pctOf(hit.count)}%` : "students"}</text>
      </svg>
      <ul className="flex min-w-[10rem] flex-1 flex-col gap-1">
        {items.map((i) => (
          <li key={i.key}>
            <button
              type="button"
              onMouseEnter={() => setActive(i.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i.key)}
              onBlur={() => setActive(null)}
              onClick={() => onSelect?.(i.key)}
              className={cn("flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600", active === i.key ? "bg-slate-100" : "hover:bg-slate-50")}
            >
              <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: i.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 leading-tight text-slate-800">
                {i.label}
                <span className="block text-[11px] text-slate-500">{i.hint}</span>
              </span>
              <span className="font-bold tabular-nums text-slate-900">{i.count.toLocaleString("en-IN")}</span>
              <span className="w-10 text-right tabular-nums text-slate-500">{pctOf(i.count)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- vertical bars ---------------- */
export interface BarItem {
  label: string;
  value: number | null;
  /** Text above the bar when it differs from the rounded value. */
  shown?: string;
  tip: ReactNode;
}

export function VBars({ items, max, tip, onSelect, label }: { items: BarItem[]; max: number; tip: TipProps; onSelect?: (index: number) => void; label: string }) {
  const W = 340;
  const H = 190;
  const L = 34;
  const R = 8;
  const T = 22;
  const B = 34;
  const iw = W - L - R;
  const ih = H - T - B;
  const band = iw / Math.max(1, items.length);
  const bw = Math.min(24, band * 0.5);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="group" aria-label={label}>
      {ticks.map((t) => {
        const y = T + ih - (t / max) * ih;
        return (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={L - 6} y={y + 3.5} textAnchor="end" fontSize={10.5} fill={MUTED}>{Number.isInteger(t) ? t : t.toFixed(1)}</text>
          </g>
        );
      })}
      {items.map((it, i) => {
        const bh = Math.max(2, ((it.value ?? 0) / max) * ih);
        const x = L + band * i + (band - bw) / 2;
        const y = T + ih - bh;
        const r = Math.min(4, bh);
        const d = `M${x},${T + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${T + ih} Z`;
        return (
          <g key={it.label}>
            <path d={d} fill={ACCENT} tabIndex={0} role="img" aria-label={`${it.label}: ${it.shown ?? it.value ?? "none"}`} style={{ cursor: onSelect ? "pointer" : "default" }} onClick={() => onSelect?.(i)} {...tip(it.tip)} />
            <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>{it.value == null ? "–" : it.shown ?? Math.round(it.value)}</text>
            <text x={x + bw / 2} y={H - 14} textAnchor="middle" fontSize={10.5} fill={MUTED}>{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------------- line ---------------- */
export interface LinePoint {
  label: string;
  value: number;
  tip: ReactNode;
}

export function Trend({ points, tip, label, format }: { points: LinePoint[]; tip: TipProps; label: string; format: (v: number) => string }) {
  const [cross, setCross] = useState<number | null>(null);
  const W = 440;
  const H = 200;
  const L = 38;
  const R = 18;
  const T = 16;
  const B = 30;
  const iw = W - L - R;
  const ih = H - T - B;
  const vals = points.map((p) => p.value);
  // Whole-number ticks: 5 apart for a narrow range, 10 apart for a wide one.
  const spread = Math.max(...vals) - Math.min(...vals) + 4;
  const tickStep = spread <= 20 ? 5 : 10;
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 2) / tickStep) * tickStep);
  const hi = Math.max(lo + tickStep, Math.min(100, Math.ceil((Math.max(...vals) + 2) / tickStep) * tickStep));
  const x = (i: number) => (points.length === 1 ? L + iw / 2 : L + (iw * i) / (points.length - 1));
  const y = (v: number) => T + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const ticks = Array.from({ length: Math.round((hi - lo) / tickStep) + 1 }, (_, i) => lo + i * tickStep);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${path} L${x(points.length - 1)},${T + ih} L${x(0)},${T + ih} Z`;
  const step = iw / Math.max(1, points.length - 1);
  const skip = Math.ceil(points.length / 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }} role="group" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={L - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill={MUTED}>{Math.round(t)}</text>
        </g>
      ))}
      <path d={area} fill={ACCENT} opacity={0.1} />
      <path d={path} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {cross != null && <line x1={x(cross)} x2={x(cross)} y1={T} y2={T + ih} stroke="#CFC6F5" strokeWidth={1} />}
      {points.map((p, i) => (
        <g key={p.label + i}>
          <circle cx={x(i)} cy={y(p.value)} r={6.5} fill="#fff" />
          <circle cx={x(i)} cy={y(p.value)} r={4.5} fill={ACCENT} />
          {i % skip === 0 && <text x={x(i)} y={H - 10} textAnchor="middle" fontSize={10.5} fill={MUTED}>{p.label}</text>}
        </g>
      ))}
      {points.map((p, i) => (
        <rect
          key={`h${i}`}
          x={x(i) - step / 2}
          y={T}
          width={step}
          height={ih}
          fill="transparent"
          tabIndex={0}
          role="img"
          aria-label={`${p.label}: ${format(p.value)}`}
          {...tip(p.tip)}
          onMouseEnter={() => setCross(i)}
          onMouseLeave={() => setCross(null)}
          onFocus={(e) => {
            setCross(i);
            tip(p.tip).onFocus(e);
          }}
          onBlur={() => setCross(null)}
        />
      ))}
    </svg>
  );
}

/* ---------------- horizontal bars ---------------- */
export interface HBarRow {
  name: string;
  value: number | null;
  display: string;
  tip: ReactNode;
}

export function HBars({ rows, max, tip, onSelect }: { rows: HBarRow[]; max: number; tip: TipProps; onSelect?: (index: number) => void }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-slate-500">No data for these filters</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li key={r.name}>
          <button
            type="button"
            onClick={() => onSelect?.(i)}
            {...tip(r.tip)}
            className="grid w-full grid-cols-[minmax(90px,44%)_1fr_3.2rem] items-center gap-2.5 rounded py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
          >
            <span className="truncate text-sm font-medium text-slate-800" title={r.name}>{r.name}</span>
            <span className="h-2.5 rounded-r-[5px] bg-slate-100" aria-hidden="true">
              <span className="block h-full min-w-[2px] rounded-r-[4px]" style={{ width: `${Math.max(0, Math.min(100, ((r.value ?? 0) / max) * 100))}%`, background: ACCENT }} />
            </span>
            <span className="text-right text-sm font-bold tabular-nums text-slate-900">{r.display}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
