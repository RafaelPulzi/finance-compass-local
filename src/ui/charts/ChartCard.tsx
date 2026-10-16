import { type ReactNode, useId, useState } from "react";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  /** Legend content, required whenever the chart draws two or more series. */
  legend?: ReactNode;
  /** The chart itself. */
  children: ReactNode;
  /** The table-view twin. Every chart has one: a tooltip must never be the only way to read a value. */
  table: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}

/**
 * Frame shared by every chart: title, optional legend, and a chart/table toggle.
 * The table view is not optional polish — it is the WCAG-clean equivalent of the
 * chart, so values stay reachable without colour or hover.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  children,
  table,
  isEmpty = false,
  emptyMessage = "Sem dados para este mês.",
}: ChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const panelId = useId();

  return (
    <section className="viz-root rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {title}
          </h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>

        <div
          className="flex shrink-0 overflow-hidden rounded-md border border-slate-200 text-xs dark:border-slate-600"
          role="group"
          aria-label={`Visualização de ${title}`}
        >
          {(["chart", "table"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              aria-controls={panelId}
              onClick={() => setView(option)}
              className={`px-2 py-1 ${
                view === option
                  ? "bg-slate-700 text-white dark:bg-slate-600"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
              }`}
            >
              {option === "chart" ? "Gráfico" : "Tabela"}
            </button>
          ))}
        </div>
      </div>

      {legend && view === "chart" && <div className="mb-2">{legend}</div>}

      <div id={panelId}>
        {isEmpty ? (
          <p className="py-6 text-center text-sm text-slate-500">{emptyMessage}</p>
        ) : view === "chart" ? (
          children
        ) : (
          table
        )}
      </div>
    </section>
  );
}

/** Legend swatch + label. Identity is never carried by colour alone. */
export function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
