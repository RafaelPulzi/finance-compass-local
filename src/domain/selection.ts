import { effectOnAccount } from "./balances";
import { type Centavos, centavos } from "./money";
import { transfersFromEntries } from "./transferRecovery";
import type { Id, Vault } from "./types";

/**
 * What a selection of Transactions means: the judgements the Transactions page
 * used to make for itself, answered by the domain so the preview a user reads
 * and the conversion they then confirm can never disagree.
 */

/**
 * The kind every selected Transaction shares, "mixed" when the selection spans
 * both, or null when nothing selectable is selected. Income and expense
 * Categories are separate, so a mixed selection has no Category that could
 * apply to all of it — but it can still be marked as Transfers, since each
 * entry's direction comes from its own kind.
 */
export function selectedKind(
  vault: Vault,
  selected: ReadonlySet<Id>,
): "income" | "expense" | "mixed" | null {
  let kind: "income" | "expense" | null = null;
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer" || !selected.has(tx.id)) continue;
    if (kind === null) kind = tx.kind;
    else if (kind !== tx.kind) return "mixed";
  }
  return kind;
}

/** The selected descriptions, which are what an offered Rule is guessed from. */
export function selectedDescriptions(vault: Vault, selected: ReadonlySet<Id>): string[] {
  return vault.transactions
    .filter((tx) => tx.kind !== "transfer" && selected.has(tx.id))
    .map((tx) => tx.description);
}

/** What marking a selection against one Account would actually do. */
export interface MarkingPreview {
  /** How many of the selection would become Transfers. */
  converts: number;
  /** How many would be skipped — already a Transfer, already on that Account. */
  skipped: number;
  /** Money arriving in the chosen Account: the converting Expenses. */
  arrives: Centavos;
  /** Money leaving it: the converting Incomes. */
  leaves: Centavos;
}

/**
 * The preview of a bulk marking, decided by the same `transfersFromEntries`
 * the confirmation runs. The page used to sum the whole selection by itself
 * while the conversion skipped entries already on the chosen Account, so the
 * "aumenta/diminui" the user read could overstate what then happened. Running
 * the real decision makes the figures the conversion's own, and the balance
 * change comes from `effectOnAccount` — the balance semantics itself, not a
 * re-description of it.
 */
export function markingPreview(
  vault: Vault,
  transactionIds: readonly Id[],
  otherAccountId: Id,
): MarkingPreview {
  const outcome = transfersFromEntries(vault, transactionIds, otherAccountId);
  if (!outcome.ok) {
    return { converts: 0, skipped: transactionIds.length, arrives: centavos(0), leaves: centavos(0) };
  }
  let arrives = 0;
  let leaves = 0;
  for (const transfer of outcome.transfers) {
    const effect = effectOnAccount(transfer, otherAccountId);
    if (effect > 0) arrives += effect;
    else leaves -= effect;
  }
  return {
    converts: outcome.transfers.length,
    skipped: outcome.skipped.length,
    arrives: centavos(arrives),
    leaves: centavos(leaves),
  };
}
