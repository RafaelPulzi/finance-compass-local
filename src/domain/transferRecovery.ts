import type { Id, Transaction, TransferTransaction, Vault } from "./types";

/**
 * Recovering a Transfer the user names by hand, one imported entry at a time.
 *
 * A Statement describes one Account, so when money moves to somewhere the Vault
 * does not model — an investment pocket inside the same bank, say — only one leg
 * is ever imported. No pair detector can see that as a Transfer (ADR-0006), so
 * the user names the other side themselves and this turns the entry into one.
 *
 * Pure: it decides what the entry becomes, or why it can't. The store splices
 * the result in; nothing here writes.
 *
 * The conversion **replaces** rather than adds. Keeping the entry and adding a
 * Transfer beside it would count the same money twice — once as an Expense and
 * again as a move — which is the opposite of what the user asked for.
 */

export type RecoveryOutcome =
  | { ok: true; transaction: Transaction }
  | { ok: false; message: string };

/**
 * The entry turned into a Transfer between its own Account and `otherAccountId`.
 *
 * Direction comes from the entry's own kind, never from the user: an Expense
 * left the Account it was imported on, so that Account is the source; an Income
 * arrived there, so it is the destination. Asking the user to confirm a
 * direction they already stated by the sign is a question with one right answer.
 *
 * The Transaction keeps its id. It is the same record reclassified, so the row
 * the user was looking at stays where it was instead of vanishing and
 * reappearing elsewhere in the list.
 */
export function transferFromEntry(
  vault: Vault,
  transactionId: Id,
  otherAccountId: Id,
): RecoveryOutcome {
  const entry = vault.transactions.find((tx) => tx.id === transactionId);
  if (entry === undefined) {
    return { ok: false, message: "Transação não encontrada." };
  }
  if (entry.kind === "transfer") {
    return { ok: false, message: "Essa transação já é uma transferência." };
  }
  if (!vault.accounts.some((a) => a.id === otherAccountId)) {
    return { ok: false, message: "Conta inexistente." };
  }
  if (otherAccountId === entry.accountId) {
    // The same rule the manual Transfer form enforces: money that left and
    // arrived in one Account never moved between two.
    return { ok: false, message: "Escolha uma conta diferente da do lançamento." };
  }

  const transfer: TransferTransaction = {
    id: entry.id,
    kind: "transfer",
    date: entry.date,
    amount: entry.amount,
    description: entry.description,
    fromAccountId: entry.kind === "expense" ? entry.accountId : otherAccountId,
    toAccountId: entry.kind === "expense" ? otherAccountId : entry.accountId,
    // The Category goes, whatever it was: a Transfer carries none (ADR-0006).
    // Only an imported entry has anything to record — a hand-entered one has no
    // bank id, so there is nothing a re-import could duplicate and nothing to
    // reverse to later.
    ...(entry.fitid === undefined
      ? {}
      : { recoveredFrom: [{ fitid: entry.fitid, accountId: entry.accountId }] }),
  };
  return { ok: true, transaction: transfer };
}

/**
 * The Transfer turned back into the imported entry it was recovered from.
 *
 * Marking is a judgement and judgements are sometimes wrong, so it has to be
 * undoable — and undoing it has to restore the `fitid`, or the next Import of
 * that Statement would see the entry as new and add it a second time.
 *
 * The restored entry comes back Uncategorized (ADR-0005). Whatever Category it
 * had before the conversion was not kept — a Transfer has nowhere to keep it —
 * so the honest result is the state an imported entry starts in, rather than a
 * guess at what the user had chosen.
 */
export function entryFromTransfer(vault: Vault, transferId: Id): RecoveryOutcome {
  const transfer = vault.transactions.find((tx) => tx.id === transferId);
  if (transfer === undefined) {
    return { ok: false, message: "Transação não encontrada." };
  }
  if (transfer.kind !== "transfer") {
    return { ok: false, message: "Essa transação não é uma transferência." };
  }

  const recovered = transfer.recoveredFrom ?? [];
  if (recovered.length === 0) {
    // Entered by hand, so there is no earlier entry it used to be. Deleting it
    // is the available answer, and that is a different action with its own
    // confirmation.
    return {
      ok: false,
      message: "Essa transferência não veio de um extrato importado.",
    };
  }
  if (recovered.length > 1) {
    // A Transfer recovered from both sides would have to come apart into two
    // entries, which is the pair conversion's business, not this one's.
    return {
      ok: false,
      message: "Essa transferência foi recuperada de dois lançamentos.",
    };
  }

  const entry = recovered[0];
  // Which side the surviving entry was on is what decides the kind it goes back
  // to: the Account the money left recorded an Expense, the one it reached an
  // Income.
  const kind =
    entry.accountId === transfer.fromAccountId
      ? ("expense" as const)
      : entry.accountId === transfer.toAccountId
        ? ("income" as const)
        : undefined;
  if (kind === undefined) {
    return {
      ok: false,
      message: "A transferência não corresponde ao lançamento de origem.",
    };
  }

  return {
    ok: true,
    transaction: {
      id: transfer.id,
      kind,
      date: transfer.date,
      amount: transfer.amount,
      description: transfer.description,
      accountId: entry.accountId,
      categoryId: null,
      fitid: entry.fitid,
    },
  };
}

// --- Marking many entries at once -----------------------------------------

/** One entry that could not become a Transfer, and why it could not. */
export interface SkippedEntry {
  transactionId: Id;
  message: string;
}

export type BulkRecoveryOutcome =
  | {
      ok: true;
      /** The Transfers, each keeping the id of the entry it replaces. */
      transfers: Transaction[];
      skipped: SkippedEntry[];
    }
  | { ok: false; message: string };

/**
 * The same marking, decided for many entries against one other Account.
 *
 * A real Statement does not hold one internal move, it holds hundreds: a vault
 * built from two years of one checking account can carry ~190 `RESGATE` and ~90
 * `APLICACAO` entries, every one of them the same judgement. Marking them one
 * at a time is not a smaller version of the same work, it is work nobody
 * finishes, and an unfinished pass leaves the totals as wrong as before.
 *
 * Still one decision per entry, taken by `transferFromEntry`, so a batch can
 * never mean something the single marking would not. The direction of each
 * Transfer comes from that entry's own kind, which is why a selection mixing
 * Expenses and Incomes is fine here: money leaving and money arriving both
 * describe the same other Account.
 *
 * A batch is partial rather than all-or-nothing. Selecting by description
 * ("everything matching APLICACAO") sweeps in the occasional entry that cannot
 * convert — one already marked, one already on the chosen Account — and
 * refusing the other 188 because of it would be a worse answer than converting
 * them and saying what was left out. Nothing is hidden: every skip is returned
 * with its reason for the caller to report.
 */
export function transfersFromEntries(
  vault: Vault,
  transactionIds: readonly Id[],
  otherAccountId: Id,
): BulkRecoveryOutcome {
  // The whole batch shares one other Account, so a bad Account is a refusal of
  // the batch and not a hundred identical skips.
  if (!vault.accounts.some((a) => a.id === otherAccountId)) {
    return { ok: false, message: "Conta inexistente." };
  }
  if (transactionIds.length === 0) {
    return { ok: false, message: "Selecione pelo menos um lançamento." };
  }

  const transfers: Transaction[] = [];
  const skipped: SkippedEntry[] = [];
  // The same id twice is the caller's accident, not a second conversion.
  for (const transactionId of new Set(transactionIds)) {
    const outcome = transferFromEntry(vault, transactionId, otherAccountId);
    if (outcome.ok) transfers.push(outcome.transaction);
    else skipped.push({ transactionId, message: outcome.message });
  }
  return { ok: true, transfers, skipped };
}
