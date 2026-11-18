import { useMemo, useState } from "react";
import { useVault } from "../store/useVault";
import { worklistView } from "./view";
import * as worklist from "./worklist";
import type { Answered, WorklistDeps, WorklistState } from "./worklist";

/**
 * The Worklist in React: `useState`, the store's `run`, and nothing else.
 *
 * Every decision is a transition in `worklist.ts`, which is why this is the
 * whole of the wiring. A transition is called here, during the event, and
 * never inside a `setState` updater: a transition runs a Command, and React
 * may invoke an updater twice (StrictMode does), which would write twice.
 */

type Transition<A extends unknown[]> = (
  state: WorklistState,
  deps: WorklistDeps,
  ...args: A
) => WorklistState;

type Answering<A extends unknown[], R> = (
  state: WorklistState,
  deps: WorklistDeps,
  ...args: A
) => Answered<R>;

export function useWorklist() {
  const vault = useVault((s) => s.vault);
  const run = useVault((s) => s.run);
  const [state, setState] = useState(worklist.emptyWorklist);
  const deps: WorklistDeps = { vault, run };

  const apply =
    <A extends unknown[]>(transition: Transition<A>) =>
    (...args: A) =>
      setState(transition(state, deps, ...args));

  /** For the gestures a form is waiting on: the state moves, the result goes back. */
  const answer =
    <A extends unknown[], R>(transition: Answering<A, R>) =>
    (...args: A) => {
      const answered = transition(state, deps, ...args);
      setState(answered.state);
      return answered.result;
    };

  return {
    state,
    view: useMemo(() => worklistView(state, vault), [state, vault]),

    changeFilter: apply(worklist.changeFilter),
    goToPage: apply(worklist.goToPage),
    toggleSelected: apply(worklist.toggleSelected),
    toggleAll: apply(worklist.toggleAll),
    clearSelection: apply(worklist.clearSelection),
    openRow: apply(worklist.openRow),
    closeRow: apply(worklist.closeRow),

    classifySelected: apply(worklist.classifySelected),
    markSelected: apply(worklist.markSelected),
    applyAllSuggestions: apply(worklist.applyAllSuggestions),
    acceptRuleOffer: apply(worklist.acceptRuleOffer),
    declineRuleOffer: apply(worklist.declineRuleOffer),

    deleteRow: apply(worklist.deleteRow),
    classifyRow: apply(worklist.classifyRow),
    acceptSuggestion: apply(worklist.acceptSuggestion),
    undoRowMarking: apply(worklist.undoRowMarking),
    saveRowEdit: answer(worklist.saveRowEdit),
    markRow: answer(worklist.markRow),
  };
}
