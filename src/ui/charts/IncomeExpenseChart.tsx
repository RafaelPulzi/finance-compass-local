import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type Centavos, formatBRL } from "../../domain/money";
import type { MonthTotals } from "../../domain/reporting";
import { ChartCard, LegendItem } from "./ChartCard";
import { VizTooltip } from "./VizTooltip";
import { compactBRL, monthLabel } from "./format";

interface Props {
  rows: MonthTotals[];
}

/**
 * Income against expense per month. Two series of the same unit on one axis —
 * never a second y-scale. They are identity, not status, so they take
 * categorical slots 1 and 2 rather than good/bad status colours.
 */
export function IncomeExpenseChart({ rows }: Props) {
  const data = rows.map((row) => ({
    month: row.month,
    label: monthLabel(row.month),
    Receitas: row.income,
    Despesas: row.expense,
    net: row.net,
  }));

  const hasData = rows.some((r) => r.income > 0 || r.expense > 0);

  return (
    <ChartCard
      title="Receitas × Despesas"
      subtitle="Últimos 6 meses"
      isEmpty={!hasData}
      emptyMessage="Sem lançamentos nos últimos 6 meses."
      legend={
        <div className="flex gap-4">
          <LegendItem color="var(--series-1)" label="Receitas" />
          <LegendItem color="var(--series-2)" label="Despesas" />
        </div>
      }
      table={
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
              <th className="py-1 font-medium">Mês</th>
              <th className="py-1 text-right font-medium">Receitas</th>
              <th className="py-1 text-right font-medium">Despesas</th>
              <th className="py-1 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-1 text-slate-700 dark:text-slate-200">
                  {monthLabel(row.month)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                  {formatBRL(row.income)}
                </td>
                <td className="py-1 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                  {formatBRL(row.expense)}
                </td>
                <td
                  className={`py-1 text-right font-mono tabular-nums ${
                    row.net < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-800 dark:text-slate-100"
                  }`}
                >
                  {formatBRL(row.net as Centavos)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 4, left: 4 }}
          barGap={2}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="none" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--viz-axis)" }}
            tick={{ fill: "var(--viz-muted)", fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v: number) => compactBRL(v)}
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{ fill: "var(--viz-muted)", fontSize: 11 }}
          />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", fillOpacity: 0.4 }}
            content={({ active, payload, label }) => (
              <VizTooltip active={active} payload={payload} label={label} />
            )}
          />
          <Bar
            dataKey="Receitas"
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          />
          <Bar
            dataKey="Despesas"
            fill="var(--series-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={22}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
