# ADR-0006: Transfers are recovered after import, never inferred during it

## Status

Accepted.

## Context

A Transfer moves money between two of the user's own Accounts. It carries no Category and never counts as Income or Expense, so it stays out of every Category total and Budget. That is the whole reason the kind exists: a credit-card payment, a move to savings or a transfer between two of the user's banks is neither spending nor earning.

An Import cannot produce one. `toTransactions` decides the kind from the sign alone — negative becomes an Expense, anything else an Income — and that is not a shortcoming of the implementation. **A Statement describes exactly one Account.** The bank exporting it knows that R$ 2.000 left on the 5th; it has no way to say, and no interest in saying, that the money arrived in an account at another institution that the user also happens to own. The other side of the move is either in a different Statement entirely or nowhere at all.

The consequence is measurable. In the user's real vault, 572 imported Transactions total R$ 183.169,86 of Income against R$ 183.269,86 of Expense, with 187 of the 572 descriptions matching "pix". Those near-identical totals are largely the same money counted twice — once leaving, once arriving. Monthly totals, the Dashboard's income-vs-expense chart, Budget meters and any weekly view are all wrong by whatever the user moves between their own Accounts, and no amount of careful classification fixes it, because the *kind* is wrong rather than the Category.

So something has to identify Transfers. The question is what, and when.

## Decision

**Transfer identification happens after the fact, as a user judgement the app assists, and never as an inference at import time.**

Concretely:

- `planImport` and `toTransactions` are unchanged. An Import keeps producing Uncategorized Income and Expense from the sign, and never a Transfer. Dedup and sign handling stay exactly as they were, and separately testable.
- The app may *suggest* candidate pairs — an Expense and an Income of the same amount, on different Accounts, a few days apart — but a suggestion is data for the user to accept or dismiss. Nothing is converted without them saying so, one pair at a time.
- Where only one side was ever imported, the user names the other Account by hand.
- Conversion **replaces**: the source Transactions are removed and one Transfer is added, so both Account balances are unchanged and the money simply stops counting as Income or Expense.
- A Transfer records the imported entries it was recovered from (`recoveredFrom`: a bank FITID and the Account it was on, per side). This is a schema change, v2 → v3.

## Consequences

**The numbers can become true.** This is the only mechanism by which the app's totals can stop double-counting internal movement, which makes it a prerequisite for any shorter reporting period: weekly figures are monthly figures over a narrower window, so reporting weekly before this lands would state the same error more precisely.

**`recoveredFrom` is load-bearing and invisible.** The entries a conversion removes are gone, so their FITIDs would look new on the next import of the same Statement, and the conversion would silently undo itself. `planImport` therefore dedups against a Transfer's recorded entries as well as the FITIDs on Income and Expense. Nothing in the UI shows this field; it is pinned by a regression test instead.

**A hand-entered Transfer records nothing, and that is correct** — it never came from a Statement. It also means such a Transfer cannot be reversed into an Income and an Expense, because there is nothing to reverse to.

**The user carries the judgement, and that is deliberate.** Two unrelated payments of the same amount a day apart look exactly like a transfer. An app that converted them automatically would quietly merge two real expenses into one non-event, which is a worse error than the double-counting it set out to fix, and a harder one to notice. Requiring acceptance makes the app's guess auditable. The cost is that a vault with many internal moves takes real work to clean up, and dismissals have to be remembered so the same rejected suggestion does not come back on every launch.

**Unequal amounts stay manual.** A transfer that arrived with a fee deducted is not a candidate. Matching across a tolerance would widen the suggestion set faster than it would help.

## Alternatives considered

**Infer Transfers during import, from the description.** Brazilian statements do often say `TRANSFERENCIA` or `PIX ENVIADO`. But the description says the money moved, not that both ends belong to the user — a PIX to a landlord reads the same as a PIX to one's own savings. This would misclassify real spending as internal movement, which is exactly the error that is hardest to spot, since the money just disappears from every total. Description matching is the right tool for Categories (where a wrong guess is visible and correctable) and the wrong one for kinds.

**Match pairs automatically and silently.** Rejected for the reason above: same-amount coincidences are common, and an automatic merge destroys two Transactions without anybody deciding to.

**Model a Transfer as a link between two retained Transactions** rather than replacing them. This keeps the audit trail, but then the Income and the Expense still exist and every report has to know to exclude linked pairs. That pushes the complexity into every reader, forever, and the first report that forgets is wrong in a way nobody notices. Replacing puts the correctness in one place.

**Ask the bank.** Out of scope by ADR-0004: the app reads Statements and never connects to a bank.

## Related

- ADR-0002 (plain JSON files as the vault format) — v3 is a read-time migration like the ones before it.
- ADR-0004 (statement import, not live aggregation) — the constraint this ADR follows from.
- ADR-0005 (Uncategorized is `null`) — a reversed Transfer comes back Uncategorized.
