import { describe, expect, it } from "vitest";
import {
  deriveAccountBalance,
  deriveNetWorth,
  spentInCategoryForMonth,
} from "./balances";
import { centavos } from "./money";
import type { Account, Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const checking: Account = {
  id: "acc-checking",
  name: "Checking",
  type: "checking",
  openingBalance: centavos(100_00),
};

const savings: Account = {
  id: "acc-savings",
  name: "Savings",
  type: "savings",
  openingBalance: centavos(0),
};

const card: Account = {
  id: "acc-card",
  name: "Credit Card",
  type: "credit-card",
  openingBalance: centavos(0),
};

describe("deriveAccountBalance", () => {
  it("adds income and subtracts expense on the owning account", () => {
    const txs: Transaction[] = [
      { id: "t1", kind: "income", date: "2026-01-05", amount: centavos(500_00), accountId: checking.id, categoryId: "c-salary", description: "Salary" },
      { id: "t2", kind: "expense", date: "2026-01-06", amount: centavos(30_00), accountId: checking.id, categoryId: "c-food", description: "Groceries" },
    ];
    // 100 + 500 - 30 = 570
    expect(deriveAccountBalance(checking, txs)).toBe(570_00);
  });

  it("moves money from source to destination on a transfer", () => {
    const txs: Transaction[] = [
      { id: "t3", kind: "transfer", date: "2026-01-10", amount: centavos(40_00), fromAccountId: checking.id, toAccountId: savings.id, description: "To savings" },
    ];
    expect(deriveAccountBalance(checking, txs)).toBe(60_00); // 100 - 40
    expect(deriveAccountBalance(savings, txs)).toBe(40_00); // 0 + 40
  });

  it("drives a credit card negative (a liability) when spent on", () => {
    const txs: Transaction[] = [
      { id: "t4", kind: "expense", date: "2026-01-11", amount: centavos(80_00), accountId: card.id, categoryId: "c-food", description: "Dinner" },
    ];
    expect(deriveAccountBalance(card, txs)).toBe(-80_00);
  });
});

describe("deriveNetWorth", () => {
  it("sums balances, with liabilities pulling net worth down", () => {
    const vault: Vault = {
      ...emptyVault(),
      accounts: [checking, savings, card],
      transactions: [
        { id: "t5", kind: "expense", date: "2026-01-11", amount: centavos(80_00), accountId: card.id, categoryId: "c-food", description: "Dinner" },
      ],
    };
    // checking 100 + savings 0 + card -80 = 20
    expect(deriveNetWorth(vault)).toBe(20_00);
  });
});

describe("spentInCategoryForMonth", () => {
  const txs: Transaction[] = [
    { id: "a", kind: "expense", date: "2026-01-03", amount: centavos(30_00), accountId: checking.id, categoryId: "c-food", description: "" },
    { id: "b", kind: "expense", date: "2026-01-20", amount: centavos(45_00), accountId: checking.id, categoryId: "c-food", description: "" },
    { id: "c", kind: "expense", date: "2026-02-01", amount: centavos(10_00), accountId: checking.id, categoryId: "c-food", description: "" },
    { id: "d", kind: "income", date: "2026-01-15", amount: centavos(500_00), accountId: checking.id, categoryId: "c-food", description: "" },
    { id: "e", kind: "transfer", date: "2026-01-15", amount: centavos(99_00), fromAccountId: checking.id, toAccountId: savings.id, description: "" },
  ];

  it("counts only expenses in the given category and month", () => {
    // Jan food expenses: 30 + 45 = 75; income and transfer ignored, Feb ignored.
    expect(spentInCategoryForMonth(txs, "c-food", "2026-01")).toBe(75_00);
    expect(spentInCategoryForMonth(txs, "c-food", "2026-02")).toBe(10_00);
  });
});
