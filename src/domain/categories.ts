import type { CommandOutcome } from "./command";
import { normalizeForSearch } from "./text";
import type { Category, CategoryKind, Group, Id, Vault } from "./types";
import { isBudgeted } from "./types";

/**
 * Managing the Group → Category tree the user classifies into.
 *
 * Pure: each function returns the Vault it would leave behind, or why it
 * refuses. The store writes only on `ok`, so a refused change is never
 * half-applied, and the counts the UI shows come from the same functions the
 * rules are enforced with.
 *
 * Deletion is refused, never cascaded (issue #10): cascading would delete the
 * user's classification work, and quietly resetting Transactions to
 * Uncategorized would empty Category totals without anyone noticing.
 */

export type VaultChange = CommandOutcome;

/** The kind a Category classifies, or undefined if the Vault has no such Category. */
export function categoryKind(vault: Vault, categoryId: Id): CategoryKind | undefined {
  const category = vault.categories.find((c) => c.id === categoryId);
  if (category === undefined) return undefined;
  return vault.groups.find((g) => g.id === category.groupId)?.kind;
}

export interface CategoryUsage {
  transactions: number;
  budgets: number;
}

/** What still points at a Category, which is what stops it being deleted. */
export function categoryUsage(vault: Vault, categoryId: Id): CategoryUsage {
  let transactions = 0;
  for (const tx of vault.transactions) {
    if (tx.kind !== "transfer" && tx.categoryId === categoryId) transactions += 1;
  }
  // A zero-limit row is "not budgeted" (see isBudgeted), so it is no use: a
  // Budget the user cannot see must never be what blocks deleting a Category.
  const budgets = vault.budgets.filter(
    (b) => b.categoryId === categoryId && isBudgeted(b),
  ).length;
  return { transactions, budgets };
}

/** Transaction counts for every Category at once, for a page listing them all. */
export function transactionCountByCategory(vault: Vault): Map<Id, number> {
  const counts = new Map<Id, number>();
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer" || tx.categoryId === null) continue;
    counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1);
  }
  return counts;
}

/** Trimmed, with runs of spaces collapsed; null when nothing is left. */
function cleanName(name: string): string | null {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

/** "Saúde" and "saude " are the same name to a person reading a list. */
function sameName(a: string, b: string): boolean {
  return normalizeForSearch(a) === normalizeForSearch(b);
}

function groupNameTaken(vault: Vault, name: string, kind: CategoryKind, except?: Id): boolean {
  return vault.groups.some((g) => g.id !== except && g.kind === kind && sameName(g.name, name));
}

function categoryNameTaken(vault: Vault, name: string, groupId: Id, except?: Id): boolean {
  return vault.categories.some(
    (c) => c.id !== except && c.groupId === groupId && sameName(c.name, name),
  );
}

export function addGroup(
  vault: Vault,
  input: { name: string; kind: CategoryKind },
  makeId: () => Id,
): { ok: true; vault: Vault; group: Group } | { ok: false; message: string } {
  const name = cleanName(input.name);
  if (name === null) return { ok: false, message: "Dê um nome ao grupo." };
  if (groupNameTaken(vault, name, input.kind)) {
    return { ok: false, message: `Já existe um grupo chamado “${name}”.` };
  }
  const group: Group = { id: makeId(), name, kind: input.kind };
  return { ok: true, group, vault: { ...vault, groups: [...vault.groups, group] } };
}

export function addCategory(
  vault: Vault,
  input: { name: string; groupId: Id },
  makeId: () => Id,
): { ok: true; vault: Vault; category: Category } | { ok: false; message: string } {
  const name = cleanName(input.name);
  if (name === null) return { ok: false, message: "Dê um nome à categoria." };
  if (!vault.groups.some((g) => g.id === input.groupId)) {
    return { ok: false, message: "Grupo inexistente." };
  }
  if (categoryNameTaken(vault, name, input.groupId)) {
    return { ok: false, message: `Esse grupo já tem uma categoria “${name}”.` };
  }
  const category: Category = { id: makeId(), name, groupId: input.groupId };
  return {
    ok: true,
    category,
    vault: { ...vault, categories: [...vault.categories, category] },
  };
}

export function renameGroup(vault: Vault, groupId: Id, newName: string): VaultChange {
  const group = vault.groups.find((g) => g.id === groupId);
  if (group === undefined) return { ok: false, message: "Grupo inexistente." };
  const name = cleanName(newName);
  if (name === null) return { ok: false, message: "Dê um nome ao grupo." };
  if (groupNameTaken(vault, name, group.kind, groupId)) {
    return { ok: false, message: `Já existe um grupo chamado “${name}”.` };
  }
  return {
    ok: true,
    vault: {
      ...vault,
      groups: vault.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
    },
  };
}

/** Renaming keeps the id, so every Transaction and Budget in it stays where it was. */
export function renameCategory(vault: Vault, categoryId: Id, newName: string): VaultChange {
  const category = vault.categories.find((c) => c.id === categoryId);
  if (category === undefined) return { ok: false, message: "Categoria inexistente." };
  const name = cleanName(newName);
  if (name === null) return { ok: false, message: "Dê um nome à categoria." };
  if (categoryNameTaken(vault, name, category.groupId, categoryId)) {
    return { ok: false, message: `Esse grupo já tem uma categoria “${name}”.` };
  }
  return {
    ok: true,
    vault: {
      ...vault,
      categories: vault.categories.map((c) => (c.id === categoryId ? { ...c, name } : c)),
    },
  };
}

/**
 * Move a Category under another Group of the same kind.
 *
 * Crossing kinds is refused: every Transaction in the Category was an Expense
 * (or an Income) when it was filed there, and an expense Category that became
 * an income one would leave all of them classified under the wrong kind.
 */
export function moveCategory(vault: Vault, categoryId: Id, groupId: Id): VaultChange {
  const category = vault.categories.find((c) => c.id === categoryId);
  if (category === undefined) return { ok: false, message: "Categoria inexistente." };
  const target = vault.groups.find((g) => g.id === groupId);
  if (target === undefined) return { ok: false, message: "Grupo inexistente." };
  if (category.groupId === groupId) return { ok: true, vault };
  if (categoryKind(vault, categoryId) !== target.kind) {
    return {
      ok: false,
      message: "Categorias de receita e de despesa não se misturam.",
    };
  }
  if (categoryNameTaken(vault, category.name, groupId, categoryId)) {
    return { ok: false, message: `O grupo de destino já tem uma categoria “${category.name}”.` };
  }
  return {
    ok: true,
    vault: {
      ...vault,
      categories: vault.categories.map((c) => (c.id === categoryId ? { ...c, groupId } : c)),
    },
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function deleteCategory(vault: Vault, categoryId: Id): VaultChange {
  if (!vault.categories.some((c) => c.id === categoryId)) {
    return { ok: false, message: "Categoria inexistente." };
  }
  const usage = categoryUsage(vault, categoryId);
  if (usage.transactions > 0 || usage.budgets > 0) {
    const uses = [
      usage.transactions > 0 ? plural(usage.transactions, "transação", "transações") : null,
      usage.budgets > 0 ? plural(usage.budgets, "orçamento", "orçamentos") : null,
    ].filter((u): u is string => u !== null);
    return {
      ok: false,
      message: `Não é possível excluir: a categoria ainda é usada por ${uses.join(" e ")}. Reclassifique antes de excluir.`,
    };
  }
  return {
    ok: true,
    vault: { ...vault, categories: vault.categories.filter((c) => c.id !== categoryId) },
  };
}

export function deleteGroup(vault: Vault, groupId: Id): VaultChange {
  if (!vault.groups.some((g) => g.id === groupId)) {
    return { ok: false, message: "Grupo inexistente." };
  }
  const inside = vault.categories.filter((c) => c.groupId === groupId).length;
  if (inside > 0) {
    return {
      ok: false,
      message: `Não é possível excluir: o grupo ainda tem ${plural(inside, "categoria", "categorias")}.`,
    };
  }
  return { ok: true, vault: { ...vault, groups: vault.groups.filter((g) => g.id !== groupId) } };
}

/** Groups of one kind with their Categories, as `categoryTree` builds them. */
export type CategoryTree = readonly { group: Group; categories: readonly Category[] }[];

/** Whether a Category id is one of the choices in `tree`. */
export function treeHas(tree: CategoryTree, categoryId: Id): boolean {
  return tree.some((branch) => branch.categories.some((c) => c.id === categoryId));
}

/** Groups of one kind with their Categories, alphabetically, for selects and lists. */
export function categoryTree(
  vault: Vault,
  kind: CategoryKind,
): { group: Group; categories: Category[] }[] {
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, "pt-BR");
  return vault.groups
    .filter((g) => g.kind === kind)
    .sort(byName)
    .map((group) => ({
      group,
      categories: vault.categories.filter((c) => c.groupId === group.id).sort(byName),
    }));
}
