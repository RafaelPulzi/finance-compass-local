import type { Vault } from "./types";

/**
 * The one shape every Vault write has: the whole Vault the command would leave
 * behind (plus whatever it has to report), or why it refuses.
 *
 * Commands are pure — they decide, they never write. The store runs them
 * through a single `run()`, which is where "a refusal writes nothing", "one
 * action means one save" and "the same Vault back means no save" are true once
 * instead of once per action. Returning the *whole* Vault, rather than one
 * entity for the caller to splice in, is what lets a command touch several
 * collections in one mutation (an Import adds Transactions and a record) and
 * what a future pair-accept needs, since it removes two Transactions and adds
 * one under a new id.
 */
export type CommandOutcome<R extends object = Record<never, never>> =
  | ({ ok: true; vault: Vault } & R)
  | { ok: false; message: string };

/** A Vault write ready to run: input already bound, only the Vault pending. */
export type VaultCommand<R extends object = Record<never, never>> = (
  vault: Vault,
) => CommandOutcome<R>;
