# Vault files are replaced atomically, and a failed save is shown

A save writes the whole Vault as eight JSON files (ADR-0002). Each file is now written to a `.tmp` sibling and renamed over the real one, and `meta.json` — the marker that makes a folder a Vault — is written last. A save that fails is reported on screen until a later save succeeds, instead of being swallowed by the save chain.

Writing in place truncates the file before refilling it, so a crash or power cut in the middle of a save could leave `transactions.json` half-written: unparseable, and with it the whole Vault. A rename replaces the file in one step, so each file is always either its previous version or its new one. Before this, a failed save also left the change on screen with nothing on disk, and the user found out at the next launch.

## Consequences

- The shell needs `fs:allow-rename` on the Vault folder (`src-tauri/capabilities/default.json`); a folder the user picks is covered by the runtime scope `allow_vault_dir` adds. Removing that permission breaks every save — the desktop window, not the unit tests, is where that shows.
- Files are atomic one at a time, not as a set. A save interrupted between files can leave, say, `groups.json` from the new state and `categories.json` from the old. Every file still parses, and the next save rewrites all of them; a true all-or-nothing save would need a journal or a single-file format, which ADR-0002 rejected for readability.
- A `.tmp` file left by an interrupted save is ignored on load and overwritten by the next save.
- A corrupt file is refused by name ("O arquivo transactions.json do cofre está corrompido…") and nothing is written, so the user can restore that one file from a backup.
- `saveError` in the store holds the last failure; the shell shows it with a "Tentar salvar de novo" button. Any successful save clears it, because every save writes everything.

## Related: deletions are refused, never cascaded

Deleting a Category that Transactions or a Budget still use, a Group that still has Categories, or an Account that any Transaction touches is refused with the count of what still uses it (issue #10). Cascading would delete the user's classification work or history; silently resetting Transactions to Uncategorized would empty Category totals without anyone noticing. The one thing removed alongside an Account is its Import records, which describe Imports into that Account and hold no money.
