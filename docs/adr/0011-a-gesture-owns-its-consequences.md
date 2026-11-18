# A gesture owns its consequences, and page state is one machine

The Transactions page held eight pieces of its own state in eight `useState` calls — the filter, the page, the selection, three row ids, a row error, a bulk notice and a Rule offer — and every click had to remember the rest of what it meant. Most of them did not.

**Selecting two rows and deleting one left the deleted id in the selection.** `setSelected` was never called on the row-level delete or the single-row marking, so the bar counted a Transaction that no longer existed, and the next bulk marking passed the dead id to the domain and reported it back to the user as skipped: *"1 ignorado: Transação não encontrada."* Nothing was wrong with the domain, the store or the Command. The consequence of a gesture simply lived at its call site, and one call site forgot.

**A gesture owns its consequences.** `src/worklist/` holds one function per gesture, and that function does the whole of what the gesture means: run the Command, close the row form, drop the rows that have just left the selection, record the outcome. A call site cannot forget what it no longer has to remember. "Delete this row" is one function with one test, not a `run` here and a `setSelected` the author has to think of there.

**Page state is a pure machine, not N `useState`.** `WorklistState { filter, page, selected, openRow, notice, ruleOffer }` moves through `(state, deps, …) → next state`, with no React in sight; `useWorklist` is twenty lines of `useState` and the store's `run`. Two things follow from that shape rather than from discipline:

- **One `openRow`, not three ids.** `editingId`/`deletingId`/`markingId` made "two rows open at once" representable, and the hand-rolled mutual exclusion that kept it from happening was inconsistent — `startMarking` cleared the row error, the other two did not. One field of `{ id, mode }` makes the invariant structural.
- **One `notice`, not two with different lifetimes.** A row-level refusal and a bulk message were separate fields cleared on different occasions. One field means one lifetime: the app says one thing at a time, and the next gesture replaces it.

**Page state is not domain state, which is why this is not in `src/domain/`.** Which rows are selected and which form is open are facts about a screen. Nothing here is persisted and nothing here decides anything about money: every judgement about Transactions themselves — `selectedKind`, `markingPreview`, `suggestCategories`, `ruleOfferFor`, `selectTransactions` — is consulted from the domain, never reimplemented.

**Outcomes are structured; the words are the panel's.** The module reports `{ converted, skipped }` and `{ applied }`, and `TransactionsPanel` turns them into Portuguese. A refusal is the exception: it travels as the domain's own message, because the domain wrote the sentence. This keeps the module's tests off the strings and keeps pluralisation and formatting where every other piece of Portuguese in the app lives.

**The Rule offer stays on the bulk path, now as a decision rather than an accident.** Bulk classification means the user applied the same judgement to N descriptions at once, which is the evidence that a Rule is worth writing. One row is weak evidence and an offer there would nag on every click. Accepting a Suggestion is already the habit machinery (ADR-0008: a Rule is what the user wrote, a Suggestion is read off what they did), so offering a Rule there would offer the same thing twice.

## Consequences

- `src/worklist/worklist.ts` is the state and the gestures, `view.ts` is what the page shows derived from the Vault and the state (which page is really being read, which rows, which of them can be selected), and `useWorklist.ts` is the wiring. `TransactionsPanel` renders and holds only the "nova transação" form, which is nobody's gesture on an existing row.
- The panel's test lost sixteen cases that asserted state rather than screen, at a jsdom render each. The Worklist's 42 tests run in about a second against plain values — no `renderHook`, no `act` — and the panel's test keeps what only a DOM can answer: labels, forms, child components and the Portuguese.
- `deleteTransaction` and `ruleOfferFor` had only ever been reached through the panel. They got domain tests of their own as that coverage moved down, rather than losing it.
- A gesture is handed `{ vault, run }` and is given no way to read the Vault back after writing (ADR-0010: the report travels, never the model). So a gesture prunes the selection by naming its own consequence — this row is gone, this one is a Transfer now — which is the thing it knows and the only thing it needs.
- A transition is called during the event and never inside a `setState` updater: it runs a Command, and React may invoke an updater twice.
- `run`'s type is exported from the store as `RunCommand`, so a module can be handed the one way to write without being handed the store.
- The store, the Commands and the domain are untouched. This was never a write-path problem.
