import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import {
  budgetState,
  budgetStatusForMonth,
  monthChoices,
  monthlyTotals,
  recentMonths,
  spendingByCategoryForMonth,
  uncategorizedSpendForMonth,
} from "./reporting";
import type { Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const ACC = "acc-1";
const SAVINGS = "acc-2";

const expense = (
  id: string,
  date: string,
  amount: number,
  categoryId: string | null,
): Transaction => ({
  id,
  kind: "expense",
  date,
  amount: centavos(amount),
  description: "",
  accountId: ACC,
  categoryId,
});

const income = (id: string, date: string, amount: number): Transaction => ({
  id,
  kind: "income",
  date,
  amount: centavos(amount),
  description: "",
  accountId: ACC,
  categoryId: "cat-salary",
});

const vault: Vault = {
  ...emptyVault(),
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-home", name: "Moradia", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "cat-market", name: "Mercado", groupId: "g-food" },
    { id: "cat-resto", name: "Restaurante", groupId: "g-food" },
    { id: "cat-rent", name: "Aluguel", groupId: "g-home" },
    { id: "cat-salary", name: "Salário", groupId: "g-in" },
  ],
  budgets: [
    { id: "b1", categoryId: "cat-market", monthlyLimit: centavos(80000) },
    { id: "b2", categoryId: "cat-resto", monthlyLimit: centavos(20000) },
    { id: "b3", categoryId: "cat-gone", monthlyLimit: centavos(10000) },
  ],
  transactions: [
    expense("e1", "2026-10-02", 30000, "cat-market"),
    expense("e2", "2026-10-15", 25000, "cat-market"),
    expense("e3", "2026-10-09", 26000, "cat-resto"),
    expense("e4", "2026-10-05", 185000, "cat-rent"),
    expense("e5", "2026-09-20", 99900, "cat-market"), // another month
    expense("e6", "2026-10-11", 4500, null), // uncategorized
    income("i1", "2026-10-05", 485000),
    income("i2", "2026-09-05", 480000),
    {
      id: "t1",
      kind: "transfer",
      date: "2026-10-07",
      amount: centavos(50000),
      description: "",
      fromAccountId: ACC,
      toAccountId: SAVINGS,
    },
  ],
};

describe("recentMonths", () => {
  it("returns the months ending at the given one, oldest first", () => {
    expect(recentMonths("2026-10", 6)).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("rolls over the year boundary", () => {
    expect(recentMonths("2026-01", 3)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("spendingByCategoryForMonth", () => {
  const rows = spendingByCategoryForMonth(vault, "2026-10");

  it("totals each expense category for the month, biggest first", () => {
    expect(rows.map((r) => [r.categoryName, r.spent])).toEqual([
      ["Aluguel", 185000],
      ["Mercado", 55000], // 300 + 250
      ["Restaurante", 26000],
    ]);
  });

  it("excludes income, transfers, other months and uncategorized spend", () => {
    expect(rows.find((r) => r.categoryName === "Salário")).toBeUndefined();
    // September's R$999 in Mercado is not counted in October.
    expect(rows.find((r) => r.categoryName === "Mercado")?.spent).toBe(55000);
    expect(rows.reduce((sum, r) => sum + r.spent, 0)).toBe(266000); // no 4500
  });

  it("carries the group name for grouping in the UI", () => {
    expect(rows.find((r) => r.categoryName === "Mercado")?.groupName).toBe("Alimentação");
  });
});

describe("uncategorizedSpendForMonth", () => {
  it("reports expenses with no category so the money isn't invisible", () => {
    expect(uncategorizedSpendForMonth(vault, "2026-10")).toBe(4500);
    expect(uncategorizedSpendForMonth(vault, "2026-09")).toBe(0);
  });
});

describe("budgetStatusForMonth", () => {
  const rows = budgetStatusForMonth(vault, "2026-10");

  it("pairs each budget with the month's actual spending", () => {
    const market = rows.find((r) => r.categoryName === "Mercado");
    expect(market).toMatchObject({ limit: 80000, spent: 55000, remaining: 25000 });
    expect(market?.ratio).toBeCloseTo(0.6875);
  });

  it("reports an overspent budget as negative remaining", () => {
    const resto = rows.find((r) => r.categoryName === "Restaurante");
    expect(resto).toMatchObject({ limit: 20000, spent: 26000, remaining: -6000 });
    expect(resto!.ratio).toBeGreaterThan(1);
  });

  it("sorts the most-consumed budget first", () => {
    expect(rows[0].categoryName).toBe("Restaurante");
  });

  it("skips budgets whose category no longer exists", () => {
    expect(rows).toHaveLength(2);
  });

  it("does not roll over: a fresh month starts from zero spent", () => {
    const august = budgetStatusForMonth(vault, "2026-08");
    expect(august.every((r) => r.spent === 0)).toBe(true);
    expect(august.find((r) => r.categoryName === "Mercado")?.remaining).toBe(80000);
  });
});

describe("budgetState", () => {
  it("flags only spending over the limit as critical", () => {
    expect(budgetState(1.01)).toBe("critical");
    expect(budgetState(1)).toBe("warning"); // exactly at the limit is not over it
  });

  it("warns in the last fifth of the limit", () => {
    expect(budgetState(0.8)).toBe("warning");
    expect(budgetState(0.79)).toBe("good");
    expect(budgetState(0)).toBe("good");
  });
});

describe("monthlyTotals", () => {
  const rows = monthlyTotals(vault, ["2026-08", "2026-09", "2026-10"]);

  it("totals income and expense per month, ignoring transfers", () => {
    expect(rows).toEqual([
      { month: "2026-08", income: 0, expense: 0, net: 0 },
      { month: "2026-09", income: 480000, expense: 99900, net: 380100 },
      // October expenses: 300+250+260+1850+45 (incl. uncategorized) = 2705,00
      { month: "2026-10", income: 485000, expense: 270500, net: 214500 },
    ]);
  });
});

describe("monthChoices", () => {
  const tx = (id: string, date: string) => ({
    id,
    kind: "expense" as const,
    date,
    amount: centavos(100),
    description: id,
    accountId: "a",
    categoryId: null,
  });

  it("offers the last twelve months even with no data, newest first", () => {
    const months = monthChoices(emptyVault(), "2026-11");
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-11");
    expect(months[11]).toBe("2025-12");
  });

  it("reaches every month the Vault has Transactions in, however old", () => {
    // Two years of imported history: the dashboard used to stop at twelve months.
    const vault = { ...emptyVault(), transactions: [tx("old", "2024-10-16"), tx("mid", "2025-06-01")] };
    const months = monthChoices(vault, "2026-11");
    expect(months).toContain("2024-10");
    expect(months).toContain("2025-06");
    expect(months.at(-1)).toBe("2024-10");
    expect(new Set(months).size).toBe(months.length);
  });

  it("keeps a post-dated month too", () => {
    const months = monthChoices({ ...emptyVault(), transactions: [tx("f", "2027-03-10")] }, "2026-11");
    expect(months[0]).toBe("2027-03");
  });
});
