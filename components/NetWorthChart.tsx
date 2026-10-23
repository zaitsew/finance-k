import { formatEur } from "../src/core/money";
import { monthLabel } from "../src/core/months";

export interface SeriesPoint {
  month: string;
  net_worth_eur_minor: number | null;
}

const W = 960;
const H = 220;
const PAD = { l: 28, r: 28, t: 14, b: 26 };

/** A 12-month net-worth line as inline SVG. Months with no close leave a gap in the line. */
export function NetWorthChart({ series, current }: { series: SeriesPoint[]; current: string }) {
  const values = series.map((p) => p.net_worth_eur_minor).filter((v): v is number => v !== null);
  if (values.length < 1) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 1) * 0.1;
  const lo = min - span * 0.12;
  const hi = max + span * 0.12;
  const x = (i: number): number => PAD.l + (i * (W - PAD.l - PAD.r)) / Math.max(series.length - 1, 1);
  const y = (v: number): number => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo);

  const segments: string[] = [];
  let run: string[] = [];
  series.forEach((p, i) => {
    if (p.net_worth_eur_minor === null) {
      if (run.length) segments.push(run.join(" "));
      run = [];
    } else {
      run.push(`${run.length ? "L" : "M"}${x(i).toFixed(1)} ${y(p.net_worth_eur_minor).toFixed(1)}`);
    }
  });
  if (run.length) segments.push(run.join(" "));

  const short = (m: string): string => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const summary = series
    .filter((p) => p.net_worth_eur_minor !== null)
    .map((p) => `${monthLabel(p.month)}: ${formatEur(p.net_worth_eur_minor!)}`)
    .join("; ");

  return (
    <figure>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Net worth over the last 12 months. ${summary}`}>
        {[0, 0.5, 1].map((t) => (
          <line key={t} className="grid" x1={0} x2={W} y1={PAD.t + t * (H - PAD.t - PAD.b)} y2={PAD.t + t * (H - PAD.t - PAD.b)} />
        ))}
        {segments.map((d, i) => (
          <path key={i} className="line" d={d} />
        ))}
        {series.map((p, i) =>
          p.net_worth_eur_minor === null ? null : (
            <circle key={p.month} className={p.month === current ? "dot dot-now" : "dot"} cx={x(i)} cy={y(p.net_worth_eur_minor)} r={p.month === current ? 4.5 : 3.5}>
              <title>{`${monthLabel(p.month)}: ${formatEur(p.net_worth_eur_minor)}`}</title>
            </circle>
          ),
        )}
        {series.map((p, i) => (
          <text key={p.month} className="tick" x={x(i)} y={H - 6} textAnchor="middle">
            {short(p.month)}
          </text>
        ))}
      </svg>
    </figure>
  );
}
