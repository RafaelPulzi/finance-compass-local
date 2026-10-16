# Statement import, not live bank aggregation

Users get "real data" from their cards by importing a **Statement** file (OFX first) that they export from their own bank, which Finance Compass parses into Transactions. We deliberately **do not** connect live to banks/cards.

## Why the explicit "no"

Live aggregation in Brazil means Open Finance via a licensed aggregator (Pluggy, Belvo, …), which requires API keys and a **client secret a desktop app cannot safely hold**, OAuth consent flows needing a registered redirect, and therefore **a backend plus a third-party dependency, recurring cost, and custody of users' banking consent**. That is the opposite of the local-first, no-backend, "data stays on your desktop" vault this project is built on. Statement import delivers real card/bank data while staying 100% local and credential-free.

## Consequences

- No internet dependency and no credentials in v1; import is a manual, offline step.
- If live sync is ever wanted, it is a separate project that reopens the no-backend decision with eyes open — not a small addition.
- CSV import and auto-categorization are deferred, separate features layered on this same import path.
