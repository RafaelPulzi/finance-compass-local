import { describe, expect, it } from "vitest";
import { normalizeForSearch } from "./text";
import { SEED_TREE, seedVault } from "./seed";
import { VAULT_SCHEMA_VERSION } from "./types";

describe("seedVault", () => {
  const vault = seedVault();

  it("is a current-schema Vault with no Accounts or Transactions", () => {
    expect(vault.schemaVersion).toBe(VAULT_SCHEMA_VERSION);
    expect(vault.accounts).toEqual([]);
    expect(vault.transactions).toEqual([]);
    expect(vault.budgets).toEqual([]);
  });

  it("puts every Category in a Group that exists", () => {
    const groupIds = new Set(vault.groups.map((g) => g.id));
    expect(vault.categories.every((c) => groupIds.has(c.groupId))).toBe(true);
  });

  it("uses unique ids throughout", () => {
    const ids = [...vault.groups, ...vault.categories].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers both kinds, broadly enough to classify a real Statement (issue #10)", () => {
    const expenseGroups = vault.groups.filter((g) => g.kind === "expense");
    const incomeGroups = vault.groups.filter((g) => g.kind === "income");
    expect(incomeGroups.length).toBeGreaterThan(0);
    expect(expenseGroups.length).toBeGreaterThanOrEqual(10);
    const names = vault.categories.map((c) => normalizeForSearch(c.name));
    for (const needed of ["mercado", "farmacia", "streaming", "tarifas bancarias", "salario"]) {
      expect(names, needed).toContain(needed);
    }
  });

  it("never repeats a Group name within a kind or a Category name within a Group", () => {
    for (const kind of ["income", "expense"] as const) {
      const names = SEED_TREE.filter((b) => b.kind === kind).map((b) => normalizeForSearch(b.group));
      expect(new Set(names).size).toBe(names.length);
    }
    for (const branch of SEED_TREE) {
      const names = branch.categories.map(normalizeForSearch);
      expect(new Set(names).size, branch.group).toBe(names.length);
    }
  });

  it("takes its ids from the given generator, so a seed can be reproduced", () => {
    let n = 0;
    const a = seedVault(() => `id-${++n}`);
    n = 0;
    const b = seedVault(() => `id-${++n}`);
    expect(a).toEqual(b);
  });
});
