import { describe, expect, it } from "vitest";
import {
  applySuggestions,
  decisionKey,
  suggestCategories,
} from "./categorySuggestions";
import { centavos } from "./money";
import type { Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const INTER = "acc-inter";

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
  ],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "cat-market", name: "Mercado", groupId: "g-food" },
    { id: "cat-restaurant", name: "Restaurantes", groupId: "g-food" },
    { id: "cat-salary", name: "Salário", groupId: "g-in" },
  ],
};

let nextId = 0;
const tx = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: `tx-${++nextId}`,
    kind: "expense",
    date: "2026-10-02",
    amount: centavos(5000),
    description: "IFOOD *IFOOD COM AGEN",
    accountId: INTER,
    categoryId: null,
    ...overrides,
  }) as Transaction;

/** Two hand decisions filing iFood under Restaurantes: the minimum habit. */
const habit = [
  tx({ description: "IFOOD *IFOOD 745211", categoryId: "cat-restaurant" }),
  tx({ description: "IFOOD *IFOOD 981002", categoryId: "cat-restaurant" }),
];

describe("decisionKey", () => {
  it("ignores case and accents, like every other matching in the app", () => {
    expect(decisionKey("Açaí da Praça")).toBe(decisionKey("ACAI DA PRACA"));
  });

  it("drops the numbers banks bury the merchant in", () => {
    expect(decisionKey("PIX IFOOD 12345")).toBe(decisionKey("PIX IFOOD 99999"));
  });

  it("keeps tokens that mix letters and digits — they are names, not noise", () => {
    expect(decisionKey("POSTO BR2")).not.toBe(decisionKey("POSTO")); // br2 survives
  });

  it("has nothing to say about an all-number description", () => {
    expect(decisionKey("1234 5678")).toBeNull();
  });
});

describe("suggestCategories", () => {
  it("suggests the Category the user filed the same description under twice", () => {
    const uncategorized = tx({ description: "IFOOD *IFOOD 300017" });
    const vault = { ...base, transactions: [...habit, uncategorized] };

    expect(suggestCategories(vault)).toEqual([
      { transactionId: uncategorized.id, categoryId: "cat-restaurant", occurrences: 2 },
    ]);
  });

  it("says nothing after a single decision — once is not a habit", () => {
    const vault = {
      ...base,
      transactions: [
        tx({ description: "IFOOD 1", categoryId: "cat-restaurant" }),
        tx({ description: "IFOOD 2" }),
      ],
    };
    expect(suggestCategories(vault)).toEqual([]);
  });

  it("says nothing when the user's own decisions disagree", () => {
    const vault = {
      ...base,
      transactions: [
        tx({ description: "IFOOD 1", categoryId: "cat-restaurant" }),
        tx({ description: "IFOOD 2", categoryId: "cat-restaurant" }),
        tx({ description: "IFOOD 3", categoryId: "cat-market" }),
        tx({ description: "IFOOD 4", categoryId: "cat-market" }),
        tx({ description: "IFOOD 5" }),
      ],
    };
    expect(suggestCategories(vault)).toEqual([]);
  });

  it("lets the more frequent Category win a disagreement that has a winner", () => {
    const uncategorized = tx({ description: "IFOOD 9" });
    const vault = {
      ...base,
      transactions: [
        tx({ description: "IFOOD 1", categoryId: "cat-restaurant" }),
        tx({ description: "IFOOD 2", categoryId: "cat-restaurant" }),
        tx({ description: "IFOOD 3", categoryId: "cat-market" }),
        uncategorized,
      ],
    };
    expect(suggestCategories(vault)).toEqual([
      { transactionId: uncategorized.id, categoryId: "cat-restaurant", occurrences: 2 },
    ]);
  });

  it("learns only from hand decisions, never from what a Rule assigned", () => {
    const vault = {
      ...base,
      rules: [
        { id: "r-1", pattern: "ifood", categoryId: "cat-restaurant", kind: "expense" as const },
      ],
      transactions: [
        tx({ description: "IFOOD 1", categoryId: "cat-restaurant", ruleId: "r-1" }),
        tx({ description: "IFOOD 2", categoryId: "cat-restaurant", ruleId: "r-1" }),
        tx({ description: "IFOOD 3" }),
      ],
    };
    expect(suggestCategories(vault)).toEqual([]);
  });

  it("keeps Income and Expense habits separate, as their Categories are", () => {
    const uncategorizedIncome = tx({ kind: "income", description: "IFOOD REPASSE 1" });
    const vault = {
      ...base,
      transactions: [
        // The habit is about Expenses; an Income with the same words is not covered.
        tx({ description: "IFOOD REPASSE 7", categoryId: "cat-restaurant" }),
        tx({ description: "IFOOD REPASSE 8", categoryId: "cat-restaurant" }),
        uncategorizedIncome,
      ],
    };
    expect(suggestCategories(vault)).toEqual([]);
  });

  it("never suggests a Category the Vault no longer has", () => {
    const vault = {
      ...base,
      categories: base.categories.filter((c) => c.id !== "cat-restaurant"),
      transactions: [...habit, tx({ description: "IFOOD 3" })],
    };
    expect(suggestCategories(vault)).toEqual([]);
  });
});

describe("applySuggestions", () => {
  it("fills every suggested gap in one mutation, without a ruleId", () => {
    const a = tx({ description: "IFOOD *IFOOD 300017" });
    const b = tx({ description: "IFOOD *IFOOD 300018" });
    const vault = { ...base, transactions: [...habit, a, b] };

    const outcome = applySuggestions(vault);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.applied).toBe(2);
    const applied = outcome.vault.transactions.filter((t) => t.id === a.id || t.id === b.id);
    for (const t of applied) {
      expect(t.kind !== "transfer" && t.categoryId).toBe("cat-restaurant");
      expect(t.kind !== "transfer" && t.ruleId).toBeUndefined();
    }
  });

  it("returns the same Vault when there is nothing to apply, so nothing is saved", () => {
    const vault = { ...base, transactions: [...habit] };
    const outcome = applySuggestions(vault);
    expect(outcome.ok && outcome.applied).toBe(0);
    expect(outcome.ok && outcome.vault).toBe(vault);
  });

  it("is idempotent: applying twice changes nothing the second time", () => {
    const vault = {
      ...base,
      transactions: [...habit, tx({ description: "IFOOD *IFOOD 300017" })],
    };
    const first = applySuggestions(vault);
    if (!first.ok) throw new Error("first apply refused");
    expect(first.applied).toBe(1);
    const second = applySuggestions(first.vault);
    expect(second.ok && second.applied).toBe(0);
    expect(second.ok && second.vault).toBe(first.vault);
  });

  it("never touches a Category the user set by hand", () => {
    const decided = tx({ description: "IFOOD *IFOOD 300017", categoryId: "cat-market" });
    const vault = { ...base, transactions: [...habit, decided] };
    const outcome = applySuggestions(vault);
    if (!outcome.ok) throw new Error("apply refused");
    const kept = outcome.vault.transactions.find((t) => t.id === decided.id);
    expect(kept?.kind !== "transfer" && kept?.categoryId).toBe("cat-market");
  });
});
