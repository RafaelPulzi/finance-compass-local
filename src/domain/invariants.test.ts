import { describe, expect, it } from "vitest";
import { deriveAccountBalance, deriveNetWorth, spentInCategoryForMonth } from "./balances";
import { categoryKind } from "./categories";
import { type Centavos, centavos, formatBRLInput, parseBRL } from "./money";
import type { OfxEntry } from "./ofx";
import {
  budgetStatusForMonth,
  monthlyTotals,
  spendingByCategoryForMonth,
  uncategorizedSpendForMonth,
} from "./reporting";
import { planImport } from "./statementImport";
import { editedTransaction } from "./transactionEdit";
import { NO_FILTER, monthsWithTransactions, selectTransactions } from "./transactionQuery";
import { TRANSFER_WINDOW_DAYS, findTransferCandidates } from "./transferDetection";
import { entryFromTransfer, transferFromEntry } from "./transferRecovery";
import type { Account, Category, Group, Transaction, Vault } from "./types";
import { emptyVault } from "./types";

/**
 * Invariants that must hold for *any* Vault, checked against many randomly
 * generated ones. The example-based suites pin specific behaviour; these pin
 * the accounting itself — that money is neither created nor lost by any view.
 *
 * The generator is seeded, so a failure names a seed that reproduces it.
 */

/** mulberry32: a tiny, well-distributed, seedable PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T,>(items: readonly T[]): T => items[int(0, items.length - 1)];
  return { next, int, pick };
}

const DAY = 86_400_000;
const START = Date.UTC(2025, 0, 1);

function randomVault(seed: number): Vault {
  const r = rng(seed);
  const accounts: Account[] = Array.from({ length: r.int(2, 4) }, (_, i) => ({
    id: `acc-${i}`,
    name: `Conta ${i}`,
    type: r.pick(["checking", "savings", "cash", "credit-card"] as const),
    openingBalance: centavos(r.int(-200_000, 1_000_000)),
  }));
  const groups: Group[] = [
    { id: "g-e1", name: "Casa", kind: "expense" },
    { id: "g-e2", name: "Rua", kind: "expense" },
    { id: "g-i1", name: "Renda", kind: "income" },
  ];
  const categories: Category[] = [
    { id: "c-e1", name: "Mercado", groupId: "g-e1" },
    { id: "c-e2", name: "Aluguel", groupId: "g-e1" },
    { id: "c-e3", name: "Uber", groupId: "g-e2" },
    { id: "c-i1", name: "Salário", groupId: "g-i1" },
    { id: "c-i2", name: "Extra", groupId: "g-i1" },
  ];
  const byKind = {
    expense: categories.filter((c) => c.groupId.startsWith("g-e")).map((c) => c.id),
    income: categories.filter((c) => c.groupId.startsWith("g-i")).map((c) => c.id),
  };

  const transactions: Transaction[] = [];
  const count = r.int(20, 250);
  for (let i = 0; i < count; i++) {
    const date = new Date(START + r.int(0, 729) * DAY).toISOString().slice(0, 10);
    // A small amount pool makes equal amounts — and so Transfer candidates — common.
    const amount = centavos(r.next() < 0.3 ? r.pick([1000, 2500, 25001, 50000]) : r.int(1, 500_000));
    const roll = r.next();
    if (roll < 0.15) {
      const from = r.pick(accounts).id;
      const to = r.pick(accounts.filter((a) => a.id !== from)).id;
      transactions.push({
        id: `t-${i}`,
        kind: "transfer",
        date,
        amount,
        description: `transf ${i}`,
        fromAccountId: from,
        toAccountId: to,
        // Some Transfers were recovered from an imported entry on their source.
        ...(r.next() < 0.5 ? { recoveredFrom: [{ fitid: `F-${i}`, accountId: from }] } : {}),
      });
    } else {
      const kind = roll < 0.6 ? ("expense" as const) : ("income" as const);
      transactions.push({
        id: `t-${i}`,
        kind,
        date,
        amount,
        description: `${kind} ${i}`,
        accountId: r.pick(accounts).id,
        categoryId: r.next() < 0.4 ? null : r.pick(byKind[kind]),
        ...(r.next() < 0.7 ? { fitid: `F-${i}` } : {}),
      });
    }
  }

  return {
    ...emptyVault(),
    accounts,
    groups,
    categories,
    transactions,
    budgets: byKind.expense
      .filter(() => r.next() < 0.6)
      .map((categoryId, i) => ({ id: `b-${i}`, categoryId, monthlyLimit: centavos(r.int(0, 300_000)) })),
  };
}

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);

function sum(values: Iterable<number>): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

describe.each(SEEDS)("a random Vault (seed %i)", (seed) => {
  const vault = randomVault(seed);
  const incomes = vault.transactions.filter((t) => t.kind === "income");
  const expenses = vault.transactions.filter((t) => t.kind === "expense");

  it("net worth is opening balances plus income minus expense — Transfers create no money", () => {
    const expected =
      sum(vault.accounts.map((a) => a.openingBalance)) +
      sum(incomes.map((t) => t.amount)) -
      sum(expenses.map((t) => t.amount));
    expect(deriveNetWorth(vault)).toBe(expected);
  });

  it("the unfiltered list holds everything and totals what the months total", () => {
    const all = selectTransactions(vault, NO_FILTER);
    expect(all.count).toBe(vault.transactions.length);
    const months = monthsWithTransactions(vault);
    const totals = monthlyTotals(vault, months);
    expect(all.income).toBe(sum(totals.map((m) => m.income)));
    expect(all.expense).toBe(sum(totals.map((m) => m.expense)));
  });

  it("the list is newest first and never shows a Transaction twice", () => {
    const { transactions } = selectTransactions(vault, NO_FILTER);
    for (let i = 1; i < transactions.length; i++) {
      expect(transactions[i - 1].date >= transactions[i].date).toBe(true);
    }
    expect(new Set(transactions.map((t) => t.id)).size).toBe(transactions.length);
  });

  it("filtering by kind partitions the list", () => {
    const parts = (["income", "expense", "transfer"] as const).map(
      (kind) => selectTransactions(vault, { ...NO_FILTER, kind }).count,
    );
    expect(sum(parts)).toBe(vault.transactions.length);
  });

  it("filtering by Category partitions Income and Expense; Transfers are in no Category", () => {
    const uncategorized = selectTransactions(vault, { ...NO_FILTER, category: { kind: "uncategorized" } }).count;
    const categorized = sum(
      vault.categories.map(
        (c) => selectTransactions(vault, { ...NO_FILTER, category: { kind: "category", categoryId: c.id } }).count,
      ),
    );
    expect(uncategorized + categorized).toBe(incomes.length + expenses.length);
  });

  it("each month's Category spending plus its Uncategorized spending is its whole expense", () => {
    for (const month of monthsWithTransactions(vault)) {
      const byCategory = sum(spendingByCategoryForMonth(vault, month).map((r) => r.spent));
      const loose = uncategorizedSpendForMonth(vault, month);
      const [totals] = monthlyTotals(vault, [month]);
      expect(byCategory + loose, month).toBe(totals.expense);
    }
  });

  it("a Budget's figures agree with the Category's spending", () => {
    for (const month of monthsWithTransactions(vault).slice(0, 6)) {
      for (const status of budgetStatusForMonth(vault, month)) {
        expect(status.spent).toBe(spentInCategoryForMonth(vault.transactions, status.categoryId, month));
        expect(status.remaining).toBe(status.limit - status.spent);
      }
    }
  });

  it("an empty edit changes nothing at all", () => {
    for (const tx of vault.transactions) {
      const outcome = editedTransaction(vault, tx.id, {});
      if (!outcome.ok) throw new Error(`${tx.id}: ${outcome.message}`);
      expect(outcome.transaction).toEqual(tx);
    }
  });

  it("marking an imported entry and undoing it restores it, fitid included, and only moves the other Account", () => {
    const imported = vault.transactions.filter(
      (t): t is Extract<Transaction, { kind: "income" | "expense" }> =>
        t.kind !== "transfer" && t.fitid !== undefined,
    );
    for (const entry of imported.slice(0, 15)) {
      const other = vault.accounts.find((a) => a.id !== entry.accountId);
      if (!other) continue;
      const marked = transferFromEntry(vault, entry.id, other.id);
      if (!marked.ok) throw new Error(marked.message);
      const after: Vault = {
        ...vault,
        transactions: vault.transactions.map((t) => (t.id === entry.id ? marked.transaction : t)),
      };

      const own = vault.accounts.find((a) => a.id === entry.accountId) as Account;
      expect(deriveAccountBalance(own, after.transactions)).toBe(deriveAccountBalance(own, vault.transactions));
      const delta = deriveAccountBalance(other, after.transactions) - deriveAccountBalance(other, vault.transactions);
      expect(delta).toBe(entry.kind === "expense" ? entry.amount : -entry.amount);

      const undone = entryFromTransfer(after, entry.id);
      if (!undone.ok) throw new Error(undone.message);
      expect(undone.transaction).toEqual({ ...entry, categoryId: null });
    }
  });

  it("re-importing every entry the Vault already holds adds nothing, marked or not", () => {
    for (const account of vault.accounts) {
      const entries: OfxEntry[] = [];
      for (const tx of vault.transactions) {
        if (tx.kind === "transfer") {
          for (const rec of tx.recoveredFrom ?? []) {
            if (rec.accountId === account.id) {
              entries.push({ fitid: rec.fitid, date: tx.date, amount: -tx.amount, description: "", trntype: "" });
            }
          }
        } else if (tx.accountId === account.id && tx.fitid !== undefined) {
          entries.push({
            fitid: tx.fitid,
            date: tx.date,
            amount: tx.kind === "expense" ? -tx.amount : tx.amount,
            description: tx.description,
            trntype: "",
          });
        }
      }
      const plan = planImport(entries, account.id, vault.transactions);
      expect(plan.additions, account.id).toEqual([]);
      expect(plan.duplicates).toHaveLength(entries.length);
    }
  });

  it("Transfer candidates are well-formed and never reuse a Transaction", () => {
    const candidates = findTransferCandidates(vault);
    const used = new Set<string>();
    const byId = new Map(vault.transactions.map((t) => [t.id, t]));
    for (const c of candidates) {
      const out = byId.get(c.outgoing.transactionId);
      const inc = byId.get(c.incoming.transactionId);
      expect(out?.kind).toBe("expense");
      expect(inc?.kind).toBe("income");
      expect(out?.amount).toBe(c.amount);
      expect(inc?.amount).toBe(c.amount);
      expect(c.outgoing.accountId).not.toBe(c.incoming.accountId);
      expect(c.daysApart).toBeLessThanOrEqual(TRANSFER_WINDOW_DAYS);
      expect(used.has(c.outgoing.transactionId) || used.has(c.incoming.transactionId)).toBe(false);
      used.add(c.outgoing.transactionId);
      used.add(c.incoming.transactionId);
    }
  });

  it("every Income and Expense sits in a Category of its own kind, or none", () => {
    for (const tx of [...incomes, ...expenses]) {
      if (tx.categoryId === null) continue;
      expect(categoryKind(vault, tx.categoryId)).toBe(tx.kind);
    }
  });
});

describe("money round-trips for any amount", () => {
  it("parseBRL(formatBRLInput(x)) === x across a random sweep", () => {
    const r = rng(42);
    for (let i = 0; i < 5000; i++) {
      const value = r.int(-10_000_000_000, 10_000_000_000) as Centavos;
      expect(parseBRL(formatBRLInput(value))).toBe(value === 0 ? 0 : value);
    }
  });
});
