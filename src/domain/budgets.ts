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
 *
 * A limit of zero means "not budgeted", and here that meaning is structural:
 * setting zero removes the row instead of keeping an invisible `monthlyLimit:
 * 0` that no panel shows but `categoryUsage` would still count — which is how a
 * Category used to become undeletable over a budget the user could not see.
 */

/** The Vault with the Category's monthly limit set — or removed, when it is zero. */
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
  if (monthlyLimit === 0) {
    // "Don't budget this" removes the row; not budgeting it already is no change.
    if (existing === undefined) return { ok: true, vault };
    return {
      ok: true,
      vault: { ...vault, budgets: vault.budgets.filter((b) => b.categoryId !== categoryId) },
    };
  }
  // The same limit again is nothing to write.
  if (existing?.monthlyLimit === monthlyLimit) return { ok: true, vault };
  const budgets = existing
    ? vault.budgets.map((b) => (b.categoryId === categoryId ? { ...b, monthlyLimit } : b))
    : [...vault.budgets, { id: newId(), categoryId, monthlyLimit } satisfies Budget];
  return { ok: true, vault: { ...vault, budgets } };
}
