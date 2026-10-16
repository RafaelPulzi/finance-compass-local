# Plain JSON files as the vault format

The Vault stores data as a few plain **JSON files** (e.g. `accounts.json`, `transactions.json`, `categories.json`, `budgets.json`) in the user's folder, rather than a SQLite database. This keeps the data human-readable, diffable, and git/Dropbox-friendly — true to the Obsidian "you own your files" philosophy — and stays trivial to parse at personal scale (even tens of thousands of transactions is a small file).

## Consequences

- We give up SQL querying and transactional writes; the app loads the model into memory on vault open and writes files back (debounced). Acceptable at single-user personal scale.
- If a vault ever outgrows whole-file writes, we can split transactions by year/month without changing the JSON-is-the-format decision.
