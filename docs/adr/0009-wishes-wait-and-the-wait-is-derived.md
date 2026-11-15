# Wishes wait before they may be bought, and the wait is derived

A Wish is something the user wants to buy but has agreed to wait for first — the classic anti-impulse rules: **48 hours for a cheaper item, 30 days for an expensive one**. Three decisions about it are load-bearing enough to record.

**Buying is refused until the wait is over, in the domain, not just hidden in the UI.** The refusal is the feature: a waiting period that a button could bypass is a suggestion, not a rule. Like every other invariant in this app (a Rule never overrules a hand-set Category, an edit cannot lose a `fitid`), the place it holds is the domain command — `buyWish` says no and names the moment it will say yes. Giving a Wish up (`dropWish`) is allowed at any moment: the wait exists to slow spending down, never to slow giving it up.

**The threshold is R$ 500,00, and it lives in one place.** `THIRTY_DAY_THRESHOLD` in `domain/wishes.ts` is the first price that counts as expensive. The number is a judgement call, not a law of nature; changing it is editing one constant, and an existing Wish is re-judged by the same rule on every read, because —

**The wait is derived from `price` and `createdAt`, never stored.** The same posture as Account balances: a Wish stores what the user told us (the item, its price, when they wanted it) and the deadline is computed from that. There is no stored deadline to drift, to migrate, or for a bug to shorten. It also means there is deliberately no way to edit a Wish's price: lowering it would shorten the wait, which is the exploit the feature exists to prevent. A mistyped Wish is dropped and re-added, and the wait honestly starts over.

## Consequences

- A Wish is append-then-decide: `addWish` → (`buyWish` | `dropWish`), each decision final. `deleteWish` only prunes *decided* history; an open Wish is dropped, not erased, so the list cannot be quietly emptied to dodge a wait.
- Buying a Wish records a decision, it does not create an Expense. The actual purchase arrives later, through a Statement like every other real-world expense (ADR-0004); creating one here would double it.
- The dropped Wishes' prices sum to "money you did not spend", which the panel shows — the positive half of the feature, and it costs nothing because the history is kept.
- `wishes` is a new Vault collection (`wishes.json`), schema v5. A v4 vault migrates by reading the absent file as an empty list, like every version before it.
