import { useMemo, useState } from "react";
import { ZERO, formatBRLInput, parseBRL } from "../domain/money";
import { budgetStatusForMonth, type MonthKey } from "../domain/reporting";
import { useVault } from "../store/useVault";
import { BudgetMeter } from "./BudgetMeter";
import { monthLongLabel } from "./charts/format";

export function BudgetsPanel({ month }: { month: MonthKey }) {
  const vault = useVault((s) => s.vault);
  const setBudget = useVault((s) => s.setBudget);

  // A limit of 0 means "not budgeted" (see the hint below), so it is no meter.
  // Filtering before the empty check is what makes "nothing defined" show when
  // every limit has been cleared back to 0, instead of an empty list.
  const statuses = useMemo(
    () => budgetStatusForMonth(vault, month).filter((s) => s.limit > 0),
    [vault, month],
  );

  /** Expense categories are the only things a Budget can apply to. */
  const expenseCategories = useMemo(() => {
    const expenseGroups = new Map(
      vault.groups.filter((g) => g.kind === "expense").map((g) => [g.id, g.name]),
    );
    return vault.categories
      .filter((c) => expenseGroups.has(c.groupId))
      .map((c) => ({ ...c, groupName: expenseGroups.get(c.groupId) ?? "" }));
  }, [vault.groups, vault.categories]);

  const limitByCategory = useMemo(
    () => new Map(vault.budgets.map((b) => [b.categoryId, b.monthlyLimit])),
    [vault.budgets],
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  function commit(categoryId: string) {
    const draft = drafts[categoryId];
    if (draft === undefined) return;
    try {
      const monthlyLimit = draft.trim() === "" ? parseBRL("0") : parseBRL(draft);
      if (monthlyLimit < 0) throw new Error();
      const result = setBudget({ categoryId, monthlyLimit });
      setError(result.ok ? null : result.message);
    } catch {
      setError("Valor inválido. Use o formato 800,00.");
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[categoryId];
      return next;
    });
  }

  return (
    <div className="viz-root grid gap-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          Orçamentos
        </h2>
        <p className="mb-2 text-xs text-slate-500">
          {monthLongLabel(month)} · limites mensais, sem acúmulo de um mês para o outro
        </p>

        {statuses.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">
            Nenhum limite definido ainda. Defina um abaixo.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {statuses.map((status) => (
              <BudgetMeter key={status.categoryId} status={status} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
        <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-100">
          Definir limites
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Um limite mensal por categoria de despesa. Deixe 0 para não orçar.
        </p>

        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {expenseCategories.map((category) => {
            const stored = limitByCategory.get(category.id) ?? ZERO;
            const value =
              drafts[category.id] ??
              (stored > 0 ? formatBRLInput(stored) : "");
            return (
              <li key={category.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-800 dark:text-slate-100">
                    {category.name}
                  </div>
                  <div className="text-xs text-slate-500">{category.groupName}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-xs text-slate-500">R$</span>
                  <input
                    className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right font-mono text-sm tabular-nums dark:border-slate-600 dark:bg-slate-900"
                    placeholder="0,00"
                    value={value}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [category.id]: e.target.value }))
                    }
                    onBlur={() => commit(category.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
