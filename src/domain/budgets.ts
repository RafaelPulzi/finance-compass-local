import { categoryKind } from "./categories";
import type { CommandOutcome } from "./command";
import type { Centavos } from "./money";
import type { Budget, Id, Vault } from "./types";

/**
 * Setting the monthly limit of one expense Category.
 *
 * Pure, like every other Vault write: it returns the Vault it would leave
 * behind, or why it refuses. This used to live in the store, which made it the
 * one write the domain tests could not reach.
 */

/** The Vault with the Category's monthly limit set, or why it can't be. */
export function setBudget(
  vault: Vault,
  input: { categoryId: Id; monthlyLimit: Centavos },
  newId: () => Id,
): CommandOutcome {
  const { categoryId, monthlyLimit } = input;
  if (!Number.isInteger(monthlyLimit) || monthlyLimit < 0) {
    return { ok: false, message: "Informe um limite igual ou maior que zero." };
  }
  // Only expenses count toward a Budget, so a Budget on an income Category
  // would be a limit nothing could ever reach.
  if (categoryKind(vault, categoryId) !== "expense") {
    return { ok: false, message: "Orçamentos valem só para categorias de despesa." };
  }
  const existing = vault.budgets.find((b) => b.categoryId === categoryId);
  // The same limit again is nothing to write.
  if (existing?.monthlyLimit === monthlyLimit) return { ok: true, vault };
  const budgets = existing
    ? vault.budgets.map((b) => (b.categoryId === categoryId ? { ...b, monthlyLimit } : b))
    : [...vault.budgets, { id: newId(), categoryId, monthlyLimit } satisfies Budget];
  return { ok: true, vault: { ...vault, budgets } };
}
