import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import {
  NO_FILTER,
  type TransactionFilter,
  monthsWithTransactions,
  selectTransactions,
} from "./transactionQuery";
import type { Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const INTER = "acc-inter";
const SAVINGS = "acc-savings";

const expense = (
  id: string,
  date: string,
  amount: number,
  description: string,
  categoryId: string | null,
  accountId = INTER,
): Transaction => ({
  id,
  kind: "expense",
  date,
  amount: centavos(amount),
  description,
  accountId,
  categoryId,
});

const income = (
  id: string,
  date: string,
  amount: number,
  description: string,
  accountId = INTER,
): Transaction => ({
  id,
  kind: "income",
  date,
  amount: centavos(amount),
  description,
  accountId,
  categoryId: "cat-salary",
});

const transfer: Transaction = {
  id: "t1",
  kind: "transfer",
  date: "2026-10-07",
  amount: centavos(50000),
  description: "Para a poupança",
  fromAccountId: INTER,
  toAccountId: SAVINGS,
};

const vault: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(10000) },
    { id: SAVINGS, name: "Poupança", type: "savings", openingBalance: centavos(0) },
  ],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "cat-market", name: "Mercado", groupId: "g-food" },
    { id: "cat-salary", name: "Salário", groupId: "g-in" },
  ],
  transactions: [
    expense("e1", "2026-10-02", 30000, "SUPERMERCADO SAO JOSE", "cat-market"),
    expense("e2", "2026-10-15", 4500, "AÇAÍ DA PRAÇA", null),
    expense("e3", "2026-09-20", 9900, "UBER *TRIP", null),
    expense("e4", "2026-10-11", 1200, "Padaria", null, SAVINGS),
    income("i1", "2026-10-05", 485000, "SALARIO EMPRESA"),
    transfer,
  ],
};

const filter = (overrides: Partial<TransactionFilter>): TransactionFilter => ({
  ...NO_FILTER,
  ...overrides,
});

const ids = (f: TransactionFilter) =>
  selectTransactions(vault, f).transactions.map((tx) => tx.id);

describe("selectTransactions", () => {
  it("returns everything, newest first, with no filter", () => {
    expect(ids(NO_FILTER)).toEqual(["e2", "e4", "t1", "i1", "e1", "e3"]);
  });

  it("orders same-day Transactions deterministically", () => {
    const sameDay: Vault = {
      ...emptyVault(),
      transactions: [
        expense("b", "2026-10-02", 100, "", null),
        expense("a", "2026-10-02", 200, "", null),
      ],
    };
    expect(selectTransactions(sameDay, NO_FILTER).transactions.map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  describe("by account", () => {
    it("keeps only Transactions on that Account", () => {
      expect(ids(filter({ accountId: SAVINGS }))).toEqual(["e4", "t1"]);
    });

    it("includes a Transfer from either side, since it moved money there", () => {
      expect(ids(filter({ accountId: INTER }))).toContain("t1");
      expect(ids(filter({ accountId: SAVINGS }))).toContain("t1");
    });
  });

  describe("by month", () => {
    it("keeps only that calendar month", () => {
      expect(ids(filter({ month: "2026-09" }))).toEqual(["e3"]);
    });
  });

  describe("by kind", () => {
    it("keeps only that kind", () => {
      expect(ids(filter({ kind: "income" }))).toEqual(["i1"]);
      expect(ids(filter({ kind: "transfer" }))).toEqual(["t1"]);
    });
  });

  describe("by category", () => {
    it("finds the Transactions in one Category", () => {
      expect(ids(filter({ category: { kind: "category", categoryId: "cat-market" } }))).toEqual([
        "e1",
      ]);
    });

    it("finds the Uncategorized ones, which is the absence of a Category (ADR-0005)", () => {
      expect(ids(filter({ category: { kind: "uncategorized" } }))).toEqual(["e2", "e4", "e3"]);
    });

    it("never matches a Transfer, which has no Category to be absent", () => {
      expect(ids(filter({ category: { kind: "uncategorized" } }))).not.toContain("t1");
      expect(
        ids(filter({ category: { kind: "category", categoryId: "cat-market" } })),
      ).not.toContain("t1");
    });
  });

  describe("search", () => {
    it("ignores case", () => {
      expect(ids(filter({ search: "supermercado" }))).toEqual(["e1"]);
    });

    it("ignores accents, so the bank's spelling doesn't have to be guessed", () => {
      expect(ids(filter({ search: "acai" }))).toEqual(["e2"]);
      expect(ids(filter({ search: "AÇAÍ" }))).toEqual(["e2"]);
      expect(ids(filter({ search: "poupanca" }))).toEqual(["t1"]);
    });

    it("matches anywhere in the description", () => {
      expect(ids(filter({ search: "jose" }))).toEqual(["e1"]);
    });

    it("ignores surrounding whitespace", () => {
      expect(ids(filter({ search: "  uber  " }))).toEqual(["e3"]);
    });
  });

  it("combines filters with AND", () => {
    expect(
      ids(
        filter({
          accountId: INTER,
          month: "2026-10",
          kind: "expense",
          category: { kind: "uncategorized" },
        }),
      ),
    ).toEqual(["e2"]);
  });

  describe("count and totals", () => {
    it("totals the matching set, keeping Transfers out of both", () => {
      const all = selectTransactions(vault, NO_FILTER);
      expect(all.count).toBe(6);
      expect(all.income).toBe(485000);
      expect(all.expense).toBe(45600); // 30000 + 4500 + 9900 + 1200, no transfer
    });

    it("totals only what the filter kept", () => {
      const october = selectTransactions(vault, filter({ month: "2026-10" }));
      expect(october.count).toBe(5);
      expect(october.expense).toBe(35700); // September's 9900 excluded
    });

    it("reports an empty result as zeros rather than failing", () => {
      const none = selectTransactions(vault, filter({ search: "nao existe" }));
      expect(none).toMatchObject({ transactions: [], count: 0, income: 0, expense: 0 });
    });
  });
});

describe("monthsWithTransactions", () => {
  it("lists the months the Vault has Transactions in, newest first", () => {
    expect(monthsWithTransactions(vault)).toEqual(["2026-10", "2026-09"]);
  });

  it("is empty for a Vault with no Transactions", () => {
    expect(monthsWithTransactions(emptyVault())).toEqual([]);
  });
});
