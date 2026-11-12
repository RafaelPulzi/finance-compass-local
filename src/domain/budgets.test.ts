import { describe, expect, it } from "vitest";
import { setBudget } from "./budgets";
import { centavos } from "./money";
import type { Vault } from "./types";
import { emptyVault } from "./types";

const base: Vault = {
  ...emptyVault(),
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "cat-market", name: "Mercado", groupId: "g-food" },
    { id: "cat-salary", name: "Salário", groupId: "g-in" },
  ],
};

const newId = () => "b-new";

describe("setBudget", () => {
  it("creates a Budget for an expense Category", () => {
    const outcome = setBudget(base, { categoryId: "cat-market", monthlyLimit: centavos(80000) }, newId);
    expect(outcome.ok && outcome.vault.budgets).toEqual([
      { id: "b-new", categoryId: "cat-market", monthlyLimit: centavos(80000) },
    ]);
  });

  it("updates the existing Budget instead of adding a second row", () => {
    const vault: Vault = {
      ...base,
      budgets: [{ id: "b-1", categoryId: "cat-market", monthlyLimit: centavos(80000) }],
    };
    const outcome = setBudget(vault, { categoryId: "cat-market", monthlyLimit: centavos(90000) }, newId);
    expect(outcome.ok && outcome.vault.budgets).toEqual([
      { id: "b-1", categoryId: "cat-market", monthlyLimit: centavos(90000) },
    ]);
  });

  it("returns the same Vault for the same limit again, so nothing is saved", () => {
    const vault: Vault = {
      ...base,
      budgets: [{ id: "b-1", categoryId: "cat-market", monthlyLimit: centavos(80000) }],
    };
    const outcome = setBudget(vault, { categoryId: "cat-market", monthlyLimit: centavos(80000) }, newId);
    expect(outcome.ok && outcome.vault).toBe(vault);
  });

  it("refuses a negative or fractional limit", () => {
    expect(setBudget(base, { categoryId: "cat-market", monthlyLimit: -1 as never }, newId).ok).toBe(false);
    expect(setBudget(base, { categoryId: "cat-market", monthlyLimit: 10.5 as never }, newId).ok).toBe(false);
  });

  it("refuses an income Category: nothing could ever reach that limit", () => {
    const outcome = setBudget(base, { categoryId: "cat-salary", monthlyLimit: centavos(1000) }, newId);
    expect(outcome).toEqual({ ok: false, message: "Orçamentos valem só para categorias de despesa." });
  });

  it("refuses a Category the Vault does not have", () => {
    expect(setBudget(base, { categoryId: "cat-ghost", monthlyLimit: centavos(1000) }, newId).ok).toBe(false);
  });
});
