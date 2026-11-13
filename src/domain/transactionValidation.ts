import { categoryKind } from "./categories";
import { isValidISODate } from "./dates";
import type { Centavos } from "./money";
import type { CategoryKind, Id, ISODate, Vault } from "./types";

/**
 * What every path that shapes a Transaction agrees a valid one is.
 *
 * Creating, editing and recovering a Transfer each enforce the same rules —
 * the amount, the date, the Accounts, the Category's kind — and before this
 * module they each enforced them with their own copy, which had already started
 * to drift (create trimmed the description, edit did not). This is an internal
 * seam: the three modules share it, their callers never see it.
 *
 * Each check returns the refusal it would give, or null when it has none, so a
 * caller can write `refuse(...) ?? refuse(...) ?? proceed` and the first
 * problem found is the one reported — the same order a person fixes a form in.
 */

export type Complaint = { ok: false; message: string } | null;

/** A Transaction's amount is a positive whole number of centavos. */
export function badAmount(amount: Centavos): Complaint {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: "Informe um valor maior que zero." };
  }
  return null;
}

/** A Transaction's date is a real calendar date. */
export function badDate(date: ISODate): Complaint {
  if (!isValidISODate(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  return null;
}

/** Every Account a Transaction touches must exist in the Vault. */
export function missingAccount(vault: Vault, ...accountIds: readonly Id[]): Complaint {
  for (const accountId of accountIds) {
    if (!vault.accounts.some((a) => a.id === accountId)) {
      return { ok: false, message: "Conta inexistente." };
    }
  }
  return null;
}

/** A Transfer moves money between two Accounts, so one Account is no Transfer. */
export function sameAccountTwice(fromAccountId: Id, toAccountId: Id): Complaint {
  if (fromAccountId === toAccountId) {
    return { ok: false, message: "Origem e destino devem ser diferentes." };
  }
  return null;
}

/**
 * A Category, when there is one, must exist and be of the Transaction's own
 * kind: an Income never sits in an expense Category. `null` is always fine —
 * it is Uncategorized, not an error (ADR-0005).
 */
export function wrongCategory(
  vault: Vault,
  categoryId: Id | null,
  kind: CategoryKind,
): Complaint {
  if (categoryId === null) return null;
  const kindOfCategory = categoryKind(vault, categoryId);
  if (kindOfCategory === undefined) {
    return { ok: false, message: "Categoria inexistente." };
  }
  if (kindOfCategory !== kind) {
    return { ok: false, message: "Essa categoria não vale para esse tipo de transação." };
  }
  return null;
}

/** The description as every path records it: trimmed, whoever typed it. */
export function cleanDescription(description: string): string {
  return description.trim();
}
