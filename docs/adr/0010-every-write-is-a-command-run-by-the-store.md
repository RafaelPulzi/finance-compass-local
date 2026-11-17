# Every write is a Command, and the store runs them through one `run`

The store used to carry a named method per write — `addIncome`, `setTransactionCategoryMany`, `commitImport`, 34 of them — each one a single line handing its arguments to a domain function. The interface grew with every feature and paid for nothing: a new write meant editing the domain, then the `VaultState` type, then the implementation object, and the type had to restate by hand what the domain function already said.

**A Command is the unit of writing.** A domain module exports a builder that binds the user's input and returns the pure decision: `classifyAs(ids, categoryId)` gives back a `VaultCommand`, and `(vault, ctx) => CommandOutcome` is run later, by the store, against the Vault on screen. The store's interface is now state (`vault`, `status`, `saveError`, `vaultDir`), the vault lifecycle (`init`, `openVaultAt`, `moveVaultTo`, `retrySave`, `chooseVaultFolder`) and exactly one way to write: `run(command)`. **A new feature adds a Command to the domain and the store's interface does not grow.**

**`run` is where the three write invariants are true once instead of once per action**: a refusal writes nothing, the same Vault back means no save (an empty save would still rewrite every file), and one Command is one mutation and therefore one save, whatever it touched. That was already the case before this — `run` existed, wrapped in the 34 methods — and removing the wrappers is what makes it the *only* path and lets the contract be tested once against any Command.

**The Command's own outcome reaches the caller, with the Vault removed.** Some wrappers used to return `void` (`setTransactionCategory`, `deleteTransaction`) or flatten a refusal into zeros (`applyRulesToUncategorized`, `commitImport`), so a domain verdict could be dropped on the floor: the Transactions page offered to remember a Rule after a classification that had in fact been refused. What the UI gets to know travels through the report, never the model.

**Ids and the clock are one `SessionContext`, injected by `run`.** There were five shapes for the same dependency (`makeId`, `newId`, a ready-made `id`, `ImportContext`, `WishDeps`), each of which the store had to know. Commands stay pure — they are handed `{ newId, now }` and never reach for either — so every test can hand in a fixed one, and the real binding exists in a single place.

## Consequences

- Panels import Commands from the domain and call `const run = useVault((s) => s.run)`. There is no per-feature hook layer, and a panel that wants a verdict reads the returned report.
- Domain tests call the Command as `classifyAs(ids, categoryId)(vault, ctx)`, which standardises the ids/clock fake across them as a side effect.
- `ActionResult`, `Refusal` and the bulk-marking outcome live in `domain/command.ts`, not the store: they describe what a Command answered, not what the store's interface is.
- `CommandResult` is written as a distributive conditional over the outcome rather than `{ ok: true } & R`, because TypeScript cannot infer a type parameter out of an intersection — written the obvious way, every caller is handed a bare `{ ok: true }` and the reports go invisible.
- `useVault.test.ts` lost roughly 1,275 lines that re-asserted domain behaviour per action. What it tests now is the store's own surface, plus one generic suite for the contract of `run`. Two commands that had only ever been reached through the store — `applyRulesToUncategorized` and `commitImport` — got domain tests of their own on the way, rather than losing their coverage.
- `addIncome`/`addExpense`/`addTransfer` are gone: `addTransaction` takes the kind in its input, which is what the domain had already decided (`transactionCreate.ts`) and the store had been undoing. Likewise `setTransactionCategory`/`setTransactionCategoryMany` collapse into `classifyAs`.
- The store's save chain, the `init` guard and `saveError` (ADR-0007) are untouched: they are the store's own invariants and stay where they were.
