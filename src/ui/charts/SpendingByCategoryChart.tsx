import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { type Centavos, formatBRL } from "../../domain/money";
import type { CategorySpend } from "../../domain/reporting";
import { ChartCard } from "./ChartCard";
import { VizTooltip } from "./VizTooltip";

const MAX_BARS = 10;

interface Props {
  rows: CategorySpend[];
  monthName: string;
  /** Expenses with no category yet; shown apart, because they're in no category total. */
  uncategorized: Centavos;
}

/**
 * Ranked spending per Category for one month.
 *
 * One measure across nominal categories, so every bar is the same hue (slot 1):
 * colouring bars darker-where-bigger would double-encode the length. Identity
 * comes from the axis labels, so no legend is needed.
 */
export function SpendingByCategoryChart({ rows, monthName, uncategorized }: Props) {
  // Keep the plot readable; the table view always shows every row.
  const shown = rows.slice(0, MAX_BARS);
  const rest = rows.slice(MAX_BARS);
  const data = [...shown];
  if (rest.length > 0) {
    data.push({
      categoryId: "__other__",
      categoryName: `Outras (${rest.length})`,
      groupName: "",
      spent: rest.reduce((sum, r) => sum + r.spent, 0) as Centavos,
    });
  }

  const total = rows.reduce((sum, r) => sum + r.spent, 0);

  return (
    <ChartCard
      title="Gastos por categoria"
      subtitle={monthName}
      isEmpty={rows.length === 0 && uncategorized === 0}
      table={
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
              <th className="py-1 font-medium">Categoria</th>
              <th className="py-1 font-medium">Grupo</th>
              <th className="py-1 text-right font-medium">Gasto</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.categoryId} className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-1 text-slate-700 dark:text-slate-200">{row.categoryName}</td>
                <td className="py-1 text-slate-500">{row.groupName}</td>
                <td className="py-1 text-right font-mono tabular-nums text-slate-800 dark:text-slate-100">
                  {formatBRL(row.spent)}
                </td>
              </tr>
            ))}
            {uncategorized > 0 && (
              <tr className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-1 text-amber-700 dark:text-amber-400">Sem categoria</td>
                <td className="py-1 text-slate-500">—</td>
                <td className="py-1 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                  {formatBRL(uncategorized)}
                </td>
              </tr>
            )}
            <tr>
              <td className="py-1 font-medium text-slate-700 dark:text-slate-200">Total</td>
              <td />
              <td className="py-1 text-right font-mono font-medium tabular-nums text-slate-800 dark:text-slate-100">
                {formatBRL((total + uncategorized) as Centavos)}
              </td>
            </tr>
          </tbody>
        </table>
      }
    >
      <ResponsiveContainer width="100%" height={Math.max(140, data.length * 34 + 16)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
          barCategoryGap={6}
        >
          {/* Solid hairline grid, one shade off the surface. Never dashed. */}
          <CartesianGrid
            horizontal={false}
            stroke="var(--viz-grid)"
            strokeDasharray="none"
          />
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="categoryName"
            width={118}
            tickLine={false}
            axisLine={{ stroke: "var(--viz-axis)" }}
            tick={{ fill: "var(--viz-muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "var(--viz-grid)", fillOpacity: 0.4 }}
            content={({ active, payload, label }) => (
              <VizTooltip active={active} payload={payload} label={label} />
            )}
          />
          <Bar
            dataKey="spent"
            name="Gasto"
            fill="var(--series-1)"
            radius={[0, 4, 4, 0]}
            maxBarSize={18}
            isAnimationActive={false}
          >
            {data.map((row) => (
              <Cell key={row.categoryId} />
            ))}
            {/* The numeric axis is hidden, so the end label is the value channel. */}
            <LabelList
              dataKey="spent"
              position="right"
              offset={8}
              formatter={(value) => formatBRL(Number(value) as Centavos)}
              style={{ fill: "var(--viz-text-secondary)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {uncategorized > 0 && (
        <p className="mt-2 border-t border-slate-100 pt-2 text-xs text-amber-700 dark:border-slate-700 dark:text-amber-400">
          + {formatBRL(uncategorized)} sem categoria (fora de todos os totais por categoria)
        </p>
      )}
    </ChartCard>
  );
}
