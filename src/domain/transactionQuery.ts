import { monthKey } from "./balances";
import { type Centavos, centavos } from "./money";
import type { MonthKey } from "./reporting";
import { normalizeForSearch } from "./text";
import type { Id, Transaction, Vault } from "./types";

/**
 * Narrowing the Transaction list down to the ones the user is working on.
 *
 * Pure: it decides what matches, it doesn't render. The page holds a
 * `TransactionFilter` in state and shows whatever `selectTransactions` returns.
 */

/**
 * Which Category a Transaction must have. Three-way because Uncategorized is the
 * *absence* of a Category and not a Category named "uncategorized" (ADR-0005),
 * so "has no Category" can't be expressed as a categoryId.
 */
export type CategoryFilter =
  | { kind: "any" }
  | { kind: "uncategorized" }
  | { kind: "category"; categoryId: Id };

/** Every field is "no opinion" when null (or `any`, or an empty search). Fields combine with AND. */
export interface TransactionFilter {
  accountId: Id | null;
  month: MonthKey | null;
  kind: Transaction["kind"] | null;
  category: CategoryFilter;
  search: string;
}

/** Matches everything: the state the list starts in. */
export const NO_FILTER: TransactionFilter = {
  accountId: null,
  month: null,
  kind: null,
  category: { kind: "any" },
  search: "",
};

export interface TransactionSelection {
  /** The matching Transactions, newest first. */
  transactions: Transaction[];
  count: number;
  /** Totals over the matching set. Transfers are in neither, as everywhere else. */
  income: Centavos;
  expense: Centavos;
}

/**
 * Whether a Transaction involves an Account at all. A Transfer touches two, and
 * filtering by one of them has to show it: it moved money on that Account, so
 * hiding it would make the filtered list fail to explain that Account's balance.
 */
function touchesAccount(tx: Transaction, accountId: Id): boolean {
  return tx.kind === "transfer"
    ? tx.fromAccountId === accountId || tx.toAccountId === accountId
    : tx.accountId === accountId;
}

/**
 * A Transfer carries no Category, so it can satisfy no Category filter other
 * than "any" — it is not Uncategorized either, which is a state only Income and
 * Expense can be in.
 */
function matchesCategory(tx: Transaction, filter: CategoryFilter): boolean {
  if (filter.kind === "any") return true;
  if (tx.kind === "transfer") return false;
  return filter.kind === "uncategorized"
    ? tx.categoryId === null
    : tx.categoryId === filter.categoryId;
}

function matches(tx: Transaction, filter: TransactionFilter, search: string): boolean {
  if (filter.accountId !== null && !touchesAccount(tx, filter.accountId)) return false;
  if (filter.month !== null && monthKey(tx.date) !== filter.month) return false;
  if (filter.kind !== null && tx.kind !== filter.kind) return false;
  if (!matchesCategory(tx, filter.category)) return false;
  if (search !== "" && !normalizeForSearch(tx.description).includes(search)) return false;
  return true;
}

/**
 * The Transactions matching `filter`, newest first, with their count and totals.
 *
 * Dates tie-break by id so the order is stable: two Transactions on the same day
 * must not swap places between renders.
 */
export function selectTransactions(
  vault: Vault,
  filter: TransactionFilter,
): TransactionSelection {
  // Normalise the search term once, not once per Transaction.
  const search = normalizeForSearch(filter.search.trim());

  const transactions: Transaction[] = [];
  let income = 0;
  let expense = 0;
  for (const tx of vault.transactions) {
    if (!matches(tx, filter, search)) continue;
    transactions.push(tx);
    if (tx.kind === "income") income += tx.amount;
    else if (tx.kind === "expense") expense += tx.amount;
  }

  transactions.sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? -1 : 1) : a.date < b.date ? 1 : -1,
  );

  return {
    transactions,
    count: transactions.length,
    income: centavos(income),
    expense: centavos(expense),
  };
}

/**
 * The months the Vault actually has Transactions in, newest first.
 *
 * The month filter is built from this rather than from a fixed window of recent
 * months: a Vault holding two years of imported Statements would otherwise have
 * most of its history unreachable, which is the bug this ticket exists to fix.
 */
export function monthsWithTransactions(vault: Vault): MonthKey[] {
  const months = new Set<MonthKey>();
  for (const tx of vault.transactions) months.add(monthKey(tx.date));
  return [...months].sort().reverse();
}

/**
 * How many Transactions still have no Category — the backlog both the
 * Transactions page's badge and the Rules page's counter describe, counted
 * once so the two can never disagree about how much work is left.
 */
export function uncategorizedCount(vault: Vault): number {
  let count = 0;
  for (const tx of vault.transactions) {
    if (tx.kind !== "transfer" && tx.categoryId === null) count += 1;
  }
  return count;
}
