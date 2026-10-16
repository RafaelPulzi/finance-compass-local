# Uncategorized is null, not a sentinel Category

Imported Transactions start with no Category (`categoryId: null`) rather than being assigned a built-in "Sem categoria" Category. "Uncategorized" is the *absence* of a classification, and modelling it as a real Category would put a row in the user's own category lists, make it selectable for manual entry, and let it be budgeted against or renamed as if it were a genuine spending category.

## Consequences

- `categoryId` is nullable on Income and Expense, so every reader must handle the unclassified case — which is the point: it stays visible instead of hiding behind a plausible-looking label.
- Budget and category totals ignore uncategorized Transactions automatically, since `null` matches no Category id. Money that is imported but not yet classified is therefore absent from category reports until the user classifies it.
- The UI surfaces the backlog explicitly (an "N sem categoria" count and an inline classifier per row) so that absence is actionable rather than silent.
