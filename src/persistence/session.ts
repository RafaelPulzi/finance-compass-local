import type { Vault } from "../domain/types";
import {
  type VaultFolderPick,
  type VaultRepository,
  createVaultRepositoryAt,
  inspectVaultFolder,
} from "./repository";

/**
 * The session: which repository saves go to, and the queue that keeps them
 * from overlapping.
 *
 * A Tauri vault is several JSON files written one after another, so two
 * overlapping saves interleave their writes and tear the vault (groups.json
 * from one state, categories.json from another). That is the *adapter's*
 * invariant, and this module is where it is enforced — the store used to hold
 * the chain and the bound repository itself, which meant the thing whose
 * correctness depended on serialization trusted its caller to provide it.
 *
 * Chaining makes each save finish before the next starts; every save writes
 * the whole state, so the last one to run leaves the vault correct.
 */

let target: VaultRepository | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** The repository saves currently go to, or null before the session starts. */
export function boundRepository(): VaultRepository | null {
  return target;
}

/** Point the session's saves at `repo` (the result of opening or seeding a vault). */
export function bindRepository(repo: VaultRepository): void {
  target = repo;
}

/**
 * Queue a save of `vault`. `report` hears how it went — null on success, the
 * error otherwise — which is how a failure reaches the screen instead of
 * vanishing into the chain.
 */
export function queueSave(
  vault: Vault,
  report?: (error: unknown) => void,
): Promise<void> {
  // Bind the save to the repository that was current when the change was made.
  // Reading `target` when the chain later runs would send a change meant for
  // the old folder to a vault the user has since opened somewhere else.
  const to = target;
  const run = chain
    // A failed save must not break the chain for every save after it.
    .catch(() => undefined)
    .then(() => to?.save(vault));
  chain = run;
  // Attaching the handlers here also keeps a failure from surfacing as an
  // unhandled rejection: it has been dealt with by reporting it.
  run.then(
    () => report?.(null),
    (error: unknown) => report?.(error),
  );
  return run as Promise<void>;
}

/**
 * Attach the session to another vault folder. `take` decides what the vault
 * there should be — loaded from it, or the current one written into it.
 *
 * Order matters: queued saves finish against the old folder first, and
 * everything that can fail happens before the swap, so a failed switch leaves
 * the session exactly where it was, still attached to a working folder. The
 * remembered path is written before the swap too, so the running app and the
 * next launch can never disagree about which folder is in use. Throws on
 * failure; the caller turns that into its own report.
 */
export async function attachTo(
  dir: string,
  take: (repo: VaultRepository) => Promise<Vault>,
): Promise<{ repo: VaultRepository; vault: Vault }> {
  await chain.catch(() => undefined);

  const repo = await createVaultRepositoryAt(dir, { mustExist: true });
  const vault = await take(repo);

  const { rememberVaultDir } = await import("./vaultLocation");
  await rememberVaultDir(dir);

  target = repo;
  return { repo, vault };
}

/** Ask the user for a folder and say whether it holds a vault; null if they cancelled. */
export async function promptForFolder(): Promise<VaultFolderPick | null> {
  const { promptForVaultFolder } = await import("./vaultLocation");
  const dir = await promptForVaultFolder();
  if (dir === null) return null;
  return inspectVaultFolder(dir);
}

/** Test seam: drop the session so a fresh store starts from nothing. */
export function resetSession(): void {
  target = null;
  chain = Promise.resolve();
}
