import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { card, pill } from "@/components/ui";
import { formatNumber } from "@/lib/report/text";

/** Full numbers up to 99,999, then 235.4K / 1.2M. */
export function compact(value: number) {
  if (Math.abs(value) < 100_000) return formatNumber(value);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Signed change pill. Colour follows direction, and an arrow and sign always say it too. */
export function Delta({ value, context = "vs previous week" }: { value: number | null; context?: string }) {
  if (value === null) return null;
  const percent = Math.round(value * 100);
  const text =
    value >= 9 ? `${Math.round(1 + value)}x` : `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent)}%`;
  const direction = percent > 0 ? "Up" : percent < 0 ? "Down" : "No change";

  const style = percent > 0 ? "bg-good-bg text-good" : percent < 0 ? "bg-bad-bg text-bad" : "bg-zinc-100 text-zinc-600";
  const Icon = percent > 0 ? ArrowUpRight : percent < 0 ? ArrowDownRight : Minus;

  return (
    <span className={`${pill} ${style}`} title={`${direction} ${text} ${context}`}>
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      <span className="sr-only">{direction} </span>
      {text}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  footnote,
}: {
  label: string;
  value: number;
  delta?: number | null;
  footnote?: string;
}) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-[13px] font-medium text-zinc-500">{label}</p>
      <p
        className="mt-2 text-[28px] font-semibold leading-none tracking-tight text-zinc-950"
        title={formatNumber(value)}
      >
        {compact(value)}
      </p>
      <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        {delta !== undefined && delta !== null ? (
          <>
            <Delta value={delta} />
            <span>vs prev. week</span>
          </>
        ) : null}
        {footnote ? <span>{footnote}</span> : null}
      </div>
    </div>
  );
}
