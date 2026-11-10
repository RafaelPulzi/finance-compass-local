import { describe, expect, it } from "vitest";
import {
  addRule,
  applyRules,
  assignmentsFromRules,
  deleteRule,
  editRule,
  moveRule,
  pendingRuleCount,
  ruleMatchCounts,
  ruleMatches,
  suggestedPattern,
} from "./classificationRules";
import { centavos } from "./money";
import type { Rule, Transaction, Vault } from "./types";
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

const rule = (overrides: Partial<Rule> = {}): Rule => ({
  id: "r-1",
  pattern: "ifood",
  categoryId: "cat-restaurant",
  kind: "expense",
  ...overrides,
});

const tx = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: "tx-1",
    kind: "expense",
    date: "2026-10-02",
    amount: centavos(5000),
    description: "IFOOD *IFOOD COM AGEN",
    accountId: INTER,
    categoryId: null,
    ...overrides,
  }) as Transaction;

describe("ruleMatches", () => {
  it("ignores case", () => {
    expect(ruleMatches(rule({ pattern: "ifood" }), "IFOOD *IFOOD")).toBe(true);
  });

  it("ignores accents on either side", () => {
    expect(ruleMatches(rule({ pattern: "açaí" }), "ACAI DA PRACA")).toBe(true);
    expect(ruleMatches(rule({ pattern: "acai" }), "Açaí da Praça")).toBe(true);
  });

  it("matches a substring, not a whole description", () => {
    expect(ruleMatches(rule({ pattern: "mercado" }), "SUPERMERCADO SAO JOSE")).toBe(true);
  });

  it("treats a pattern as literal text, never as a regular expression", () => {
    // As a regex this would match anything; as a substring it matches nothing here.
    expect(ruleMatches(rule({ pattern: ".*" }), "IFOOD *IFOOD")).toBe(false);
    // And a pattern with regex metacharacters still matches its literal self.
    expect(ruleMatches(rule({ pattern: "*ifood" }), "IFOOD *IFOOD")).toBe(true);
  });

  it("never matches on an empty pattern", () => {
    expect(ruleMatches(rule({ pattern: "   " }), "QUALQUER COISA")).toBe(false);
  });
});

describe("assignmentsFromRules", () => {
  it("classifies an Uncategorized Transaction that matches", () => {
    const assignments = assignmentsFromRules([rule()], [tx()]);

    expect(assignments).toEqual([
      { transactionId: "tx-1", categoryId: "cat-restaurant", ruleId: "r-1" },
    ]);
  });

  it("leaves a Transaction the user already classified alone", () => {
    const assignments = assignmentsFromRules([rule()], [tx({ categoryId: "cat-market" })]);

    expect(assignments).toEqual([]);
  });

  it("never classifies a Transfer, which carries no Category", () => {
    const transfer: Transaction = {
      id: "t-1",
      kind: "transfer",
      date: "2026-10-02",
      amount: centavos(5000),
      description: "IFOOD *IFOOD",
      fromAccountId: INTER,
      toAccountId: "acc-other",
    };

    expect(assignmentsFromRules([rule()], [transfer])).toEqual([]);
  });

  it("ignores a Rule of the other kind", () => {
    const incomeRule = rule({ id: "r-in", kind: "income", categoryId: "cat-salary" });

    expect(assignmentsFromRules([incomeRule], [tx()])).toEqual([]);
  });

  it("lets the first matching Rule decide and skips the rest", () => {
    const specific = rule({ id: "r-specific", pattern: "ifood", categoryId: "cat-restaurant" });
    const general = rule({ id: "r-general", pattern: "food", categoryId: "cat-market" });

    expect(assignmentsFromRules([specific, general], [tx()])).toEqual([
      { transactionId: "tx-1", categoryId: "cat-restaurant", ruleId: "r-specific" },
    ]);
    // The user's order is the whole of the priority: reversed, the other wins.
    expect(assignmentsFromRules([general, specific], [tx()])).toEqual([
      { transactionId: "tx-1", categoryId: "cat-market", ruleId: "r-general" },
    ]);
  });

  it("changes nothing when there are no Rules", () => {
    expect(assignmentsFromRules([], [tx()])).toEqual([]);
  });
});

describe("applyRules", () => {
  it("records the Rule that assigned the Category", () => {
    const { transactions, assignments } = applyRules([rule()], [tx()]);

    expect(assignments).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      categoryId: "cat-restaurant",
      ruleId: "r-1",
    });
  });

  it("is idempotent: a second pass changes nothing", () => {
    const first = applyRules([rule()], [tx()]);
    const second = applyRules([rule()], first.transactions);

    expect(second.assignments).toEqual([]);
    // The very same array, so a caller knows there is nothing to save.
    expect(second.transactions).toBe(first.transactions);
  });

  it("returns the Transactions untouched when nothing matches", () => {
    const transactions = [tx({ description: "PADARIA DO ZE" })];

    expect(applyRules([rule()], transactions).transactions).toBe(transactions);
  });
});

describe("ruleMatchCounts and pendingRuleCount", () => {
  it("counts what each Rule has actually classified", () => {
    const vault: Vault = {
      ...base,
      transactions: [
        tx({ id: "a", categoryId: "cat-restaurant", ruleId: "r-1" }),
        tx({ id: "b", categoryId: "cat-restaurant", ruleId: "r-1" }),
        tx({ id: "c", categoryId: "cat-market", ruleId: "r-2" }),
        // Classified by hand: it belongs to no Rule.
        tx({ id: "d", categoryId: "cat-market" }),
      ],
    };

    expect(ruleMatchCounts(vault)).toEqual(
      new Map([
        ["r-1", 2],
        ["r-2", 1],
      ]),
    );
  });

  it("counts how many Uncategorized Transactions the Rules would classify", () => {
    const vault: Vault = {
      ...base,
      rules: [rule()],
      transactions: [
        tx({ id: "a" }),
        tx({ id: "b" }),
        tx({ id: "c", description: "PADARIA" }),
        tx({ id: "d", categoryId: "cat-market" }),
      ],
    };

    expect(pendingRuleCount(vault)).toBe(2);
  });
});

describe("suggestedPattern", () => {
  it("finds the words several descriptions share", () => {
    expect(
      suggestedPattern(["UBER TRIP 8213", "UBER TRIP 9120", "UBER TRIP HELP.UBER.COM"]),
    ).toBe("uber trip");
  });

  it("proposes the description itself when there is only one", () => {
    expect(suggestedPattern(["PADARIA DO ZE"])).toBe("padaria do ze");
  });

  it("normalises the proposal, so one rule covers the bank's spelling", () => {
    expect(suggestedPattern(["AÇAÍ DA PRAÇA 1", "Açaí da Praça 2"])).toBe("acai da praca");
  });

  it("offers nothing when the descriptions share no words", () => {
    expect(suggestedPattern(["PADARIA DO ZE", "POSTO IPIRANGA"])).toBe(null);
  });

  it("offers nothing when all they share is a number", () => {
    expect(suggestedPattern(["PADARIA 2026", "POSTO 2026"])).toBe(null);
  });

  it("offers nothing for descriptions with no words at all", () => {
    expect(suggestedPattern([" ", "***"])).toBe(null);
  });
});

describe("adding, editing, reordering and deleting a Rule", () => {
  const ids = () => {
    let n = 0;
    return () => `r-${++n}`;
  };

  it("takes the kind from the Category, so the two can never disagree", () => {
    const outcome = addRule(base, { pattern: "ifood", categoryId: "cat-restaurant" }, ids());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rule).toEqual({
      id: "r-1",
      pattern: "ifood",
      categoryId: "cat-restaurant",
      kind: "expense",
    });
  });

  it("builds an income Rule from an income Category", () => {
    const outcome = addRule(base, { pattern: "salario", categoryId: "cat-salary" }, ids());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rule.kind).toBe("income");
  });

  it("adds at the end, where it cannot change what the Rules above decide", () => {
    const vault: Vault = { ...base, rules: [rule()] };

    const outcome = addRule(vault, { pattern: "padaria", categoryId: "cat-market" }, ids());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.vault.rules.map((r) => r.pattern)).toEqual(["ifood", "padaria"]);
  });

  it("refuses a pattern that would match everything", () => {
    expect(addRule(base, { pattern: "   ", categoryId: "cat-market" }, ids())).toEqual({
      ok: false,
      message: "Informe o texto que a descrição deve conter.",
    });
  });

  it("refuses a Category the Vault doesn't have", () => {
    expect(addRule(base, { pattern: "ifood", categoryId: "cat-nope" }, ids())).toEqual({
      ok: false,
      message: "Escolha uma categoria existente.",
    });
  });

  it("refuses a second Rule with the same pattern for the same kind", () => {
    const vault: Vault = { ...base, rules: [rule({ pattern: "IFOOD" })] };

    expect(addRule(vault, { pattern: "ifood", categoryId: "cat-market" }, ids())).toEqual({
      ok: false,
      message: "Já existe uma regra com esse padrão.",
    });
  });

  it("allows the same pattern for the other kind", () => {
    const vault: Vault = { ...base, rules: [rule({ pattern: "pix" })] };

    const outcome = addRule(vault, { pattern: "pix", categoryId: "cat-salary" }, ids());

    expect(outcome.ok).toBe(true);
  });

  it("edits a Rule in place, keeping its position", () => {
    const vault: Vault = {
      ...base,
      rules: [rule({ id: "r-a" }), rule({ id: "r-b", pattern: "padaria" })],
    };

    const change = editRule(vault, "r-a", {
      pattern: "ifood com",
      categoryId: "cat-market",
    });

    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.vault.rules[0]).toMatchObject({
      id: "r-a",
      pattern: "ifood com",
      categoryId: "cat-market",
    });
  });

  it("lets a Rule keep its own pattern while its Category changes", () => {
    const vault: Vault = { ...base, rules: [rule()] };

    const change = editRule(vault, "r-1", { pattern: "ifood", categoryId: "cat-market" });

    expect(change.ok).toBe(true);
  });

  it("moves a Rule up so a specific pattern can win over a general one", () => {
    const vault: Vault = {
      ...base,
      rules: [
        rule({ id: "r-general", pattern: "food" }),
        rule({ id: "r-specific", pattern: "ifood" }),
      ],
    };

    const change = moveRule(vault, "r-specific", -1);

    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.vault.rules.map((r) => r.id)).toEqual(["r-specific", "r-general"]);
  });

  it("treats moving past either end as nothing to do", () => {
    const vault: Vault = { ...base, rules: [rule()] };

    const change = moveRule(vault, "r-1", -1);

    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.vault).toBe(vault);
  });

  it("deletes a Rule and leaves the Transactions it classified as they were", () => {
    const vault: Vault = {
      ...base,
      rules: [rule()],
      transactions: [tx({ categoryId: "cat-restaurant", ruleId: "r-1" })],
    };

    const change = deleteRule(vault, "r-1");

    expect(change.ok).toBe(true);
    if (!change.ok) return;
    expect(change.vault.rules).toEqual([]);
    expect(change.vault.transactions[0]).toMatchObject({
      categoryId: "cat-restaurant",
      ruleId: "r-1",
    });
  });

  it("refuses to edit, move or delete a Rule that isn't there", () => {
    const message = "Regra não encontrada.";
    expect(editRule(base, "r-nope", { pattern: "x", categoryId: "cat-market" })).toEqual({
      ok: false,
      message,
    });
    expect(moveRule(base, "r-nope", 1)).toEqual({ ok: false, message });
    expect(deleteRule(base, "r-nope")).toEqual({ ok: false, message });
  });
});
