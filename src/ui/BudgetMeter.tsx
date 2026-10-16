import { type Centavos, formatBRL } from "../domain/money";
import { type BudgetStatus, budgetState } from "../domain/reporting";

const STATE_STYLE = {
  good: { color: "var(--status-good)", icon: "✓", label: "No limite" },
  warning: { color: "var(--status-warning)", icon: "!", label: "Perto do limite" },
  critical: { color: "var(--status-critical)", icon: "✕", label: "Acima do limite" },
} as const;

/**
 * One budget's progress for the month. The status colour never carries the
 * meaning alone: every meter ships the icon, the state in words, and the
 * spent/limit figures (the relief the light-mode warning step requires).
 */
export function BudgetMeter({ status }: { status: BudgetStatus }) {
  const state = budgetState(status.ratio);
  const { color, icon, label } = STATE_STYLE[state];
  const filled = Math.min(status.ratio, 1) * 100;

  return (
    <li className="py-2.5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm text-slate-800 dark:text-slate-100">
            {status.categoryName}
          </span>
          {status.groupName && (
            <span className="ml-1.5 text-xs text-slate-500">{status.groupName}</span>
          )}
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
          {formatBRL(status.spent)} / {formatBRL(status.limit)}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-valuenow={Math.round(status.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${status.categoryName}: ${label}`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${filled}%`, background: color }}
        />
      </div>

      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1" style={{ color }}>
          <span aria-hidden="true">{icon}</span>
          <span>{label}</span>
        </span>
        <span className="text-slate-500">
          {status.remaining >= 0
            ? `${formatBRL(status.remaining as Centavos)} restante`
            : `${formatBRL(Math.abs(status.remaining) as Centavos)} acima`}
        </span>
      </div>
    </li>
  );
}
