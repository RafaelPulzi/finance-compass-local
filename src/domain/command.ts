import type { Id, Vault } from "./types";

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
 * what pair-accept needs, since it removes two Transactions and adds one under
 * a new id.
 */
export type CommandOutcome<R extends object = Record<never, never>> =
  | ({ ok: true; vault: Vault } & R)
  | { ok: false; message: string };

/** Why a command would not run. The caller shows it; nothing was written. */
export type Refusal = { ok: false; message: string };

/**
 * What a command needs from the session and may not reach for itself: fresh
 * ids and the clock. Bound once, where `run` lives, so every command stays
 * pure and every test can hand in a fixed one.
 */
export interface SessionContext {
  newId: () => Id;
  /** The current moment as an ISO timestamp. */
  now: () => string;
}

/**
 * A Vault write ready to run: the user's input already bound, only the Vault
 * and the session pending. Domain modules export *builders* — `classifyAs(ids,
 * categoryId)` returns one of these — and the store's `run` is the only caller
 * that ever supplies the second argument.
 */
export type VaultCommand<R extends object = Record<never, never>> = (
  vault: Vault,
  ctx: SessionContext,
) => CommandOutcome<R>;

/**
 * What `run` hands back: the Command's own outcome with the `vault` removed.
 * What the UI gets to know travels through the report, never the model.
 *
 * Written as a distributive conditional over the outcome rather than as
 * `{ ok: true } & R`, because a type parameter inside an intersection is one
 * TypeScript cannot infer: `run` would hand every caller back the bare
 * `{ ok: true }` and the reports would be invisible.
 */
export type CommandResult<O> = O extends { ok: true; vault: Vault }
  ? Omit<O, "vault">
  : O;

/** Outcome of an action the domain may refuse, reported back to the UI that asked. */
export type ActionResult = { ok: true } | Refusal;
