import { monthKey, spentInCategoryForMonth } from "./balances";
import { type Centavos, centavos } from "./money";
import type { Id, ISODate, Vault } from "./types";

/** "YYYY-MM" for a month, e.g. the month an ISO date falls in. */
export type MonthKey = string;

export function monthOf(date: ISODate): MonthKey {
  return monthKey(date);
}

/** The `count` months ending at (and including) `upTo`, oldest first. */
export function recentMonths(upTo: MonthKey, count: number): MonthKey[] {
  const [year, month] = upTo.split("-").map(Number);
  const months: MonthKey[] = [];
  for (let back = count - 1; back >= 0; back--) {
    // Date handles the year rollover; month is 0-indexed here.
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${d.getUTCFullYear()}-${m}`);
  }
  return months;
}

/**
 * The months a month picker should offer, newest first: the last twelve up to
 * `current`, plus every month the Vault actually has Transactions in.
 *
 * The twelve alone made older history unreachable on the dashboard — a Vault
 * holding two years of imported Statements could only show its last year,
 * which is the same bug the Transactions page had before it listed every
 * month (#11). Months with data in the future (a post-dated entry) are kept too.
 */
export function monthChoices(vault: Vault, current: MonthKey): MonthKey[] {
  const months = new Set(recentMonths(current, 12));
  for (const tx of vault.transactions) months.add(monthKey(tx.date));
  return [...months].sort().reverse();
}

export interface CategorySpend {
  categoryId: Id;
  categoryName: string;
  groupName: string;
  spent: Centavos;
}

/** Expense Categories with spending in a month, biggest first. Uncategorized is not here (ADR-0005). */
export function spendingByCategoryForMonth(
  vault: Vault,
  month: MonthKey,
): CategorySpend[] {
  const groupName = new Map(vault.groups.map((g) => [g.id, g.name]));
  const expenseGroups = new Set(
    vault.groups.filter((g) => g.kind === "expense").map((g) => g.id),
  );

  const rows: CategorySpend[] = [];
  for (const category of vault.categories) {
    if (!expenseGroups.has(category.groupId)) continue;
    const spent = spentInCategoryForMonth(vault.transactions, category.id, month);
    if (spent === 0) continue;
    rows.push({
      categoryId: category.id,
      categoryName: category.name,
      groupName: groupName.get(category.groupId) ?? "",
      spent,
    });
  }
  return rows.sort((a, b) => b.spent - a.spent);
}

/**
 * Expenses in a month that have no Category yet. Surfaced on its own because
 * uncategorized money is deliberately absent from every Category total (ADR-0005),
 * and silently missing money is worse than money labelled "unclassified".
 */
export function uncategorizedSpendForMonth(vault: Vault, month: MonthKey): Centavos {
  let total = 0;
  for (const tx of vault.transactions) {
    if (tx.kind === "expense" && tx.categoryId === null && monthKey(tx.date) === month) {
      total += tx.amount;
    }
  }
  return centavos(total);
}

export interface BudgetStatus {
  categoryId: Id;
  categoryName: string;
  groupName: string;
  limit: Centavos;
  spent: Centavos;
  /** Positive = still available this month; negative = over the limit. */
  remaining: number;
  /** spent / limit. 1 means exactly at the limit; above 1 is over. */
  ratio: number;
}

/** Every Budget with its actual spending for the month. No rollover: each month stands alone. */
export function budgetStatusForMonth(vault: Vault, month: MonthKey): BudgetStatus[] {
  const category = new Map(vault.categories.map((c) => [c.id, c]));
  const groupName = new Map(vault.groups.map((g) => [g.id, g.name]));

  const rows: BudgetStatus[] = [];
  for (const budget of vault.budgets) {
    const cat = category.get(budget.categoryId);
    if (!cat) continue; // budget for a category that no longer exists
    const spent = spentInCategoryForMonth(vault.transactions, budget.categoryId, month);
    rows.push({
      categoryId: budget.categoryId,
      categoryName: cat.name,
      groupName: groupName.get(cat.groupId) ?? "",
      limit: budget.monthlyLimit,
      spent,
      remaining: budget.monthlyLimit - spent,
      ratio: budget.monthlyLimit === 0 ? 0 : spent / budget.monthlyLimit,
    });
  }
  return rows.sort((a, b) => b.ratio - a.ratio);
}

/** How a Budget is doing: at/below plan, close to the limit, or over it. */
export type BudgetState = "good" | "warning" | "critical";

/** Over the limit is critical; the last fifth of the limit is a warning. */
export function budgetState(ratio: number): BudgetState {
  if (ratio > 1) return "critical";
  if (ratio >= 0.8) return "warning";
  return "good";
}

export interface MonthTotals {
  month: MonthKey;
  income: Centavos;
  expense: Centavos;
  /** income - expense for the month. */
  net: number;
}

/** Income and expense totals per month. Transfers are excluded by kind, as they must be. */
export function monthlyTotals(vault: Vault, months: readonly MonthKey[]): MonthTotals[] {
  const income = new Map<MonthKey, number>();
  const expense = new Map<MonthKey, number>();
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer") continue;
    const m = monthKey(tx.date);
    const bucket = tx.kind === "income" ? income : expense;
    bucket.set(m, (bucket.get(m) ?? 0) + tx.amount);
  }
  return months.map((month) => {
    const i = income.get(month) ?? 0;
    const e = expense.get(month) ?? 0;
    return { month, income: centavos(i), expense: centavos(e), net: i - e };
  });
}
