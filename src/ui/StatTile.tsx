type Tone = "default" | "positive" | "negative" | "warning";

const TONE_CLASS: Record<Tone, string> = {
  default: "text-slate-800 dark:text-slate-100",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
};

/**
 * A single number that needs no plot. Proportional figures, not tabular-nums:
 * equal-width digits make a standalone value look loose at display size.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-semibold ${TONE_CLASS[tone]}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
