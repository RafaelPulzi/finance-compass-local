import type { CommandOutcome } from "./command";
import type { Centavos } from "./money";
import type {
  Id,
  ISODate,
  ImportedEntry,
  Transaction,
  TransferTransaction,
  Vault,
} from "./types";

/**
 * Finding the two sides of one Transfer among imported entries.
 *
 * A Statement describes one Account, so an internal move arrives as two
 * unrelated-looking Transactions: an Expense on the Account the money left and
 * an Income on the Account it reached (ADR-0006). Nothing in either entry says
 * they are the same money.
 *
 * Pure: this proposes, the user decides. A candidate is not a Transaction and
 * nothing here is persisted — same-amount coincidences are common enough that
 * converting without being asked would merge two real expenses into one
 * non-event, which is a worse error than the double-counting it would fix.
 */

/**
 * How many days apart the two sides of one move may be.
 *
 * A PIX between the user's own banks usually lands the same day; a TED or a
 * weekend transfer can take a couple of business days. Three days covers that
 * without turning every repeated subscription charge into a candidate.
 */
export const TRANSFER_WINDOW_DAYS = 3;

/** One side of a candidate: enough to show it without looking the Transaction up again. */
export interface CandidateSide {
  transactionId: Id;
  accountId: Id;
  date: ISODate;
  description: string;
}

/**
 * Two imported entries the app believes are the two sides of one Transfer,
 * offered to the user and never converted on its own.
 */
export interface TransferCandidate {
  /** The Expense: the Account the money left. Becomes the Transfer's source. */
  outgoing: CandidateSide;
  /** The Income: the Account the money reached. Becomes the Transfer's destination. */
  incoming: CandidateSide;
  amount: Centavos;
  /** Whole days between the two dates. 0 means the same day. */
  daysApart: number;
}

const MS_PER_DAY = 86_400_000;

/** Whole days between two date-only ISO strings, always positive. */
function daysBetween(a: ISODate, b: ISODate): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(ms / MS_PER_DAY));
}

/**
 * Order-insensitive key for a pair of Transaction ids. Which side was found
 * first is an accident of iteration, so a dismissal must match either way.
 */
function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function sideOf(tx: Transaction & { accountId: Id }): CandidateSide {
  return {
    transactionId: tx.id,
    accountId: tx.accountId,
    date: tx.date,
    description: tx.description,
  };
}

/**
 * The candidate pairs in a Vault, closest dates first.
 *
 * Only an Expense and an Income can pair, and only across two different
 * Accounts for the same exact amount: an unequal pair (a transfer that arrived
 * with a fee deducted) stays a manual judgement rather than widening the
 * suggestion set faster than it helps.
 *
 * Each Transaction is offered in at most one pair, so the user cannot accept two
 * conflicting conversions from one list. Where several pairings are possible the
 * closest dates win, which is both the likeliest reading and a stable one.
 */
export function findTransferCandidates(vault: Vault): TransferCandidate[] {
  const dismissed = new Set(
    vault.dismissedTransferPairs.map((pair) =>
      pairKey(pair.transactionIds[0], pair.transactionIds[1]),
    ),
  );

  // Only equal amounts can pair, so group by amount and never compare across
  // groups. A Transfer is not a candidate side: it is already the thing a
  // candidate would become.
  const byAmount = new Map<
    number,
    { outgoing: CandidateSide[]; incoming: CandidateSide[] }
  >();
  for (const tx of vault.transactions) {
    if (tx.kind === "transfer") continue;
    let group = byAmount.get(tx.amount);
    if (group === undefined) {
      group = { outgoing: [], incoming: [] };
      byAmount.set(tx.amount, group);
    }
    (tx.kind === "expense" ? group.outgoing : group.incoming).push(sideOf(tx));
  }

  const plausible: TransferCandidate[] = [];
  for (const [amount, group] of byAmount) {
    for (const outgoing of group.outgoing) {
      for (const incoming of group.incoming) {
        // Money moving within one Account is not a move between two Accounts.
        if (outgoing.accountId === incoming.accountId) continue;
        const daysApart = daysBetween(outgoing.date, incoming.date);
        if (daysApart > TRANSFER_WINDOW_DAYS) continue;
        if (dismissed.has(pairKey(outgoing.transactionId, incoming.transactionId))) {
          continue;
        }
        plausible.push({
          outgoing,
          incoming,
          amount: amount as Centavos,
          daysApart,
        });
      }
    }
  }

  // Closest dates first, then by date and id so the order never depends on how
  // the Vault happened to be iterated.
  plausible.sort(
    (a, b) =>
      a.daysApart - b.daysApart ||
      (a.outgoing.date < b.outgoing.date ? -1 : a.outgoing.date > b.outgoing.date ? 1 : 0) ||
      (a.outgoing.transactionId < b.outgoing.transactionId ? -1 : 1),
  );

  // Take the best pairing for each Transaction and drop any later pair that
  // would reuse a side already claimed.
  const claimed = new Set<Id>();
  const candidates: TransferCandidate[] = [];
  for (const candidate of plausible) {
    const out = candidate.outgoing.transactionId;
    const inc = candidate.incoming.transactionId;
    if (claimed.has(out) || claimed.has(inc)) continue;
    claimed.add(out);
    claimed.add(inc);
    candidates.push(candidate);
  }
  return candidates;
}

// --- The user's verdict on a pair -------------------------------------------

/**
 * The Vault with a candidate pair accepted: the two entries become one
 * Transfer, replaced rather than kept alongside it (ADR-0006) — counting the
 * same money as an Expense, an Income *and* a move would be three answers to
 * one event.
 *
 * This is the one conversion that cannot keep an id: two Transactions become
 * one, so the Transfer gets a new id and both old rows go. It remembers the
 * bank's id of each imported side (`recoveredFrom`), which is what stops the
 * next Import of either Statement from re-adding the entries just converted.
 *
 * The Transfer takes the Expense's date — the day the money left — and its
 * description, since the leaving side is the one the user has been reading as
 * spending. Dismissals naming either entry go with them: they described
 * Transactions that no longer exist.
 */
export function acceptTransferPair(
  vault: Vault,
  outgoingId: Id,
  incomingId: Id,
  newId: () => Id,
): CommandOutcome {
  const outgoing = vault.transactions.find((tx) => tx.id === outgoingId);
  const incoming = vault.transactions.find((tx) => tx.id === incomingId);
  if (outgoing === undefined || incoming === undefined) {
    return { ok: false, message: "Transação não encontrada." };
  }
  if (outgoing.kind !== "expense" || incoming.kind !== "income") {
    return { ok: false, message: "Um par é uma despesa e uma receita." };
  }
  if (outgoing.accountId === incoming.accountId) {
    return { ok: false, message: "Os dois lançamentos estão na mesma conta." };
  }
  if (outgoing.amount !== incoming.amount) {
    return { ok: false, message: "Os valores dos dois lançamentos são diferentes." };
  }

  const recoveredFrom: ImportedEntry[] = [];
  if (outgoing.fitid !== undefined) {
    recoveredFrom.push({ fitid: outgoing.fitid, accountId: outgoing.accountId });
  }
  if (incoming.fitid !== undefined) {
    recoveredFrom.push({ fitid: incoming.fitid, accountId: incoming.accountId });
  }

  const transfer: TransferTransaction = {
    id: newId(),
    kind: "transfer",
    date: outgoing.date,
    amount: outgoing.amount,
    description: outgoing.description,
    fromAccountId: outgoing.accountId,
    toAccountId: incoming.accountId,
    ...(recoveredFrom.length === 0 ? {} : { recoveredFrom }),
  };
  const gone = new Set([outgoingId, incomingId]);
  return {
    ok: true,
    vault: {
      ...vault,
      transactions: [...vault.transactions.filter((tx) => !gone.has(tx.id)), transfer],
      dismissedTransferPairs: vault.dismissedTransferPairs.filter(
        (pair) => !pair.transactionIds.some((id) => gone.has(id)),
      ),
    },
  };
}

/**
 * The Vault remembering that these two entries are not one Transfer, so the
 * pair is never offered again and working through the list makes progress.
 * Dismissing changes no Transaction, and dismissing the same pair twice — in
 * either order — is the same single dismissal.
 */
export function dismissTransferPair(vault: Vault, a: Id, b: Id): CommandOutcome {
  if (a === b) {
    return { ok: false, message: "Um par são dois lançamentos diferentes." };
  }
  const exists = (id: Id) => vault.transactions.some((tx) => tx.id === id);
  if (!exists(a) || !exists(b)) {
    return { ok: false, message: "Transação não encontrada." };
  }
  const key = pairKey(a, b);
  const already = vault.dismissedTransferPairs.some(
    (pair) => pairKey(pair.transactionIds[0], pair.transactionIds[1]) === key,
  );
  if (already) return { ok: true, vault };
  return {
    ok: true,
    vault: {
      ...vault,
      dismissedTransferPairs: [
        ...vault.dismissedTransferPairs,
        { transactionIds: [a, b] },
      ],
    },
  };
}
