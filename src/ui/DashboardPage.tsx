import { useMemo } from "react";
import { Link } from "react-router-dom";
import { type Centavos, formatBRL } from "../domain/money";
import {
  budgetStatusForMonth,
  type MonthKey,
  monthlyTotals,
  recentMonths,
  spendingByCategoryForMonth,
  uncategorizedSpendForMonth,
} from "../domain/reporting";
import { useVault } from "../store/useVault";
import { BudgetMeter } from "./BudgetMeter";
import { IncomeExpenseChart } from "./charts/IncomeExpenseChart";
import { SpendingByCategoryChart } from "./charts/SpendingByCategoryChart";
import { monthLongLabel } from "./charts/format";
import { StatTile } from "./StatTile";

export function DashboardPage({ month }: { month: MonthKey }) {
  const vault = useVault((s) => s.vault);

  const spending = useMemo(
    () => spendingByCategoryForMonth(vault, month),
    [vault, month],
  );
  const uncategorized = useMemo(
    () => uncategorizedSpendForMonth(vault, month),
    [vault, month],
  );
  const totals = useMemo(
    () => monthlyTotals(vault, recentMonths(month, 6)),
    [vault, month],
  );
  const budgets = useMemo(
    () => budgetStatusForMonth(vault, month).filter((b) => b.limit > 0),
    [vault, month],
  );

  const current = totals[totals.length - 1];

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Receitas do mês"
          value={formatBRL(current.income)}
          tone={current.income > 0 ? "positive" : "default"}
        />
        <StatTile label="Despesas do mês" value={formatBRL(current.expense)} />
        <StatTile
          label="Saldo do mês"
          value={formatBRL(current.net as Centavos)}
          tone={current.net < 0 ? "negative" : "positive"}
          hint={current.net < 0 ? "Gastou mais do que recebeu" : undefined}
        />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <SpendingByCategoryChart
          rows={spending}
          monthName={monthLongLabel(month)}
          uncategorized={uncategorized}
        />
        <IncomeExpenseChart rows={totals} />
      </div>

      <section className="viz-root rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Orçamentos
          </h3>
          <Link
            to="/orcamentos"
            className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
          >
            definir limites
          </Link>
        </div>
        {budgets.length === 0 ? (
          <p className="py-3 text-sm text-slate-500">
            Nenhum limite definido para {monthLongLabel(month)}.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {budgets.map((status) => (
              <BudgetMeter key={status.categoryId} status={status} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
