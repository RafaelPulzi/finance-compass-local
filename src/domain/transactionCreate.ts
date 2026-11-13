import type { CommandOutcome } from "./command";
import type { Centavos } from "./money";
import {
  badAmount,
  badDate,
  cleanDescription,
  missingAccount,
  sameAccountTwice,
  wrongCategory,
} from "./transactionValidation";
import type { Id, ISODate, Transaction, Vault } from "./types";

/**
 * Recording a Transaction the user typed in.
 *
 * Pure, and the same rules the edit path enforces (transactionEdit): the form
 * is a convenience, not the guard. Before this existed the store accepted
 * whatever the form sent, and the form could send an Income filed under an
 * expense Category — switch the kind after picking a Category and the stale id
 * went through.
 */

export type NewTransaction =
  | {
      kind: "income" | "expense";
      date: ISODate;
      amount: Centavos;
      accountId: Id;
      /** `null` records it Uncategorized, to classify later (ADR-0005). */
      categoryId: Id | null;
      description: string;
    }
  | {
      kind: "transfer";
      date: ISODate;
      amount: Centavos;
      fromAccountId: Id;
      toAccountId: Id;
      description: string;
    };

export type CreateOutcome =
  | { ok: true; transaction: Transaction }
  | { ok: false; message: string };

/**
 * The Vault with the new Transaction recorded, whatever its kind — the caller
 * says "income", "expense" or "transfer" in the input instead of picking one of
 * three entry points that only differ in that word.
 */
export function addTransaction(
  vault: Vault,
  input: NewTransaction,
  id: Id,
): CommandOutcome<{ transaction: Transaction }> {
  const outcome = createdTransaction(vault, input, id);
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    vault: { ...vault, transactions: [...vault.transactions, outcome.transaction] },
    transaction: outcome.transaction,
  };
}

export function createdTransaction(
  vault: Vault,
  input: NewTransaction,
  id: Id,
): CreateOutcome {
  const complaint = badAmount(input.amount) ?? badDate(input.date);
  if (complaint !== null) return complaint;
  const description = cleanDescription(input.description);

  if (input.kind === "transfer") {
    const refusedTransfer =
      missingAccount(vault, input.fromAccountId, input.toAccountId) ??
      sameAccountTwice(input.fromAccountId, input.toAccountId);
    if (refusedTransfer !== null) return refusedTransfer;
    return {
      ok: true,
      transaction: {
        id,
        kind: "transfer",
        date: input.date,
        amount: input.amount,
        description,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
      },
    };
  }

  const refused =
    missingAccount(vault, input.accountId) ??
    wrongCategory(vault, input.categoryId, input.kind);
  if (refused !== null) return refused;
  return {
    ok: true,
    transaction: {
      id,
      kind: input.kind,
      date: input.date,
      amount: input.amount,
      description,
      accountId: input.accountId,
      categoryId: input.categoryId,
    },
  };
}
