import { categoryKind } from "./categories";
import { isValidISODate } from "./dates";
import type { Centavos } from "./money";
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

function hasAccount(vault: Vault, accountId: Id): boolean {
  return vault.accounts.some((a) => a.id === accountId);
}

export function createdTransaction(
  vault: Vault,
  input: NewTransaction,
  id: Id,
): CreateOutcome {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, message: "Informe um valor maior que zero." };
  }
  if (!isValidISODate(input.date)) {
    return { ok: false, message: "Informe uma data válida." };
  }
  const description = input.description.trim();

  if (input.kind === "transfer") {
    if (!hasAccount(vault, input.fromAccountId) || !hasAccount(vault, input.toAccountId)) {
      return { ok: false, message: "Conta inexistente." };
    }
    if (input.fromAccountId === input.toAccountId) {
      return { ok: false, message: "Origem e destino devem ser diferentes." };
    }
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

  if (!hasAccount(vault, input.accountId)) {
    return { ok: false, message: "Conta inexistente." };
  }
  if (input.categoryId !== null) {
    const kind = categoryKind(vault, input.categoryId);
    if (kind === undefined) return { ok: false, message: "Categoria inexistente." };
    if (kind !== input.kind) {
      return {
        ok: false,
        message: "Essa categoria não vale para esse tipo de transação.",
      };
    }
  }
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
