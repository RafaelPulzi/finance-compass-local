import { suggestCategories } from "../domain/categorySuggestions";
import type { CategorySuggestion } from "../domain/categorySuggestions";
import { selectedKind } from "../domain/selection";
import { selectTransactions, uncategorizedCount } from "../domain/transactionQuery";
import type { TransactionFilter, TransactionSelection } from "../domain/transactionQuery";
import type { Id, Transaction, Vault } from "../domain/types";
import type { WorklistState } from "./worklist";

/**
 * What the Worklist shows, derived from the Vault and the state — never stored.
 *
 * Which page is really being looked at, which rows are on it and which of them
 * can be selected are all answers to "what is on screen", and they are read
 * off the same two values every time. The panel used to compute them inline,
 * one `useMemo` at a time, which is why "the count is the filter's result set,
 * not the visible page" had to be re-established by hand in three places.
 *
 * Every judgement about Transactions themselves stays in the domain:
 * `selectTransactions`, `selectedKind` and `suggestCategories` are consulted
 * here, never reimplemented.
 */

/**
 * How many Transactions one page of the list shows. A Vault holding a couple of
 * years of imported Statements runs to several hundred, which is well within
 * what the DOM handles in pages — no windowing library earns its place here.
 */
export const PAGE_SIZE = 50;

export interface WorklistView {
  /** The filter's whole result set: the rows, the count and the totals. */
  selection: TransactionSelection;
  /** The Transactions on the page actually being shown. */
  rows: readonly Transaction[];
  /** The page being shown, which is not always the page that was asked for. */
  page: number;
  pageCount: number;
  /** Every Transaction the filter matches that could be classified. */
  selectableIds: readonly Id[];
  allSelected: boolean;
  /** The selection's shared kind, "mixed", or null when nothing is selected. */
  kindOfSelection: "income" | "expense" | "mixed" | null;
  /** The Suggestion offered on each Uncategorized row, by Transaction id. */
  suggestionFor: ReadonlyMap<Id, CategorySuggestion>;
  /** How many Transactions in the whole Vault still have no Category. */
  pendingCategories: number;
}

/**
 * Which of the filter's matches can be selected.
 *
 * Its own function because `toggleAll` needs exactly this and nothing else:
 * selecting every match must mean the same set the select-all control counts.
 */
export function selectableIdsOf(vault: Vault, filter: TransactionFilter): Id[] {
  return selectTransactions(vault, filter)
    .transactions.filter((tx) => tx.kind !== "transfer")
    .map((tx) => tx.id);
}

export function worklistView(state: WorklistState, vault: Vault): WorklistView {
  const selection = selectTransactions(vault, state.filter);

  const pageCount = Math.max(1, Math.ceil(selection.count / PAGE_SIZE));
  // Classifying or deleting can shrink the result out from under the page
  // being viewed, so the page asked for is clamped rather than trusted.
  const page = Math.min(state.page, pageCount - 1);
  const rows = selection.transactions.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const selectableIds = selection.transactions
    .filter((tx) => tx.kind !== "transfer")
    .map((tx) => tx.id);

  return {
    selection,
    rows,
    page,
    pageCount,
    selectableIds,
    allSelected:
      selectableIds.length > 0 && selectableIds.every((id) => state.selected.has(id)),
    kindOfSelection: selectedKind(vault, state.selected),
    suggestionFor: new Map(suggestCategories(vault).map((s) => [s.transactionId, s])),
    pendingCategories: uncategorizedCount(vault),
  };
}
