import { applySuggestions, suggestCategories } from "../domain/categorySuggestions";
import { addRule, classifyAs, ruleOfferFor } from "../domain/classificationRules";
import type { ActionResult } from "../domain/command";
import { selectedDescriptions } from "../domain/selection";
import { deleteTransaction, editTransaction } from "../domain/transactionEdit";
import type { TransactionEdit } from "../domain/transactionEdit";
import { NO_FILTER } from "../domain/transactionQuery";
import type { TransactionFilter } from "../domain/transactionQuery";
import {
  markAllAsTransfers,
  markAsTransfer,
  undoMarking,
} from "../domain/transferRecovery";
import type { SkippedEntry } from "../domain/transferRecovery";
import type { Id, Vault } from "../domain/types";
import type { RunCommand } from "../store/useVault";
import { selectableIdsOf } from "./view";

/**
 * The Worklist: the state of working through the Transactions page, and what
 * each gesture there does.
 *
 * This is *page* state, not Vault truth — which selection is held, which row
 * form is open, what the app last said — so it lives here and not in the
 * domain. Nothing here is persisted; leaving the page forgets all of it.
 *
 * It is a plain state machine: `(state, deps, …) → next state`. No React, so
 * the test surface is ordinary functions — no `renderHook`, no jsdom, no
 * `act`. The ~20-line `useWorklist` hook is the only thing that knows about
 * `useState`.
 *
 * **A gesture owns its consequences** (ADR-0011). Running the Command is only
 * part of what one click means: the row form closes, the selection lets go of
 * the rows that just left it, and the notice records what happened — all
 * decided here, in one place, rather than remembered by the panel at each call
 * site. That is what fixes the selection outliving its rows.
 *
 * Outcomes are structured, never sentences: this module reports
 * `{ converted, skipped }` and the panel writes the Portuguese. A refusal
 * passes through as the domain's own message, the only text here.
 */

/** What is being done to the one row that has a form open. */
export type RowMode = "editing" | "deleting" | "marking";

/**
 * The row with a form open, if any.
 *
 * One field, not three ids: `editingId`/`deletingId`/`markingId` made "two
 * rows open at once" a representable state, kept out only by hand-rolled
 * clearing that was inconsistent between the three.
 */
export interface OpenRow {
  id: Id;
  mode: RowMode;
}

/** A Rule the app is offering to remember, from classification just done by hand. */
export interface RuleOffer {
  pattern: string;
  categoryId: Id;
}

/**
 * What the app last said, and where it belongs on screen.
 *
 * `at: "row"` is a refusal with no form of its own to show it. The bulk ones
 * outlive the selection on purpose: the gesture clears the selection, so a
 * message living in the bar would vanish with the bar that reported it.
 *
 * One field holds all of them, so there is a single lifetime to reason about:
 * the app says one thing at a time, and the next gesture replaces it.
 */
export type RowNotice = { at: "row"; id: Id; message: string };

export type BulkNotice =
  | { at: "bulk"; said: "refused"; message: string }
  | { at: "bulk"; said: "marked"; converted: number; skipped: readonly SkippedEntry[] }
  | { at: "bulk"; said: "suggestionsApplied"; applied: number }
  | { at: "bulk"; said: "ruleCreated"; pattern: string; categoryId: Id };

export type Notice = RowNotice | BulkNotice;

export interface WorklistState {
  filter: TransactionFilter;
  page: number;
  selected: ReadonlySet<Id>;
  openRow: OpenRow | null;
  notice: Notice | null;
  ruleOffer: RuleOffer | null;
}

/** What a gesture needs: the Vault on screen, and the one way to write to it. */
export interface WorklistDeps {
  vault: Vault;
  run: RunCommand;
}

/** An empty Worklist: no filter, no selection, nothing open, nothing said. */
export const emptyWorklist: WorklistState = {
  filter: NO_FILTER,
  page: 0,
  selected: new Set(),
  openRow: null,
  notice: null,
  ruleOffer: null,
};

/**
 * A gesture that has to answer the form that triggered it — a refused edit
 * keeps its form open with the message showing, which only the form can do.
 */
export interface Answered<R> {
  state: WorklistState;
  result: R;
}

function refused(message: string): BulkNotice {
  return { at: "bulk", said: "refused", message };
}

/** The selection without one row: what a gesture that removed it leaves behind. */
function without(selected: ReadonlySet<Id>, id: Id): ReadonlySet<Id> {
  if (!selected.has(id)) return selected;
  const next = new Set(selected);
  next.delete(id);
  return next;
}

// --- Filter, page, selection ----------------------------------------------

/**
 * A new filter is a new result set, so the page the user was on no longer
 * means anything — and neither does the selection. Keeping a selection the
 * user can no longer see is how someone classifies 500 Transactions they
 * were not looking at. An open form goes too: one the user can no longer see
 * is a change they can neither finish nor abandon.
 *
 * This is the transition that resets everything at once, which is why the
 * whole state lives in one place: eight `useState` calls could only ever be
 * reset by remembering all eight.
 */
export function changeFilter(
  _state: WorklistState,
  _deps: WorklistDeps,
  filter: TransactionFilter,
): WorklistState {
  return { ...emptyWorklist, filter };
}

export function goToPage(
  state: WorklistState,
  _deps: WorklistDeps,
  page: number,
): WorklistState {
  return { ...state, page };
}

export function toggleSelected(
  state: WorklistState,
  _deps: WorklistDeps,
  id: Id,
): WorklistState {
  const next = new Set(state.selected);
  if (!next.delete(id)) next.add(id);
  return { ...state, selected: next };
}

/**
 * Select every Transaction the filter matches, or none of them.
 *
 * The whole result set, not the visible page: that is what makes classifying a
 * Statement one decision instead of twelve. Transfers are left out — they
 * carry no Category, so they are never selectable for classification.
 */
export function toggleAll(state: WorklistState, deps: WorklistDeps): WorklistState {
  const ids = selectableIdsOf(deps.vault, state.filter);
  const allSelected = ids.length > 0 && ids.every((id) => state.selected.has(id));
  return { ...state, selected: allSelected ? new Set() : new Set(ids) };
}

export function clearSelection(state: WorklistState): WorklistState {
  return { ...state, selected: new Set() };
}

// --- Which row has a form open --------------------------------------------

/** Open one row's form. Whatever else was open closes, by construction. */
export function openRow(
  state: WorklistState,
  _deps: WorklistDeps,
  id: Id,
  mode: RowMode,
): WorklistState {
  // Whatever the app last said was about the state this form replaces — a
  // refusal on this row, or what the previous gesture did.
  return { ...state, openRow: { id, mode }, notice: null };
}

export function closeRow(state: WorklistState): WorklistState {
  return { ...state, openRow: null };
}

export function declineRuleOffer(state: WorklistState): WorklistState {
  return { ...state, ruleOffer: null };
}

// --- Gestures on the whole selection --------------------------------------

/**
 * One Category onto everything selected — the only practical way to classify a
 * Statement's worth of imported entries.
 *
 * The selection is read for its descriptions *before* the write, because they
 * are what an offered Rule is guessed from, and the gesture then empties it. A
 * refused or empty classification taught the app nothing, so only real work
 * earns an offer. The offer stays on this bulk path alone (ADR-0011).
 */
export function classifySelected(
  state: WorklistState,
  deps: WorklistDeps,
  categoryId: Id,
): WorklistState {
  const descriptions = selectedDescriptions(deps.vault, state.selected);
  const result = deps.run(classifyAs([...state.selected], categoryId));
  if (!result.ok) return { ...state, notice: refused(result.message) };
  return {
    ...state,
    selected: new Set(),
    notice: null,
    ruleOffer:
      result.changed > 0 ? ruleOfferFor(deps.vault, descriptions, categoryId) : null,
  };
}

export function acceptRuleOffer(
  state: WorklistState,
  deps: WorklistDeps,
  pattern: string,
): WorklistState {
  const offer = state.ruleOffer;
  if (offer === null) return state;
  const outcome = deps.run(addRule({ pattern, categoryId: offer.categoryId }));
  return {
    ...state,
    ruleOffer: null,
    notice: outcome.ok
      ? { at: "bulk", said: "ruleCreated", pattern, categoryId: offer.categoryId }
      : refused(outcome.message),
  };
}

/**
 * Mark the whole selection against one other Account.
 *
 * Every skip is carried back, not just counted: a batch chosen by description
 * can sweep in an entry that cannot convert, and a count alone would leave the
 * user believing their whole selection moved.
 */
export function markSelected(
  state: WorklistState,
  deps: WorklistDeps,
  otherAccountId: Id,
): WorklistState {
  const result = deps.run(markAllAsTransfers([...state.selected], otherAccountId));
  if (!result.ok) return { ...state, notice: refused(result.message) };
  return {
    ...state,
    selected: new Set(),
    notice: {
      at: "bulk",
      said: "marked",
      converted: result.converted,
      skipped: result.skipped,
    },
  };
}

export function applyAllSuggestions(
  state: WorklistState,
  deps: WorklistDeps,
): WorklistState {
  const outcome = deps.run(applySuggestions());
  return {
    ...state,
    notice: outcome.ok
      ? { at: "bulk", said: "suggestionsApplied", applied: outcome.applied }
      : refused(outcome.message),
  };
}

// --- Gestures on one row --------------------------------------------------

/**
 * Delete the row whose confirmation is open.
 *
 * The deleted row leaves the selection with it. Without that, the bar counted
 * a Transaction that no longer existed and the next bulk marking passed the
 * dead id along, to have it reported back as skipped.
 */
export function deleteRow(
  state: WorklistState,
  deps: WorklistDeps,
  id: Id,
): WorklistState {
  const result = deps.run(deleteTransaction(id));
  return {
    ...state,
    openRow: null,
    // A refused delete left the row where it was, so it is still selectable.
    selected: result.ok ? without(state.selected, id) : state.selected,
    notice: result.ok ? null : { at: "row", id, message: result.message },
  };
}

/** Save one row's edit. A refusal keeps the form open to show it. */
export function saveRowEdit(
  state: WorklistState,
  deps: WorklistDeps,
  id: Id,
  changes: TransactionEdit,
): Answered<ActionResult> {
  const result = deps.run(editTransaction(id, changes));
  // An edit can swap Income and Expense but never reach a Transfer, so the row
  // stays as selectable as it was.
  return { state: result.ok ? { ...state, openRow: null } : state, result };
}

/**
 * Mark one row as a Transfer. The entry is replaced by the Transfer under its
 * own id, and a Transfer carries no Category — so it stops being selectable,
 * and the selection lets go of it.
 */
export function markRow(
  state: WorklistState,
  deps: WorklistDeps,
  id: Id,
  otherAccountId: Id,
): Answered<ActionResult> {
  const result = deps.run(markAsTransfer(id, otherAccountId));
  if (!result.ok) return { state, result };
  return {
    state: { ...state, openRow: null, selected: without(state.selected, id) },
    result,
  };
}

/** Classify one row from its own select, which has no form to report into. */
export function classifyRow(
  state: WorklistState,
  deps: WorklistDeps,
  id: Id,
  categoryId: Id,
): WorklistState {
  const result = deps.run(classifyAs([id], categoryId));
  return {
    ...state,
    notice: result.ok ? null : { at: "row", id, message: result.message },
  };
}

/**
 * Accept the Suggestion offered on one row, through the same write classifying
 * by hand uses. A Suggestion is already read off the user's own habits
 * (ADR-0008), so accepting one offers no Rule: that would offer the same thing
 * twice.
 */
export function acceptSuggestion(
  state: WorklistState,
  deps: WorklistDeps,
  id: Id,
): WorklistState {
  const suggestion = suggestCategories(deps.vault).find((s) => s.transactionId === id);
  if (suggestion === undefined) return state;
  return classifyRow(state, deps, id, suggestion.categoryId);
}

/** Turn a Transfer back into the single imported entry it was recovered from. */
export function undoRowMarking(
  state: WorklistState,
  deps: WorklistDeps,
  id: Id,
): WorklistState {
  const result = deps.run(undoMarking(id));
  return {
    ...state,
    notice: result.ok ? null : { at: "row", id, message: result.message },
  };
}
