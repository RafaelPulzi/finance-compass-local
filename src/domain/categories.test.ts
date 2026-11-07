import { describe, expect, it } from "vitest";
import {
  addCategory,
  addGroup,
  categoryKind,
  categoryTree,
  categoryUsage,
  deleteCategory,
  deleteGroup,
  moveCategory,
  renameCategory,
  renameGroup,
  transactionCountByCategory,
  treeHas,
} from "./categories";
import { centavos } from "./money";
import type { Vault } from "./types";
import { emptyVault } from "./types";

const vault: Vault = {
  ...emptyVault(),
  accounts: [{ id: "acc", name: "Inter", type: "checking", openingBalance: centavos(0) }],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-home", name: "Moradia", kind: "expense" },
    { id: "g-empty", name: "Vazio", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "c-market", name: "Mercado", groupId: "g-food" },
    { id: "c-resto", name: "Restaurante", groupId: "g-food" },
    { id: "c-rent", name: "Aluguel", groupId: "g-home" },
    { id: "c-unused", name: "Sem uso", groupId: "g-home" },
    { id: "c-salary", name: "Salário", groupId: "g-in" },
  ],
  transactions: [
    {
      id: "e1",
      kind: "expense",
      date: "2026-10-01",
      amount: centavos(1000),
      description: "MERCADO",
      accountId: "acc",
      categoryId: "c-market",
    },
    {
      id: "e2",
      kind: "expense",
      date: "2026-10-02",
      amount: centavos(2000),
      description: "MERCADO 2",
      accountId: "acc",
      categoryId: "c-market",
    },
    {
      id: "e3",
      kind: "expense",
      date: "2026-10-03",
      amount: centavos(3000),
      description: "?",
      accountId: "acc",
      categoryId: null,
    },
  ],
  budgets: [{ id: "b1", categoryId: "c-resto", monthlyLimit: centavos(50000) }],
};

let n = 0;
const makeId = () => `new-${++n}`;

function changed<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
  if (!outcome.ok) throw new Error(`refused: ${(outcome as { message?: string }).message}`);
  return outcome as Extract<T, { ok: true }>;
}

function refusal(outcome: { ok: boolean; message?: string }): string {
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome.message ?? "";
}

describe("categoryKind and usage", () => {
  it("takes a Category's kind from its Group", () => {
    expect(categoryKind(vault, "c-market")).toBe("expense");
    expect(categoryKind(vault, "c-salary")).toBe("income");
    expect(categoryKind(vault, "nope")).toBeUndefined();
  });

  it("counts what points at a Category", () => {
    expect(categoryUsage(vault, "c-market")).toEqual({ transactions: 2, budgets: 0 });
    expect(categoryUsage(vault, "c-resto")).toEqual({ transactions: 0, budgets: 1 });
    expect(categoryUsage(vault, "c-unused")).toEqual({ transactions: 0, budgets: 0 });
  });

  it("counts every Category at once, leaving Uncategorized out", () => {
    const counts = transactionCountByCategory(vault);
    expect(counts.get("c-market")).toBe(2);
    expect(counts.has("c-resto")).toBe(false);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(2);
  });
});

describe("adding", () => {
  it("adds a Group with a trimmed name", () => {
    const { vault: next, group } = changed(addGroup(vault, { name: "  Saúde  ", kind: "expense" }, makeId));
    expect(group.name).toBe("Saúde");
    expect(next.groups).toContainEqual(group);
    expect(vault.groups).not.toContainEqual(group); // pure: the input is untouched
  });

  it("refuses an empty Group name", () => {
    expect(refusal(addGroup(vault, { name: "   ", kind: "expense" }, makeId))).toMatch(/nome/);
  });

  it("refuses a Group name already used for that kind, ignoring case and accents", () => {
    expect(refusal(addGroup(vault, { name: "alimentacao", kind: "expense" }, makeId))).toMatch(
      /Já existe/,
    );
  });

  it("allows the same Group name across kinds, since those lists never mix", () => {
    expect(addGroup(vault, { name: "Renda", kind: "expense" }, makeId).ok).toBe(true);
  });

  it("adds a Category to an existing Group", () => {
    const { vault: next, category } = changed(
      addCategory(vault, { name: "Delivery", groupId: "g-food" }, makeId),
    );
    expect(next.categories).toContainEqual(category);
    expect(categoryKind(next, category.id)).toBe("expense");
  });

  it("refuses a Category in a Group that doesn't exist", () => {
    expect(refusal(addCategory(vault, { name: "X", groupId: "nope" }, makeId))).toMatch(/Grupo/);
  });

  it("refuses a duplicate Category within one Group, but allows it in another", () => {
    expect(refusal(addCategory(vault, { name: "MERCADO", groupId: "g-food" }, makeId))).toMatch(
      /já tem/,
    );
    expect(addCategory(vault, { name: "Mercado", groupId: "g-home" }, makeId).ok).toBe(true);
  });
});

describe("renaming", () => {
  it("renames a Category in place, keeping its id so every Transaction stays classified", () => {
    const next = changed(renameCategory(vault, "c-market", "Supermercado")).vault;
    expect(next.categories.find((c) => c.id === "c-market")?.name).toBe("Supermercado");
    expect(categoryUsage(next, "c-market").transactions).toBe(2);
  });

  it("renames a Group", () => {
    const next = changed(renameGroup(vault, "g-food", "Comida")).vault;
    expect(next.groups.find((g) => g.id === "g-food")?.name).toBe("Comida");
  });

  it("lets a name change only its capitalisation", () => {
    expect(renameCategory(vault, "c-market", "MERCADO").ok).toBe(true);
    expect(renameGroup(vault, "g-food", "ALIMENTAÇÃO").ok).toBe(true);
  });

  it("refuses a rename onto a sibling's name", () => {
    expect(refusal(renameCategory(vault, "c-market", "restaurante"))).toMatch(/já tem/);
    expect(refusal(renameGroup(vault, "g-food", "Moradia"))).toMatch(/Já existe/);
  });

  it("refuses an empty name and an unknown id", () => {
    expect(renameCategory(vault, "c-market", " ").ok).toBe(false);
    expect(renameCategory(vault, "nope", "X").ok).toBe(false);
    expect(renameGroup(vault, "nope", "X").ok).toBe(false);
  });
});

describe("moving a Category", () => {
  it("moves it under another Group of the same kind, keeping its Transactions", () => {
    const next = changed(moveCategory(vault, "c-market", "g-home")).vault;
    expect(next.categories.find((c) => c.id === "c-market")?.groupId).toBe("g-home");
    expect(categoryUsage(next, "c-market").transactions).toBe(2);
  });

  it("refuses to move an expense Category into an income Group", () => {
    expect(refusal(moveCategory(vault, "c-market", "g-in"))).toMatch(/não se misturam/);
  });

  it("refuses a move that would put two Categories of one name in a Group", () => {
    const withTwin = changed(addCategory(vault, { name: "Mercado", groupId: "g-home" }, makeId)).vault;
    expect(refusal(moveCategory(withTwin, "c-market", "g-home"))).toMatch(/já tem/);
  });

  it("treats a move to its own Group as no change", () => {
    const outcome = changed(moveCategory(vault, "c-market", "g-food"));
    expect(outcome.vault).toBe(vault);
  });
});

describe("deleting", () => {
  it("deletes a Category nothing uses", () => {
    const next = changed(deleteCategory(vault, "c-unused")).vault;
    expect(next.categories.some((c) => c.id === "c-unused")).toBe(false);
  });

  it("refuses a Category Transactions still use, naming how many", () => {
    expect(refusal(deleteCategory(vault, "c-market"))).toMatch(/2 transações/);
  });

  it("refuses a Category a Budget still uses", () => {
    expect(refusal(deleteCategory(vault, "c-resto"))).toMatch(/1 orçamento/);
  });

  it("never cascades: a refused delete leaves every Transaction as it was", () => {
    const outcome = deleteCategory(vault, "c-market");
    expect(outcome.ok).toBe(false);
    expect(vault.transactions.filter((t) => t.kind !== "transfer" && t.categoryId === "c-market")).toHaveLength(2);
  });

  it("deletes an empty Group and refuses one with Categories in it", () => {
    expect(changed(deleteGroup(vault, "g-empty")).vault.groups.some((g) => g.id === "g-empty")).toBe(false);
    expect(refusal(deleteGroup(vault, "g-food"))).toMatch(/2 categorias/);
  });

  it("refuses unknown ids", () => {
    expect(deleteCategory(vault, "nope").ok).toBe(false);
    expect(deleteGroup(vault, "nope").ok).toBe(false);
  });
});

describe("categoryTree", () => {
  it("lists one kind's Groups and their Categories alphabetically, in pt-BR order", () => {
    const tree = categoryTree(vault, "expense");
    expect(tree.map((b) => b.group.name)).toEqual(["Alimentação", "Moradia", "Vazio"]);
    expect(tree[0].categories.map((c) => c.name)).toEqual(["Mercado", "Restaurante"]);
    expect(tree[2].categories).toEqual([]);
  });

  it("does not reorder the Vault's own lists", () => {
    const before = vault.groups.map((g) => g.id);
    categoryTree(vault, "expense");
    expect(vault.groups.map((g) => g.id)).toEqual(before);
  });

  it("answers whether a Category is among a tree's choices", () => {
    expect(treeHas(categoryTree(vault, "expense"), "c-market")).toBe(true);
    expect(treeHas(categoryTree(vault, "income"), "c-market")).toBe(false);
  });
});
