# Rules match normalised substrings, and only ever fill a gap

A Rule maps a description pattern to a Category. Two decisions about it are load-bearing enough to record.

**The pattern is a plain substring, matched against a normalised description — never a regular expression.** Both sides are lowercased and have their accents stripped (the normaliser the Transactions page's search already uses), so one Rule covers `IFOOD`, `Ifood` and `ifood`, and `ACAI` matches `Açaí`. A regular expression is more powerful and far more dangerous in a field a person types into: it fails silently, matches entries nobody predicted, and is unreadable six months later by the one person who has to maintain it. If substring matching proves too weak, widening it is a deliberate later decision, not a default we backed into.

**A Rule only ever classifies a Transaction whose `categoryId` is `null`.** Automation fills gaps; it never overrules a person. A Category the user set by hand is a decision, and nothing in this app may quietly replace it — not a Rule written later, not a Rule run again, not an Import.

## Consequences

- Applying Rules is idempotent, so "run my Rules over everything" is safe to repeat and needs no bookkeeping about what has already been seen.
- Editing a Rule does not reclassify anything. The Transactions it already classified keep their Categories; the user can re-run Rules, but only over Uncategorized ones. Reclassification would mean overruling decisions, including the app's own earlier ones, which is the invariant above.
- Order is priority: the first matching Rule in `Vault.rules` decides and the rest are skipped. Position is the array's own order rather than a stored number, so reordering cannot leave two Rules claiming one position, and the list reads as what it does.
- A Rule's kind is derived from its Category rather than stored independently, so a Rule can never be set to classify Expenses into an income Category.
- A Transaction records the Rule that classified it (`ruleId`), absent when the user classified it themselves. That is what makes a surprising Category traceable, and it is why deleting a Rule can safely leave classifications in place: a reference to a Rule that no longer exists reads as exactly that. Classifying by hand drops the reference, because the Rule is no longer the explanation.
- Patterns are matched, not compiled, so a pattern containing `*`, `.` or `(` is just text and needs no escaping anywhere.
