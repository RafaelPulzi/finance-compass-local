import { categoryKind } from "./categories";
import type { CommandOutcome } from "./command";
import { isValidISODate } from "./dates";
import type { Centavos } from "./money";
import type { Id, ISODate, Transaction, Vault } from "./types";

/**
 * Correcting a Transaction that is already recorded.
 *
 * Pure: it decides what the Transaction should become, or why the change can't
 * be made. The store splices the result in; nothing here writes.
 *
 * Every rule the model relies on is enforced here rather than in the form, so
 * the UI and the store cannot disagree about what a valid Transaction is.
 */

/** Only the fields given are changed; the rest keep their current values. */
export interface TransactionEdit {
  date?: ISODate;
  amount?: Centavos;
  description?: string;
  /**
   * Income and Expense can be swapped — an Import that read the sign the wrong
   * way has to be fixable. Converting to or from a Transfer is a different
   * shape (two Accounts, no Category) and is refused here.
   */
  kind?: "income" | "expense";
  accountId?: Id;
  /** `null` clears the Category, leaving the Transaction Uncategorized (ADR-0005). */
  categoryId?: Id | null;
  fromAccountId?: Id;
  toAccountId?: Id;
}

export type EditOutcome =
  | { ok: true; transaction: Transaction }
  | { ok: false; message: string };

/** The Vault with the Transaction corrected in place, or why it can't be. */
export function editTransaction(
  vault: Vault,
  transactionId: Id,
  changes: TransactionEdit,
): CommandOutcome {
  const outcome = editedTransaction(vault, transactionId, changes);
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    vault: {
      ...vault,
      transactions: vault.transactions.map((tx) =>
        tx.id === transactionId ? outcome.transaction : tx,
      ),
    },
  };
}

/**
 * The Vault without the Transaction. Removing one that isn't there returns the
 * same Vault, which the store reads as nothing to save. The Import record it
 * came from is left alone: it stays an honest history of what that Import did.
 * The `fitid` goes with the Transaction, so re-importing the same Statement
 * will add it back.
 */
export function deleteTransaction(vault: Vault, transactionId: Id): CommandOutcome {
  if (!vault.transactions.some((tx) => tx.id === transactionId)) {
    return { ok: true, vault };
  }
  return {
    ok: true,
    vault: {
      ...vault,
      transactions: vault.transactions.filter((tx) => tx.id !== transactionId),
    },
  };
}

function hasAccount(vault: Vault, accountId: Id): boolean {
  return vault.accounts.some((a) => a.id === accountId);
}

/**
 * What the Transaction becomes after `changes`, or why it can't.
 *
 * `fitid` is carried over untouched: it is the bank's own id and what an Import
 * dedups against, so editing a description must not make the entry importable
 * all over again.
 */
export function editedTransaction(
  vault: Vault,
  transactionId: Id,
  changes: TransactionEdit,
): EditOutcome {
  const current = vault.transactions.find((tx) => tx.id === transactionId);
  if (current === undefined) {
    return { ok: false, message: "Transação não encontrada." };
  }

  const amount = changes.amount ?? current.amount;
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: "Informe um valor maior que zero." };
  }

  const date = changes.date ?? current.date;
  if (!isValidISODate(date)) {
    return { ok: false, message: "Informe uma data válida." };
  }

  const description = changes.description ?? current.description;

  if (current.kind === "transfer") {
    if (changes.kind !== undefined) {
      return {
        ok: false,
        message: "Uma transferência não pode se tornar receita ou despesa.",
      };
    }
    if (changes.categoryId !== undefined) {
      return { ok: false, message: "Uma transferência não tem categoria." };
    }

    const fromAccountId = changes.fromAccountId ?? current.fromAccountId;
    const toAccountId = changes.toAccountId ?? current.toAccountId;
    if (!hasAccount(vault, fromAccountId) || !hasAccount(vault, toAccountId)) {
      return { ok: false, message: "Conta inexistente." };
    }
    if (fromAccountId === toAccountId) {
      return { ok: false, message: "Origem e destino devem ser diferentes." };
    }

    // A recovered Transfer's imported side is a fact from the bank: the
    // Statement of that Account said the money left it (or arrived in it).
    // Moving that side to another Account, or swapping the direction, would
    // contradict the Statement and leave nothing for "desfazer" to restore.
    // The other side is the user's own judgement and stays editable.
    for (const entry of current.recoveredFrom ?? []) {
      const side = entry.accountId === current.fromAccountId ? "from" : "to";
      const stillThere =
        side === "from" ? fromAccountId === entry.accountId : toAccountId === entry.accountId;
      if (!stillThere) {
        return {
          ok: false,
          message:
            "A conta do lançamento importado não pode mudar. Desfaça a transferência para corrigi-la.",
        };
      }
    }

    return {
      ok: true,
      transaction: { ...current, date, amount, description, fromAccountId, toAccountId },
    };
  }

  const kind = changes.kind ?? current.kind;
  const accountId = changes.accountId ?? current.accountId;
  if (!hasAccount(vault, accountId)) {
    return { ok: false, message: "Conta inexistente." };
  }

  let categoryId =
    changes.categoryId !== undefined ? changes.categoryId : current.categoryId;
  if (categoryId !== null) {
    const kindOfCategory = categoryKind(vault, categoryId);
    if (kindOfCategory === undefined) {
      return { ok: false, message: "Categoria inexistente." };
    }
    if (kindOfCategory !== kind) {
      // Asking for a Category of the wrong kind outright is a mistake worth
      // reporting. Keeping one that only became wrong because the kind flipped
      // is not: the Category is dropped, so the Transaction goes Uncategorized
      // rather than an Income sitting in an expense Category.
      if (changes.categoryId !== undefined) {
        return {
          ok: false,
          message: "Essa categoria não vale para esse tipo de transação.",
        };
      }
      categoryId = null;
    }
  }

  return {
    ok: true,
    transaction: {
      id: current.id,
      kind,
      date,
      amount,
      description,
      accountId,
      categoryId,
      ...(current.fitid === undefined ? {} : { fitid: current.fitid }),
      // Provenance survives an edit that leaves the Category where it was — a
      // corrected date or description does not mean the user chose the
      // Category. Any change to the Category is their own decision, so the
      // Rule stops being what explains it.
      ...(current.ruleId !== undefined && categoryId === current.categoryId
        ? { ruleId: current.ruleId }
        : {}),
    },
  };
}
