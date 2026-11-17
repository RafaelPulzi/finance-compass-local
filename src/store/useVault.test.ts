import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAccount } from "../domain/accounts";
import { addCategory, addGroup } from "../domain/categories";
import type { VaultCommand } from "../domain/command";
import { centavos } from "../domain/money";
import type { Vault } from "../domain/types";
import { VAULT_COLLECTIONS, VAULT_SCHEMA_VERSION, emptyVault } from "../domain/types";

/**
 * What the store itself is answerable for: opening a vault, the save chain,
 * changing folders, reporting a failed save, and the contract of `run`.
 *
 * What each Command *decides* is the domain's business and is tested there,
 * against the Vault alone. This file used to re-assert "saves once", "writes
 * nothing", "writes to the files" for every action in turn; `run` makes those
 * three true once, so they are tested once, against any Command.
 *
 * The repositories here model the real Tauri vault: a folder per vault, each
 * collection a separate file, written one after another with awaits in between.
 * That is what makes two overlapping saves able to tear the vault, so the fake
 * has to reproduce it — an atomic fake would never catch the bug.
 */

const DEFAULT_DIR = "/app-data/vault";

/** One fake folder on disk: the files in it, written independently. */
interface FakeFolder {
  disk: Partial<Record<keyof Vault, unknown>>;
  /** Whether this folder holds a vault (i.e. meta.json exists). */
  hasVault: boolean;
}

const state = {
  saves: [] as { dir: string; vault: Vault }[],
  /** Overrides what the default folder's `load` returns, when set. */
  loadResult: null as Vault | null,
  loadCalls: 0,
  saveDelayMs: 0,
  inFlight: 0,
  maxInFlight: 0,
  saveCount: 0,
  /** Suspend the first save after this file is written, to force a deterministic overlap. */
  stallFirstSaveAfter: null as keyof Vault | null,
  releaseStall: null as (() => void) | null,
  folders: new Map<string, FakeFolder>(),
  /** What the folder dialog returns. */
  promptResult: null as string | null,
  /** The folder remembered for the next launch. */
  remembered: undefined as string | null | undefined,
  /** Suspend a folder switch just before it swaps repositories. */
  stallRemember: false,
  releaseRemember: null as (() => void) | null,
  /** When set, every save fails with this message (a full disk, a vanished drive). */
  failSaves: null as string | null,
};

function folder(dir: string): FakeFolder {
  let found = state.folders.get(dir);
  if (found === undefined) {
    found = { disk: {}, hasVault: false };
    state.folders.set(dir, found);
  }
  return found;
}

// The same table the real load/save iterate, so this fake can never fall a
// collection behind the schema.
const ENTITIES = VAULT_COLLECTIONS;

const yieldToOtherTasks = () => new Promise((r) => setTimeout(r, state.saveDelayMs));

/** Put a ready-made vault in a folder, as if a previous run had written it. */
function seedFolder(dir: string, vault: Vault): void {
  const f = folder(dir);
  f.hasVault = true;
  for (const key of ENTITIES) f.disk[key] = structuredClone(vault[key]);
  f.disk.schemaVersion = vault.schemaVersion;
}

/**
 * A Vault with some collections replaced. Built from `emptyVault` so it follows
 * the collection table rather than listing every collection by hand — a
 * hand-written fixture is how a fake falls a schema behind.
 */
function vaultWith(partial: Partial<Vault>): Vault {
  return { ...emptyVault(), ...partial };
}

function makeRepo(dir: string, parseVault: (raw: unknown) => Vault) {
  return {
    label: dir,
    dir,
    load: async (): Promise<Vault | null> => {
      state.loadCalls += 1;
      if (dir === DEFAULT_DIR && state.loadResult !== null) return state.loadResult;
      const f = folder(dir);
      if (!f.hasVault) return null;
      // Through the real parse, like every production adapter: migration and the
      // zero-Budget scrub happen on the way in or they are never exercised here.
      return parseVault({
        schemaVersion: f.disk.schemaVersion,
        ...Object.fromEntries(
          ENTITIES.map((key) => [key, structuredClone(f.disk[key] ?? [])]),
        ),
      });
    },
    save: async (vault: Vault): Promise<void> => {
      const f = folder(dir);
      if (state.failSaves !== null) {
        await yieldToOtherTasks();
        throw new Error(state.failSaves);
      }
      state.inFlight += 1;
      state.saveCount += 1;
      const isFirst = state.saveCount === 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      f.hasVault = true;
      f.disk.schemaVersion = vault.schemaVersion;
      // One file per collection, with a suspension point between each write.
      for (const key of ENTITIES) {
        f.disk[key] = structuredClone(vault[key]);
        if (isFirst && state.stallFirstSaveAfter === key) {
          await new Promise<void>((resolve) => {
            state.releaseStall = resolve;
          });
        }
        await yieldToOtherTasks();
      }
      state.saves.push({ dir, vault: structuredClone(vault) });
      state.inFlight -= 1;
    },
  };
}

vi.mock("../persistence/repository", async (importOriginal) => {
  // Only the three factories are faked. `parseVault` stays the real one, and the
  // fake adapters below go through it exactly as the Tauri adapter does.
  const actual = await importOriginal<typeof import("../persistence/repository")>();
  return {
    ...actual,
    isTauri: () => true,
    pickRepository: async () => makeRepo(DEFAULT_DIR, actual.parseVault),
    createVaultRepositoryAt: async (dir: string) => makeRepo(dir, actual.parseVault),
    inspectVaultFolder: async (dir: string) => ({ dir, hasVault: folder(dir).hasVault }),
  };
});

vi.mock("../persistence/vaultLocation", () => ({
  VAULT_MARKER: "meta.json",
  allowVaultDir: async () => undefined,
  folderHasVault: async (dir: string) => folder(dir).hasVault,
  promptForVaultFolder: async () => state.promptResult,
  rememberVaultDir: async (dir: string | null) => {
    if (state.stallRemember) {
      await new Promise<void>((resolve) => {
        state.releaseRemember = resolve;
      });
    }
    state.remembered = dir;
  },
}));

async function freshStore() {
  vi.resetModules();
  const mod = await import("./useVault");
  mod.resetVaultPersistence();
  return mod.useVault;
}

/** Everything a folder's files currently say. */
function diskOf(dir: string) {
  return folder(dir).disk;
}

/** An Account Command, as a stand-in for "any Command at all". */
const anAccount = (name: string) =>
  addAccount({ name, type: "checking", openingBalance: centavos(0) });

beforeEach(() => {
  state.saves = [];
  state.loadResult = null;
  state.loadCalls = 0;
  state.saveDelayMs = 0;
  state.inFlight = 0;
  state.maxInFlight = 0;
  state.saveCount = 0;
  state.stallFirstSaveAfter = null;
  state.releaseStall = null;
  state.folders = new Map();
  state.promptResult = null;
  state.remembered = undefined;
  state.stallRemember = false;
  state.releaseRemember = null;
  state.failSaves = null;
});

afterEach(async () => {
  // Every mutation queues a save, and a test that does not wait for its own
  // would leave it in flight — landing in the next test, which has already
  // reset these counters underneath it. Let whatever is suspended finish.
  state.failSaves = null;
  state.stallFirstSaveAfter = null;
  state.releaseStall?.();
  state.releaseRemember?.();
  await vi.waitFor(() => expect(state.inFlight).toBe(0));
});

describe("init", () => {
  it("seeds and saves only once when called twice (React StrictMode)", async () => {
    const useVault = await freshStore();
    // StrictMode invokes the effect twice; both calls start before either finishes.
    await Promise.all([useVault.getState().init(), useVault.getState().init()]);

    expect(state.saves).toHaveLength(1);
    expect(useVault.getState().status).toBe("ready");
  });

  it("writes a seed whose categories point at groups that exist", async () => {
    const useVault = await freshStore();
    await Promise.all([useVault.getState().init(), useVault.getState().init()]);
    await vi.waitFor(() => expect(state.inFlight).toBe(0));

    const groups = diskOf(DEFAULT_DIR).groups as { id: string }[];
    const categories = diskOf(DEFAULT_DIR).categories as { groupId: string }[];
    const groupIds = new Set(groups.map((g) => g.id));

    expect(categories.length).toBeGreaterThan(0);
    expect(categories.filter((c) => !groupIds.has(c.groupId))).toHaveLength(0);
  });

  it("does not re-seed when a vault already exists", async () => {
    const useVault = await freshStore();
    state.loadResult = vaultWith({});
    await useVault.getState().init();
    expect(state.saves).toHaveLength(0);
  });

  it("reports the folder the vault was opened from", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    expect(useVault.getState().vaultDir).toBe(DEFAULT_DIR);
  });

  it("opens a vault written by an older schema, upgraded on the way in", async () => {
    // A v4 vault: no Wishes collection at all, and a legacy "not budgeted" row
    // the current schema says is the absence of a Budget.
    const useVault = await freshStore();
    const f = folder(DEFAULT_DIR);
    f.hasVault = true;
    f.disk.schemaVersion = 4;
    f.disk.accounts = [
      { id: "acc", name: "Inter", type: "checking", openingBalance: 0 },
    ];
    f.disk.budgets = [{ id: "b-0", categoryId: "cat-gone", monthlyLimit: 0 }];

    await useVault.getState().init();

    const vault = useVault.getState().vault;
    expect(vault.schemaVersion).toBe(VAULT_SCHEMA_VERSION);
    expect(vault.wishes).toEqual([]);
    expect(vault.budgets).toEqual([]);
    expect(vault.accounts).toHaveLength(1);
  });
});

describe("the contract of run", () => {
  async function readyStore() {
    const useVault = await freshStore();
    seedFolder(DEFAULT_DIR, vaultWith({}));
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  it("applies the Vault a Command returns and saves it once, whatever the Command touched", async () => {
    const useVault = await readyStore();

    const result = useVault.getState().run(anAccount("Inter"));

    expect(result.ok).toBe(true);
    expect(useVault.getState().vault.accounts).toHaveLength(1);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    expect(diskOf(DEFAULT_DIR).accounts).toMatchObject([{ name: "Inter" }]);
  });

  it("hands the Command's own report back to the caller, minus the Vault", async () => {
    const useVault = await readyStore();

    const result = useVault.getState().run(anAccount("Inter"));

    if (!result.ok) throw new Error(result.message);
    expect(result.account).toMatchObject({ name: "Inter" });
    // What the UI gets to know travels through the report, never the model.
    expect(result).not.toHaveProperty("vault");
  });

  it("writes nothing when a Command refuses, and reports why", async () => {
    const useVault = await readyStore();
    useVault.getState().run(anAccount("Inter"));
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    const before = useVault.getState().vault;

    const refused = useVault.getState().run(anAccount("inter"));

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toMatch(/Já existe/);
    expect(useVault.getState().vault).toBe(before);
    await new Promise((r) => setTimeout(r, 5));
    expect(state.saves).toHaveLength(1);
  });

  it("saves nothing when a Command gives the same Vault back", async () => {
    const useVault = await readyStore();
    const before = useVault.getState().vault;
    // "Nothing to do" is an `ok` outcome carrying the Vault it was handed; an
    // empty save would still rewrite every file.
    const noop: VaultCommand = (vault) => ({ ok: true, vault });

    expect(useVault.getState().run(noop).ok).toBe(true);

    expect(useVault.getState().vault).toBe(before);
    await new Promise((r) => setTimeout(r, 5));
    expect(state.saves).toHaveLength(0);
  });

  it("runs a Command against the Vault on screen, so two in a row compose", async () => {
    const useVault = await readyStore();

    useVault.getState().run(anAccount("Primeira"));
    useVault.getState().run(anAccount("Segunda"));

    expect(useVault.getState().vault.accounts.map((a) => a.name)).toEqual([
      "Primeira",
      "Segunda",
    ]);
  });

  it("gives every Command the session's ids and clock", async () => {
    const useVault = await readyStore();
    let seen: { newId: string; now: string } | null = null;
    const peek: VaultCommand = (vault, ctx) => {
      seen = { newId: ctx.newId(), now: ctx.now() };
      return { ok: true, vault };
    };

    useVault.getState().run(peek);

    expect(seen).not.toBeNull();
    const ctx = seen as unknown as { newId: string; now: string };
    expect(ctx.newId).toMatch(/[0-9a-f-]{36}/);
    expect(Number.isNaN(Date.parse(ctx.now))).toBe(false);
  });
});

describe("persistence ordering", () => {
  it("never runs two saves at once, so multi-file writes cannot interleave", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    state.saveDelayMs = 5;
    state.saves = [];

    // Three mutations fired back to back, each triggering a save.
    useVault.getState().run(anAccount("A"));
    useVault.getState().run(anAccount("B"));
    useVault.getState().run(anAccount("C"));

    await vi.waitFor(() => expect(state.saves).toHaveLength(3));
    expect(state.maxInFlight).toBe(1);
  });

  it("leaves the files on disk agreeing with the final state, even if a save stalls mid-write", async () => {
    // The hazard the Tauri vault has and localStorage doesn't: a save is several
    // files written in sequence, so a second save starting while the first is
    // suspended overwrites some files and not others. Here the first save is
    // held after groups.json; without serialization the later write lands in
    // between and the files end up describing two different vaults.
    const useVault = await freshStore();
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));

    state.saveCount = 0; // the next save is the one to stall
    state.stallFirstSaveAfter = "groups";

    // Not a name the seed already has, which would be refused as a duplicate.
    const added = useVault.getState().run(addGroup({ name: "Projetos", kind: "expense" }));
    if (!added.ok) throw new Error(added.message);
    await vi.waitFor(() => expect(state.releaseStall).not.toBeNull());

    // A second mutation while the first save is suspended.
    useVault.getState().run(addCategory({ name: "Cinema", groupId: added.group.id }));
    await new Promise((r) => setTimeout(r, 5));
    state.releaseStall?.();

    await vi.waitFor(() => expect(state.inFlight).toBe(0));

    const finalVault = useVault.getState().vault;
    expect(diskOf(DEFAULT_DIR).groups).toEqual(finalVault.groups);
    expect(diskOf(DEFAULT_DIR).categories).toEqual(finalVault.categories);
  });

  it("persists the final state last", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    state.saveDelayMs = 5;
    state.saves = [];

    useVault.getState().run(anAccount("A"));
    useVault.getState().run(anAccount("B"));

    await vi.waitFor(() => expect(state.saves).toHaveLength(2));
    const last = state.saves[state.saves.length - 1];
    expect(last.vault.accounts.map((a) => a.name)).toEqual(["A", "B"]);
  });
});

describe("choosing a vault folder", () => {
  const OTHER = "/d/Financas";
  const EMPTY = "/d/Vazia";

  /** A vault that is recognisably not the seeded one. */
  const otherVault = vaultWith({
    accounts: [
      { id: "acc-other", name: "Conta do outro cofre", type: "checking", openingBalance: centavos(5000) },
    ],
  });

  it("returns null when the user cancels the dialog", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    state.promptResult = null;

    expect(await useVault.getState().chooseVaultFolder()).toBeNull();
  });

  it("reports whether the picked folder already holds a vault", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    seedFolder(OTHER, otherVault);

    state.promptResult = OTHER;
    expect(await useVault.getState().chooseVaultFolder()).toEqual({
      dir: OTHER,
      hasVault: true,
    });

    state.promptResult = EMPTY;
    expect(await useVault.getState().chooseVaultFolder()).toEqual({
      dir: EMPTY,
      hasVault: false,
    });
  });

  it("opens the vault stored in another folder and remembers it", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    seedFolder(OTHER, otherVault);

    expect(await useVault.getState().openVaultAt(OTHER)).toEqual({ ok: true });
    expect(useVault.getState().vault.accounts.map((a) => a.name)).toEqual([
      "Conta do outro cofre",
    ]);
    expect(useVault.getState().vaultDir).toBe(OTHER);
    expect(state.remembered).toBe(OTHER);
  });

  it("sends later changes to the newly opened folder, not the old one", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    seedFolder(OTHER, otherVault);
    await useVault.getState().openVaultAt(OTHER);
    state.saves = [];

    useVault.getState().run(anAccount("Nova"));

    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    expect(state.saves.map((s) => s.dir)).toEqual([OTHER]);
  });

  it("refuses a folder with no vault, staying on the current one", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    const before = useVault.getState().vault;

    const result = await useVault.getState().openVaultAt(EMPTY);
    expect(result.ok).toBe(false);
    expect(useVault.getState().vaultDir).toBe(DEFAULT_DIR);
    expect(useVault.getState().vault).toBe(before);
    expect(state.remembered).toBeUndefined();
  });

  it("writes the current vault into an empty folder and continues there", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    const moved = useVault.getState().vault;

    expect(await useVault.getState().moveVaultTo(EMPTY)).toEqual({ ok: true });
    expect(diskOf(EMPTY).accounts).toEqual(moved.accounts);
    expect(diskOf(EMPTY).categories).toEqual(moved.categories);
    expect(useVault.getState().vaultDir).toBe(EMPTY);
    expect(state.remembered).toBe(EMPTY);
  });

  it("refuses to overwrite a folder that already contains a vault", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    seedFolder(OTHER, otherVault);

    const result = await useVault.getState().moveVaultTo(OTHER);
    expect(result.ok).toBe(false);
    // The other vault's files are untouched.
    expect(diskOf(OTHER).accounts).toEqual(otherVault.accounts);
    expect(useVault.getState().vaultDir).toBe(DEFAULT_DIR);
  });

  it("does not write a change made during the switch into the vault being opened", async () => {
    // A save is queued against the folder that was open when the change was made.
    // If the queued save instead ran against whatever repository happened to be
    // current by the time the chain reached it, this change — which belongs to the
    // old vault — would overwrite the vault the user just opened.
    const useVault = await freshStore();
    await useVault.getState().init();
    seedFolder(OTHER, otherVault);
    await vi.waitFor(() => expect(state.inFlight).toBe(0));

    // Hold the switch open just before it swaps repositories.
    state.stallRemember = true;
    const switching = useVault.getState().openVaultAt(OTHER);
    await vi.waitFor(() => expect(state.releaseRemember).not.toBeNull());

    // Two changes while the switch is suspended. The first save is held
    // mid-write, so the second is still sitting in the queue when the switch
    // completes — it only runs once the folder has already changed.
    state.saveCount = 0;
    state.stallFirstSaveAfter = "groups";
    useVault.getState().run(anAccount("Primeira"));
    await vi.waitFor(() => expect(state.releaseStall).not.toBeNull());
    useVault.getState().run(anAccount("Pertence ao cofre antigo"));

    state.releaseRemember?.();
    expect(await switching).toEqual({ ok: true });

    state.releaseStall?.();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));

    // The opened vault still has exactly its own account...
    expect(diskOf(OTHER).accounts).toEqual(otherVault.accounts);
    // ...and the stray change landed in the folder it was made in.
    const defaultAccounts = diskOf(DEFAULT_DIR).accounts as { name: string }[];
    expect(defaultAccounts.map((a) => a.name)).toContain("Pertence ao cofre antigo");
  });
});

describe("a save that fails", () => {
  async function readyStore() {
    const useVault = await freshStore();
    seedFolder(DEFAULT_DIR, vaultWith({}));
    await useVault.getState().init();
    state.saves = [];
    return useVault;
  }

  it("is reported instead of swallowed, so the user knows the change is not on disk", async () => {
    const useVault = await readyStore();
    state.failSaves = "Disco cheio";

    useVault.getState().run(anAccount("Inter"));

    await vi.waitFor(() => expect(useVault.getState().saveError).toBe("Disco cheio"));
    // The change is still on screen; only the disk is behind.
    expect(useVault.getState().vault.accounts).toHaveLength(1);
    expect(diskOf(DEFAULT_DIR).accounts).toEqual([]);
  });

  it("clears once a retry writes the whole vault", async () => {
    const useVault = await readyStore();
    state.failSaves = "Disco cheio";
    useVault.getState().run(anAccount("Inter"));
    await vi.waitFor(() => expect(useVault.getState().saveError).not.toBeNull());

    state.failSaves = null;
    await useVault.getState().retrySave();

    expect(useVault.getState().saveError).toBeNull();
    expect(diskOf(DEFAULT_DIR).accounts).toMatchObject([{ name: "Inter" }]);
  });

  it("clears on the next change that saves, since every save writes everything", async () => {
    const useVault = await readyStore();
    state.failSaves = "Sem permissão";
    useVault.getState().run(anAccount("Inter"));
    await vi.waitFor(() => expect(useVault.getState().saveError).not.toBeNull());

    state.failSaves = null;
    useVault.getState().run(anAccount("Poupança"));

    await vi.waitFor(() => expect(useVault.getState().saveError).toBeNull());
    expect(diskOf(DEFAULT_DIR).accounts).toHaveLength(2);
  });

  it("does not jam the chain: later saves still run", async () => {
    const useVault = await readyStore();
    state.failSaves = "falhou";
    useVault.getState().run(anAccount("Inter"));
    await vi.waitFor(() => expect(useVault.getState().saveError).not.toBeNull());
    state.failSaves = null;

    useVault.getState().run(anAccount("B"));
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });
});
