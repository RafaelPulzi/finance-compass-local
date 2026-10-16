import { type Centavos, formatBRL } from "../../domain/money";

interface TooltipEntry {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
}

export interface VizTooltipProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  /** Already display-ready: both charts key their axis on a formatted label. */
  label?: string | number;
}

/**
 * Shared tooltip. Values wear text tokens, never the series colour; the swatch
 * beside the name is what carries identity.
 */
export function VizTooltip({ active, payload, label }: VizTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-900">
      <div className="mb-1 font-medium text-slate-800 dark:text-slate-100">
        {String(label)}
      </div>
      <ul className="space-y-0.5">
        {payload.map((entry) => (
          <li key={String(entry.name)} className="flex items-center gap-2">
            {entry.color && (
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: entry.color }}
              />
            )}
            <span className="text-slate-600 dark:text-slate-300">
              {String(entry.name ?? "")}
            </span>
            <span className="ml-auto font-mono tabular-nums text-slate-800 dark:text-slate-100">
              {formatBRL(Number(entry.value ?? 0) as Centavos)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
