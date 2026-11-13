import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAccountBalance } from "../domain/balances";
import { centavos } from "../domain/money";
import { pendingRuleCount } from "../domain/classificationRules";
import { planImport } from "../domain/statementImport";
import type { Transaction, Vault } from "../domain/types";
import { VAULT_COLLECTIONS } from "../domain/types";

/**
 * Repositories that model the real Tauri vault: a folder per vault, each entity
 * a separate file, written one after another with awaits in between. That is what
 * makes two overlapping saves able to tear the vault, so the fake has to
 * reproduce it — an atomic fake would never catch the bug.
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

function vaultWith(partial: Partial<Vault>): Vault {
  return {
    schemaVersion: 4,
    accounts: [],
    groups: [],
    categories: [],
    rules: [],
    transactions: [],
    budgets: [],
    imports: [],
    dismissedTransferPairs: [],
    ...partial,
  };
}

function makeRepo(dir: string) {
  return {
    label: dir,
    dir,
    load: async (): Promise<Vault | null> => {
      state.loadCalls += 1;
      if (dir === DEFAULT_DIR && state.loadResult !== null) return state.loadResult;
      const f = folder(dir);
      if (!f.hasVault) return null;
      return vaultWith(
        Object.fromEntries(
          ENTITIES.map((key) => [key, structuredClone(f.disk[key] ?? [])]),
        ) as Partial<Vault>,
      );
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
      // One file per entity, with a suspension point between each write.
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

vi.mock("../persistence/repository", () => ({
  isTauri: () => true,
  pickRepository: async () => makeRepo(DEFAULT_DIR),
  createVaultRepositoryAt: async (dir: string) => makeRepo(dir),
  inspectVaultFolder: async (dir: string) => ({ dir, hasVault: folder(dir).hasVault }),
}));

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

/** Everything the default folder's files currently say. */
function diskOf(dir: string) {
  return folder(dir).disk;
}

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
});

describe("persistence ordering", () => {
  it("never runs two saves at once, so multi-file writes cannot interleave", async () => {
    const useVault = await freshStore();
    await useVault.getState().init();
    state.saveDelayMs = 5;
    state.saves = [];

    // Three mutations fired back to back, each triggering a save.
    useVault.getState().addAccount({
      name: "A",
      type: "checking",
      openingBalance: centavos(0),
    });
    useVault.getState().addAccount({
      name: "B",
      type: "savings",
      openingBalance: centavos(0),
    });
    useVault.getState().addAccount({
      name: "C",
      type: "cash",
      openingBalance: centavos(0),
    });

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
    const added = useVault.getState().addGroup({ name: "Projetos", kind: "expense" });
    if (!added.ok) throw new Error(added.message);
    await vi.waitFor(() => expect(state.releaseStall).not.toBeNull());

    // A second mutation while the first save is suspended.
    useVault.getState().addCategory({ name: "Cinema", groupId: added.group.id });
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

    useVault.getState().addAccount({
      name: "A",
      type: "checking",
      openingBalance: centavos(0),
    });
    useVault.getState().addAccount({
      name: "B",
      type: "savings",
      openingBalance: centavos(0),
    });

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

    useVault.getState().addAccount({
      name: "Nova",
      type: "cash",
      openingBalance: centavos(0),
    });

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
    useVault.getState().addAccount({
      name: "Primeira",
      type: "cash",
      openingBalance: centavos(0),
    });
    await vi.waitFor(() => expect(state.releaseStall).not.toBeNull());
    useVault.getState().addAccount({
      name: "Pertence ao cofre antigo",
      type: "cash",
      openingBalance: centavos(0),
    });

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

describe("setTransactionCategoryMany", () => {
  const ACC = "acc-1";
  const SAVINGS = "acc-2";

  const expense = (id: string, categoryId: string | null): Transaction => ({
    id,
    kind: "expense",
    date: "2026-10-02",
    amount: centavos(1000),
    description: id,
    accountId: ACC,
    categoryId,
  });

  const income: Transaction = {
    id: "i1",
    kind: "income",
    date: "2026-10-05",
    amount: centavos(500000),
    description: "i1",
    accountId: ACC,
    categoryId: null,
  };

  const transfer: Transaction = {
    id: "t1",
    kind: "transfer",
    date: "2026-10-07",
    amount: centavos(20000),
    description: "t1",
    fromAccountId: ACC,
    toAccountId: SAVINGS,
  };

  /** A vault already holding uncategorized transactions, as an import leaves it. */
  async function storeWithTransactions() {
    const useVault = await freshStore();
    seedFolder(
      DEFAULT_DIR,
      vaultWith({
        accounts: [
          { id: ACC, name: "Inter", type: "checking", openingBalance: centavos(0) },
          { id: SAVINGS, name: "Poupança", type: "savings", openingBalance: centavos(0) },
        ],
        groups: [
          { id: "g-food", name: "Alimentação", kind: "expense" },
          { id: "g-in", name: "Renda", kind: "income" },
        ],
        categories: [
          { id: "cat-market", name: "Mercado", groupId: "g-food" },
          { id: "cat-resto", name: "Restaurante", groupId: "g-food" },
        ],
        transactions: [
          expense("e1", null),
          expense("e2", null),
          expense("e3", null),
          expense("e4", "cat-resto"),
          income,
          transfer,
        ],
      }),
    );
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  const categoryOf = (useVault: Awaited<ReturnType<typeof freshStore>>, id: string) => {
    const tx = useVault.getState().vault.transactions.find((t) => t.id === id);
    return tx === undefined || tx.kind === "transfer" ? undefined : tx.categoryId;
  };

  it("classifies every Transaction it was given and leaves the rest alone", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().setTransactionCategoryMany(["e1", "e2"], "cat-market");

    expect(categoryOf(useVault, "e1")).toBe("cat-market");
    expect(categoryOf(useVault, "e2")).toBe("cat-market");
    expect(categoryOf(useVault, "e3")).toBeNull();
    expect(categoryOf(useVault, "i1")).toBeNull();
    // Let this test's save land before the next one counts saves of its own.
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("saves once however many Transactions it changes", async () => {
    const useVault = await storeWithTransactions();
    state.saveDelayMs = 5;
    useVault.getState().setTransactionCategoryMany(
      ["e1", "e2", "e3", "e4"],
      "cat-market",
    );

    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    // Nothing else is queued behind it: a loop over the single-transaction
    // setter would be four whole-vault writes on the save chain.
    await new Promise((r) => setTimeout(r, 30));
    expect(state.saves).toHaveLength(1);
    expect(state.maxInFlight).toBe(1);
  });

  it("writes the classification to the vault's files", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().setTransactionCategoryMany(["e1", "e3"], "cat-market");
    // Wait for the save to finish, not for inFlight to be 0 — it already is,
    // since the save is queued on the chain and hasn't started yet.
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    const onDisk = diskOf(DEFAULT_DIR).transactions as { id: string; categoryId?: string }[];
    expect(onDisk.find((t) => t.id === "e1")?.categoryId).toBe("cat-market");
    expect(onDisk.find((t) => t.id === "e3")?.categoryId).toBe("cat-market");
  });

  it("reclassifies Transactions that already had a Category", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().setTransactionCategoryMany(["e4"], "cat-market");
    expect(categoryOf(useVault, "e4")).toBe("cat-market");
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("never gives a Transfer a Category, even if its id is passed", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().setTransactionCategoryMany(["t1", "e1"], "cat-market");

    const t = useVault.getState().vault.transactions.find((x) => x.id === "t1");
    expect(t?.kind).toBe("transfer");
    expect(t).not.toHaveProperty("categoryId");
    expect(categoryOf(useVault, "e1")).toBe("cat-market");
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("changes nothing and saves nothing when given no ids", async () => {
    const useVault = await storeWithTransactions();
    const before = useVault.getState().vault;
    useVault.getState().setTransactionCategoryMany([], "cat-market");

    expect(useVault.getState().vault).toBe(before);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.saves).toHaveLength(0);
  });

  it("ignores ids the vault doesn't have", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().setTransactionCategoryMany(["nao-existe", "e1"], "cat-market");
    expect(categoryOf(useVault, "e1")).toBe("cat-market");
    expect(useVault.getState().vault.transactions).toHaveLength(6);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });
});

describe("editTransaction and deleteTransaction", () => {
  const ACC = "acc-1";
  const SAVINGS = "acc-2";

  /** A vault with an imported expense, an import record, and a transfer. */
  async function storeWithTransactions() {
    const useVault = await freshStore();
    seedFolder(
      DEFAULT_DIR,
      vaultWith({
        accounts: [
          { id: ACC, name: "Inter", type: "checking", openingBalance: centavos(10000) },
          { id: SAVINGS, name: "Poupança", type: "savings", openingBalance: centavos(0) },
        ],
        groups: [
          { id: "g-food", name: "Alimentação", kind: "expense" },
          { id: "g-in", name: "Renda", kind: "income" },
        ],
        categories: [
          { id: "cat-market", name: "Mercado", groupId: "g-food" },
          { id: "cat-salary", name: "Salário", groupId: "g-in" },
        ],
        transactions: [
          {
            id: "e1",
            kind: "expense",
            date: "2026-10-02",
            amount: centavos(30000),
            description: "MERCADO",
            accountId: ACC,
            categoryId: "cat-market",
            fitid: "bank-1",
          } satisfies Transaction,
          {
            id: "t1",
            kind: "transfer",
            date: "2026-10-07",
            amount: centavos(20000),
            description: "para poupança",
            fromAccountId: ACC,
            toAccountId: SAVINGS,
          } satisfies Transaction,
        ],
        imports: [
          {
            id: "imp-1",
            accountId: ACC,
            importedAt: "2026-10-16T00:00:00.000Z",
            fileName: "extrato.ofx",
            added: 2,
            skipped: 5,
          },
        ],
      }),
    );
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  const txOf = (useVault: Awaited<ReturnType<typeof freshStore>>, id: string) =>
    useVault.getState().vault.transactions.find((t) => t.id === id);

  it("applies an edit and saves once", async () => {
    const useVault = await storeWithTransactions();
    const result = useVault
      .getState()
      .editTransaction("e1", { description: "SUPERMERCADO", amount: centavos(12345) });

    expect(result).toEqual({ ok: true });
    expect(txOf(useVault, "e1")).toMatchObject({
      description: "SUPERMERCADO",
      amount: 12345,
    });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.saves).toHaveLength(1);
  });

  it("writes the edit to the vault's files", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().editTransaction("e1", { description: "CORRIGIDO" });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    const onDisk = diskOf(DEFAULT_DIR).transactions as { id: string; description: string }[];
    expect(onDisk.find((t) => t.id === "e1")?.description).toBe("CORRIGIDO");
  });

  it("drops a Category the new kind can't use when the kind flips", async () => {
    const useVault = await storeWithTransactions();
    expect(useVault.getState().editTransaction("e1", { kind: "income" })).toEqual({
      ok: true,
    });
    expect(txOf(useVault, "e1")).toMatchObject({ kind: "income", categoryId: null });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("keeps a Category that is still valid for the new kind", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().editTransaction("e1", { kind: "income", categoryId: "cat-salary" });
    expect(txOf(useVault, "e1")).toMatchObject({
      kind: "income",
      categoryId: "cat-salary",
    });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("keeps the bank's fitid across an edit, so dedup still recognises the entry", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().editTransaction("e1", { description: "x", kind: "income" });
    expect(txOf(useVault, "e1")).toHaveProperty("fitid", "bank-1");
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("refuses an invalid edit and leaves the vault untouched", async () => {
    const useVault = await storeWithTransactions();
    const before = useVault.getState().vault;

    const result = useVault.getState().editTransaction("e1", { amount: centavos(0) });

    expect(result.ok).toBe(false);
    expect(useVault.getState().vault).toBe(before);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.saves).toHaveLength(0);
  });

  it("refuses to turn a Transfer into an Expense", async () => {
    const useVault = await storeWithTransactions();
    const result = useVault.getState().editTransaction("t1", { kind: "expense" });
    expect(result.ok).toBe(false);
    expect(txOf(useVault, "t1")).toHaveProperty("kind", "transfer");
    await new Promise((r) => setTimeout(r, 20));
    expect(state.saves).toHaveLength(0);
  });

  it("reports a missing Transaction without changing anything", async () => {
    const useVault = await storeWithTransactions();
    const before = useVault.getState().vault;
    const result = useVault.getState().editTransaction("nao-existe", { description: "x" });

    expect(result.ok).toBe(false);
    expect(useVault.getState().vault).toBe(before);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.saves).toHaveLength(0);
  });

  it("deletes a Transaction and leaves the Import record alone", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().deleteTransaction("e1");

    expect(txOf(useVault, "e1")).toBeUndefined();
    expect(useVault.getState().vault.imports).toEqual([
      {
        id: "imp-1",
        accountId: ACC,
        importedAt: "2026-10-16T00:00:00.000Z",
        fileName: "extrato.ofx",
        added: 2,
        skipped: 5,
      },
    ]);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("writes the deletion to the vault's files", async () => {
    const useVault = await storeWithTransactions();
    useVault.getState().deleteTransaction("t1");
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    const onDisk = diskOf(DEFAULT_DIR).transactions as { id: string }[];
    expect(onDisk.map((t) => t.id)).toEqual(["e1"]);
  });

  it("deleting a Transaction that isn't there changes nothing and saves nothing", async () => {
    const useVault = await storeWithTransactions();
    const before = useVault.getState().vault;
    useVault.getState().deleteTransaction("nao-existe");

    expect(useVault.getState().vault).toBe(before);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.saves).toHaveLength(0);
  });
});

describe("balances after an edit or a delete", () => {
  /**
   * Nothing stores a balance: it is always derived from the opening balance plus
   * the transactions (CONTEXT.md). These assert that editing and deleting need
   * no balance bookkeeping of their own, which is the thing most likely to get
   * "helpfully" added later.
   */
  const ACC = "acc-1";

  async function storeWithOneExpense() {
    const useVault = await freshStore();
    seedFolder(
      DEFAULT_DIR,
      vaultWith({
        accounts: [
          { id: ACC, name: "Inter", type: "checking", openingBalance: centavos(100000) },
        ],
        transactions: [
          {
            id: "e1",
            kind: "expense",
            date: "2026-10-02",
            amount: centavos(30000),
            description: "MERCADO",
            accountId: ACC,
            categoryId: null,
          } satisfies Transaction,
        ],
      }),
    );
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  const balance = (useVault: Awaited<ReturnType<typeof freshStore>>) => {
    const vault = useVault.getState().vault;
    return deriveAccountBalance(vault.accounts[0], vault.transactions);
  };

  it("follows a changed amount", async () => {
    const useVault = await storeWithOneExpense();
    expect(balance(useVault)).toBe(70000); // 1000,00 - 300,00

    useVault.getState().editTransaction("e1", { amount: centavos(50000) });
    expect(balance(useVault)).toBe(50000);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("follows a kind flip, which reverses the sign", async () => {
    const useVault = await storeWithOneExpense();
    useVault.getState().editTransaction("e1", { kind: "income" });
    expect(balance(useVault)).toBe(130000); // 1000,00 + 300,00
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("returns to the opening balance when the only Transaction is deleted", async () => {
    const useVault = await storeWithOneExpense();
    useVault.getState().deleteTransaction("e1");
    expect(balance(useVault)).toBe(100000);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });
});

describe("marking an entry as a Transfer, and reverting it", () => {
  const CHECKING = "acc-checking";
  const POCKET = "acc-pocket";

  /**
   * One imported Expense of R$ 300,00 on a checking Account that opened with
   * R$ 1.000,00, plus a second Account holding nothing — the shape of the real
   * Vault once the user adds the investment pocket the money was going to.
   */
  async function storeWithImportedExpense(kind: "expense" | "income" = "expense") {
    const useVault = await freshStore();
    state.loadResult = vaultWith({
      accounts: [
        { id: CHECKING, name: "Banco Inter", type: "checking", openingBalance: centavos(100000) },
        { id: POCKET, name: "Inter CDB", type: "savings", openingBalance: centavos(0) },
      ],
      transactions: [
        {
          id: "e1",
          kind,
          date: "2026-10-02",
          amount: centavos(30000),
          description: "APLICACAO CDB",
          accountId: CHECKING,
          categoryId: null,
          fitid: "FIT-1",
        } satisfies Transaction,
      ],
    });
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  const balanceOf = (
    useVault: Awaited<ReturnType<typeof freshStore>>,
    accountId: string,
  ) => {
    const vault = useVault.getState().vault;
    const account = vault.accounts.find((a) => a.id === accountId);
    if (account === undefined) throw new Error(`no account ${accountId}`);
    return deriveAccountBalance(account, vault.transactions);
  };

  it("replaces the entry with one Transfer in a single save", async () => {
    const useVault = await storeWithImportedExpense();

    const result = useVault.getState().markTransactionAsTransfer("e1", POCKET);

    expect(result).toEqual({ ok: true });
    const transactions = useVault.getState().vault.transactions;
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      id: "e1",
      kind: "transfer",
      fromAccountId: CHECKING,
      toAccountId: POCKET,
    });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("leaves the entry's own Account on exactly the balance it had", async () => {
    const useVault = await storeWithImportedExpense();
    expect(balanceOf(useVault, CHECKING)).toBe(70000); // 1000,00 - 300,00

    useVault.getState().markTransactionAsTransfer("e1", POCKET);

    expect(balanceOf(useVault, CHECKING)).toBe(70000);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("moves the chosen Account's balance by the amount, which pairing never does", async () => {
    const useVault = await storeWithImportedExpense();
    expect(balanceOf(useVault, POCKET)).toBe(0);

    useVault.getState().markTransactionAsTransfer("e1", POCKET);

    // The money was always going here; the Vault just wasn't tracking it.
    expect(balanceOf(useVault, POCKET)).toBe(30000);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("takes money out of the chosen Account when the entry was an Income", async () => {
    const useVault = await storeWithImportedExpense("income");

    useVault.getState().markTransactionAsTransfer("e1", POCKET);

    expect(balanceOf(useVault, POCKET)).toBe(-30000);
    expect(balanceOf(useVault, CHECKING)).toBe(130000); // 1000,00 + 300,00
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("writes the recovered entry to disk, so it survives a restart", async () => {
    const useVault = await storeWithImportedExpense();

    useVault.getState().markTransactionAsTransfer("e1", POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    const onDisk = diskOf(DEFAULT_DIR).transactions as Transaction[];
    expect(onDisk[0]).toMatchObject({
      kind: "transfer",
      recoveredFrom: [{ fitid: "FIT-1", accountId: CHECKING }],
    });
    expect(onDisk[0]).not.toHaveProperty("categoryId");
  });

  it("refuses the entry's own Account and writes nothing", async () => {
    const useVault = await storeWithImportedExpense();

    const result = useVault.getState().markTransactionAsTransfer("e1", CHECKING);

    expect(result.ok).toBe(false);
    expect(useVault.getState().vault.transactions[0]).toMatchObject({ kind: "expense" });
    expect(state.saves).toHaveLength(0);
  });

  it("restores the imported entry with its fitid, in one save", async () => {
    const useVault = await storeWithImportedExpense();
    useVault.getState().markTransactionAsTransfer("e1", POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    state.saves = [];

    const result = useVault.getState().revertTransferToEntry("e1");

    expect(result).toEqual({ ok: true });
    expect(useVault.getState().vault.transactions[0]).toEqual({
      id: "e1",
      kind: "expense",
      date: "2026-10-02",
      amount: 30000,
      description: "APLICACAO CDB",
      accountId: CHECKING,
      categoryId: null,
      fitid: "FIT-1",
    });
    // Both balances are back where they started.
    expect(balanceOf(useVault, CHECKING)).toBe(70000);
    expect(balanceOf(useVault, POCKET)).toBe(0);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("refuses to revert a hand-entered Transfer and writes nothing", async () => {
    const useVault = await freshStore();
    state.loadResult = vaultWith({
      accounts: [
        { id: CHECKING, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
        { id: POCKET, name: "Inter CDB", type: "savings", openingBalance: centavos(0) },
      ],
      transactions: [
        {
          id: "t1",
          kind: "transfer",
          date: "2026-10-02",
          amount: centavos(30000),
          description: "movido à mão",
          fromAccountId: CHECKING,
          toAccountId: POCKET,
        } satisfies Transaction,
      ],
    });
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];

    const result = useVault.getState().revertTransferToEntry("t1");

    expect(result.ok).toBe(false);
    expect(useVault.getState().vault.transactions[0]).toMatchObject({ kind: "transfer" });
    expect(state.saves).toHaveLength(0);
  });

  it("re-importing the Statement the entry came from adds nothing", async () => {
    const useVault = await storeWithImportedExpense();
    useVault.getState().markTransactionAsTransfer("e1", POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    // The bank still sends the entry; the recovered id is what stops the
    // re-import from undoing the conversion.
    const plan = planImport(
      [
        {
          fitid: "FIT-1",
          date: "2026-10-02",
          amount: -30000,
          description: "APLICACAO CDB",
          trntype: "DEBIT",
        },
      ],
      CHECKING,
      useVault.getState().vault.transactions,
    );

    expect(plan.additions).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(1);
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

  const account = { name: "Inter", type: "checking" as const, openingBalance: centavos(0) };

  it("is reported instead of swallowed, so the user knows the change is not on disk", async () => {
    const useVault = await readyStore();
    state.failSaves = "Disco cheio";

    useVault.getState().addAccount(account);

    await vi.waitFor(() => expect(useVault.getState().saveError).toBe("Disco cheio"));
    // The change is still on screen; only the disk is behind.
    expect(useVault.getState().vault.accounts).toHaveLength(1);
    expect(diskOf(DEFAULT_DIR).accounts).toEqual([]);
  });

  it("clears once a retry writes the whole vault", async () => {
    const useVault = await readyStore();
    state.failSaves = "Disco cheio";
    useVault.getState().addAccount(account);
    await vi.waitFor(() => expect(useVault.getState().saveError).not.toBeNull());

    state.failSaves = null;
    await useVault.getState().retrySave();

    expect(useVault.getState().saveError).toBeNull();
    expect(diskOf(DEFAULT_DIR).accounts).toMatchObject([{ name: "Inter" }]);
  });

  it("clears on the next change that saves, since every save writes everything", async () => {
    const useVault = await readyStore();
    state.failSaves = "Sem permissão";
    useVault.getState().addAccount(account);
    await vi.waitFor(() => expect(useVault.getState().saveError).not.toBeNull());

    state.failSaves = null;
    useVault.getState().addAccount({ ...account, name: "Poupança" });

    await vi.waitFor(() => expect(useVault.getState().saveError).toBeNull());
    expect(diskOf(DEFAULT_DIR).accounts).toHaveLength(2);
  });

  it("does not jam the chain: later saves still run", async () => {
    const useVault = await readyStore();
    state.failSaves = "falhou";
    useVault.getState().addAccount(account);
    await vi.waitFor(() => expect(useVault.getState().saveError).not.toBeNull());
    state.failSaves = null;

    useVault.getState().addAccount({ ...account, name: "B" });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });
});

describe("refused actions write nothing", () => {
  const ACC = "acc-1";

  async function store() {
    const useVault = await freshStore();
    seedFolder(
      DEFAULT_DIR,
      vaultWith({
        accounts: [{ id: ACC, name: "Inter", type: "checking", openingBalance: centavos(0) }],
        groups: [
          { id: "g-food", name: "Alimentação", kind: "expense" },
          { id: "g-in", name: "Renda", kind: "income" },
        ],
        categories: [
          { id: "cat-market", name: "Mercado", groupId: "g-food" },
          { id: "cat-salary", name: "Salário", groupId: "g-in" },
        ],
        transactions: [
          {
            id: "e1",
            kind: "expense",
            date: "2026-10-02",
            amount: centavos(1000),
            description: "e1",
            accountId: ACC,
            categoryId: null,
          },
          {
            id: "i1",
            kind: "income",
            date: "2026-10-05",
            amount: centavos(5000),
            description: "i1",
            accountId: ACC,
            categoryId: null,
          },
        ],
      }),
    );
    await useVault.getState().init();
    state.saves = [];
    return useVault;
  }

  /** Give any save a chance to land, then prove none did. */
  async function expectNoSave() {
    await new Promise((r) => setTimeout(r, 10));
    expect(state.saves).toHaveLength(0);
  }

  it("an Income under an expense Category is refused", async () => {
    const useVault = await store();
    const before = useVault.getState().vault;
    const result = useVault.getState().addIncome({
      date: "2026-10-07",
      amount: centavos(100),
      accountId: ACC,
      categoryId: "cat-market",
      description: "x",
    });
    expect(result.ok).toBe(false);
    expect(useVault.getState().vault).toBe(before);
    await expectNoSave();
  });

  it("a valid manual Expense is recorded with one save", async () => {
    const useVault = await store();
    const result = useVault.getState().addExpense({
      date: "2026-10-07",
      amount: centavos(100),
      accountId: ACC,
      categoryId: "cat-market",
      description: "x",
    });
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("classifying an Income into an expense Category changes nothing", async () => {
    const useVault = await store();
    useVault.getState().setTransactionCategory("i1", "cat-market");
    useVault.getState().setTransactionCategoryMany(["i1"], "cat-market");
    const income = useVault.getState().vault.transactions.find((t) => t.id === "i1");
    expect(income).toMatchObject({ categoryId: null });
    await expectNoSave();
  });

  it("a mixed bulk classification only touches the matching kind", async () => {
    const useVault = await store();
    useVault.getState().setTransactionCategoryMany(["e1", "i1"], "cat-market");
    const byId = new Map(useVault.getState().vault.transactions.map((t) => [t.id, t]));
    expect(byId.get("e1")).toMatchObject({ categoryId: "cat-market" });
    expect(byId.get("i1")).toMatchObject({ categoryId: null });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("classifying into a Category the vault does not have changes nothing", async () => {
    const useVault = await store();
    useVault.getState().setTransactionCategoryMany(["e1"], "cat-ghost");
    expect(useVault.getState().vault.transactions[0]).toMatchObject({ categoryId: null });
    await expectNoSave();
  });

  it("a Budget on an income Category, or a negative one, is refused", async () => {
    const useVault = await store();
    expect(
      useVault.getState().setBudget({ categoryId: "cat-salary", monthlyLimit: centavos(100) }).ok,
    ).toBe(false);
    expect(
      useVault.getState().setBudget({ categoryId: "cat-market", monthlyLimit: centavos(-1) }).ok,
    ).toBe(false);
    await expectNoSave();
  });

  it("setting a Budget to the limit it already has saves nothing", async () => {
    const useVault = await store();
    useVault.getState().setBudget({ categoryId: "cat-market", monthlyLimit: centavos(800) });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    state.saves = [];
    expect(
      useVault.getState().setBudget({ categoryId: "cat-market", monthlyLimit: centavos(800) }).ok,
    ).toBe(true);
    await expectNoSave();
  });

  it("a duplicate Account name is refused", async () => {
    const useVault = await store();
    const result = useVault
      .getState()
      .addAccount({ name: "inter", type: "cash", openingBalance: centavos(0) });
    expect(result.ok).toBe(false);
    await expectNoSave();
  });

  it("deleting a Category in use, or an Account with Transactions, is refused", async () => {
    const useVault = await store();
    useVault.getState().setTransactionCategory("e1", "cat-market");
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    state.saves = [];

    expect(useVault.getState().deleteCategory("cat-market").ok).toBe(false);
    expect(useVault.getState().deleteAccount(ACC).ok).toBe(false);
    expect(useVault.getState().vault.categories).toHaveLength(2);
    expect(useVault.getState().vault.accounts).toHaveLength(1);
    await expectNoSave();
  });
});

describe("managing Categories and Accounts", () => {
  async function store() {
    const useVault = await freshStore();
    seedFolder(
      DEFAULT_DIR,
      vaultWith({
        accounts: [{ id: "acc", name: "Inter", type: "checking", openingBalance: centavos(10000) }],
        transactions: [
          {
            id: "e1",
            kind: "expense",
            date: "2026-10-02",
            amount: centavos(2500),
            description: "FARMACIA",
            accountId: "acc",
            categoryId: null,
          },
        ],
      }),
    );
    await useVault.getState().init();
    state.saves = [];
    return useVault;
  }

  it("builds a tree, classifies into it, and tidies it up without losing a classification", async () => {
    const useVault = await store();
    const s = () => useVault.getState();

    const group = s().addGroup({ name: "Saúde", kind: "expense" });
    if (!group.ok) throw new Error(group.message);
    const other = s().addGroup({ name: "Cuidados", kind: "expense" });
    if (!other.ok) throw new Error(other.message);
    const category = s().addCategory({ name: "Farmácia", groupId: group.group.id });
    if (!category.ok) throw new Error(category.message);

    s().setTransactionCategory("e1", category.category.id);
    expect(s().renameCategory(category.category.id, "Remédios").ok).toBe(true);
    expect(s().moveCategory(category.category.id, other.group.id).ok).toBe(true);

    // Still classified, under the new name and Group.
    expect(s().vault.transactions[0]).toMatchObject({ categoryId: category.category.id });
    expect(s().vault.categories[0]).toMatchObject({ name: "Remédios", groupId: other.group.id });

    // The emptied Group can go; the one holding the Category cannot.
    expect(s().deleteGroup(group.group.id).ok).toBe(true);
    expect(s().deleteGroup(other.group.id).ok).toBe(false);

    // Seven changes, seven saves: wait for every one, or the last lands in the next test.
    await vi.waitFor(() => expect(state.saves).toHaveLength(7));
    expect(diskOf(DEFAULT_DIR).categories).toMatchObject([{ name: "Remédios" }]);
    expect(diskOf(DEFAULT_DIR).groups).toMatchObject([{ name: "Cuidados" }]);
  });

  it("corrects an Account's opening balance, and the derived balance follows", async () => {
    const useVault = await store();
    const result = useVault.getState().editAccount("acc", {
      name: "Banco Inter",
      type: "checking",
      openingBalance: centavos(50000),
    });
    expect(result.ok).toBe(true);
    const account = useVault.getState().vault.accounts[0];
    expect(account.name).toBe("Banco Inter");
    expect(deriveAccountBalance(account, useVault.getState().vault.transactions)).toBe(47500);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("deletes an Account nothing uses", async () => {
    const useVault = await store();
    const added = useVault
      .getState()
      .addAccount({ name: "Carteira", type: "cash", openingBalance: centavos(0) });
    if (!added.ok) throw new Error(added.message);
    expect(useVault.getState().deleteAccount(added.account.id).ok).toBe(true);
    expect(useVault.getState().vault.accounts.map((a) => a.name)).toEqual(["Inter"]);
    await vi.waitFor(() => expect(state.saves).toHaveLength(2));
  });
});

describe("marking a whole selection as Transfers", () => {
  const CHECKING = "acc-checking";
  const POCKET = "acc-pocket";

  /**
   * Twenty imported entries on one checking Account — ten `APLICACAO` Expenses
   * and ten `RESGATE` Incomes of R$ 100,00 each — which is the shape of the real
   * Vault in miniature: hundreds of entries moving money in and out of an
   * investment pocket inside the same bank.
   */
  async function storeWithManyEntries() {
    const useVault = await freshStore();
    state.loadResult = vaultWith({
      accounts: [
        { id: CHECKING, name: "Banco Inter", type: "checking", openingBalance: centavos(100000) },
        { id: POCKET, name: "Inter CDB", type: "savings", openingBalance: centavos(0) },
      ],
      transactions: Array.from({ length: 20 }, (_, i) => ({
        id: `e${i}`,
        kind: i % 2 === 0 ? ("expense" as const) : ("income" as const),
        date: "2026-10-02",
        amount: centavos(10000),
        description: i % 2 === 0 ? "APLICACAO CDB" : "RESGATE CDB",
        accountId: CHECKING,
        categoryId: null,
        fitid: `FIT-${i}`,
      })) satisfies Transaction[],
    });
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  const ids = Array.from({ length: 20 }, (_, i) => `e${i}`);

  const balanceOf = (
    useVault: Awaited<ReturnType<typeof freshStore>>,
    accountId: string,
  ) => {
    const vault = useVault.getState().vault;
    const account = vault.accounts.find((a) => a.id === accountId);
    if (account === undefined) throw new Error(`no account ${accountId}`);
    return deriveAccountBalance(account, vault.transactions);
  };

  /**
   * The load-bearing invariant, and the reason this action exists at all: one
   * mutation, so one save, however many entries it converts. A loop over
   * `markTransactionAsTransfer` would queue twenty whole-vault writes onto the
   * save chain — the condition that tore the vault before.
   */
  it("converts twenty entries in exactly one save", async () => {
    const useVault = await storeWithManyEntries();

    const result = useVault.getState().markTransactionsAsTransfer(ids, POCKET);

    expect(result).toEqual({ ok: true, converted: 20, skipped: [] });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    // Give any stray queued save a chance to show up before claiming there is none.
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    expect(state.saves).toHaveLength(1);
  });

  it("leaves the Account the entries were imported on exactly where it was", async () => {
    const useVault = await storeWithManyEntries();
    // 1000,00 - 10 x 100,00 + 10 x 100,00
    expect(balanceOf(useVault, CHECKING)).toBe(100000);

    useVault.getState().markTransactionsAsTransfer(ids, POCKET);

    expect(balanceOf(useVault, CHECKING)).toBe(100000);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("moves the chosen Account by the two directions netted against each other", async () => {
    const useVault = await storeWithManyEntries();

    useVault.getState().markTransactionsAsTransfer(ids, POCKET);

    // Ten Expenses arrived there and ten Incomes left it: the same money going
    // back and forth, which is why the pocket ends level.
    expect(balanceOf(useVault, POCKET)).toBe(0);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("stops the converted entries counting as Income or Expense", async () => {
    const useVault = await storeWithManyEntries();

    useVault.getState().markTransactionsAsTransfer(ids, POCKET);

    const transactions = useVault.getState().vault.transactions;
    expect(transactions).toHaveLength(20);
    expect(transactions.every((tx) => tx.kind === "transfer")).toBe(true);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("writes every converted entry to disk with the bank id it was recovered from", async () => {
    const useVault = await storeWithManyEntries();

    useVault.getState().markTransactionsAsTransfer(ids, POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    const onDisk = diskOf(DEFAULT_DIR).transactions as Transaction[];
    expect(onDisk).toHaveLength(20);
    expect(onDisk[0]).toMatchObject({
      kind: "transfer",
      recoveredFrom: [{ fitid: "FIT-0", accountId: CHECKING }],
    });
    expect(onDisk[19]).toMatchObject({
      recoveredFrom: [{ fitid: "FIT-19", accountId: CHECKING }],
    });
  });

  it("converts what it can, names what it skipped, and still saves once", async () => {
    const useVault = await storeWithManyEntries();
    // One entry is already a Transfer by the time the batch runs.
    useVault.getState().markTransactionAsTransfer("e0", POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    state.saves = [];

    const result = useVault.getState().markTransactionsAsTransfer(ids, POCKET);

    expect(result).toMatchObject({
      ok: true,
      converted: 19,
      skipped: [{ transactionId: "e0", message: "Essa transação já é uma transferência." }],
    });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
  });

  it("writes nothing when every selected entry is skipped", async () => {
    const useVault = await storeWithManyEntries();
    useVault.getState().markTransactionsAsTransfer(ids, POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    state.saves = [];

    // Nothing left to convert: they are all Transfers already.
    const result = useVault.getState().markTransactionsAsTransfer(ids, POCKET);

    expect(result).toMatchObject({ ok: true, converted: 0 });
    expect(state.saves).toHaveLength(0);
  });

  it("refuses an Account the Vault doesn't have and writes nothing", async () => {
    const useVault = await storeWithManyEntries();

    const result = useVault.getState().markTransactionsAsTransfer(ids, "acc-nope");

    expect(result).toEqual({ ok: false, message: "Conta inexistente." });
    expect(useVault.getState().vault.transactions[0]).toMatchObject({ kind: "expense" });
    expect(state.saves).toHaveLength(0);
  });

  it("re-importing the Statement adds none of the converted entries back", async () => {
    const useVault = await storeWithManyEntries();
    useVault.getState().markTransactionsAsTransfer(ids, POCKET);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    const plan = planImport(
      ids.map((id, i) => ({
        fitid: `FIT-${i}`,
        date: "2026-10-02",
        amount: i % 2 === 0 ? -10000 : 10000,
        description: id,
        trntype: i % 2 === 0 ? "DEBIT" : "CREDIT",
      })),
      CHECKING,
      useVault.getState().vault.transactions,
    );

    expect(plan.additions).toHaveLength(0);
    expect(plan.duplicates).toHaveLength(20);
  });
});

describe("classification Rules", () => {
  const INTER = "acc-inter";

  async function storeWithCategories(partial: Partial<Vault> = {}) {
    const useVault = await freshStore();
    state.loadResult = vaultWith({
      accounts: [
        { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
      ],
      groups: [
        { id: "g-food", name: "Alimentação", kind: "expense" },
        { id: "g-in", name: "Renda", kind: "income" },
      ],
      categories: [
        { id: "cat-restaurant", name: "Restaurantes", groupId: "g-food" },
        { id: "cat-market", name: "Mercado", groupId: "g-food" },
        { id: "cat-salary", name: "Salário", groupId: "g-in" },
      ],
      ...partial,
    });
    await useVault.getState().init();
    await vi.waitFor(() => expect(state.inFlight).toBe(0));
    state.saves = [];
    return useVault;
  }

  const entry = (id: string, description: string, categoryId: string | null = null): Transaction => ({
    id,
    kind: "expense",
    date: "2026-10-02",
    amount: centavos(5000),
    description,
    accountId: INTER,
    categoryId,
    fitid: `FIT-${id}`,
  });

  const txById = (
    useVault: Awaited<ReturnType<typeof freshStore>>,
    id: string,
  ) => useVault.getState().vault.transactions.find((t) => t.id === id);

  it("adds a Rule and writes it to its own file", async () => {
    const useVault = await storeWithCategories();

    const outcome = useVault.getState().addRule({
      pattern: "IFOOD",
      categoryId: "cat-restaurant",
    });

    expect(outcome.ok).toBe(true);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    expect(diskOf(DEFAULT_DIR).rules).toMatchObject([
      { pattern: "IFOOD", categoryId: "cat-restaurant", kind: "expense" },
    ]);
  });

  it("writes nothing when a Rule is refused", async () => {
    const useVault = await storeWithCategories();

    const outcome = useVault.getState().addRule({ pattern: " ", categoryId: "cat-market" });

    expect(outcome.ok).toBe(false);
    expect(useVault.getState().vault.rules).toEqual([]);
    expect(state.saves).toHaveLength(0);
  });

  it("edits, reorders and deletes a Rule, persisting each time", async () => {
    const useVault = await storeWithCategories();
    const first = useVault.getState().addRule({ pattern: "food", categoryId: "cat-market" });
    const second = useVault
      .getState()
      .addRule({ pattern: "ifood", categoryId: "cat-restaurant" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    await vi.waitFor(() => expect(state.saves).toHaveLength(2));
    state.saves = [];

    expect(useVault.getState().editRule(second.rule.id, {
      pattern: "ifood com",
      categoryId: "cat-restaurant",
    })).toEqual({ ok: true });
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));

    expect(useVault.getState().moveRule(second.rule.id, -1)).toEqual({ ok: true });
    expect(useVault.getState().vault.rules.map((r) => r.pattern)).toEqual([
      "ifood com",
      "food",
    ]);
    await vi.waitFor(() => expect(state.saves).toHaveLength(2));

    expect(useVault.getState().deleteRule(first.rule.id)).toEqual({ ok: true });
    expect(useVault.getState().vault.rules).toHaveLength(1);
    await vi.waitFor(() => expect(state.saves).toHaveLength(3));
  });

  it("deleting a Rule leaves the Transactions it classified as they were", async () => {
    const useVault = await storeWithCategories({
      transactions: [entry("e1", "IFOOD *IFOOD COM")],
    });
    const added = useVault.getState().addRule({
      pattern: "ifood",
      categoryId: "cat-restaurant",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    useVault.getState().applyRulesToUncategorized();
    await vi.waitFor(() => expect(state.saves).toHaveLength(2));

    useVault.getState().deleteRule(added.rule.id);

    expect(txById(useVault, "e1")).toMatchObject({
      categoryId: "cat-restaurant",
      ruleId: added.rule.id,
    });
    // Every mutating test has to wait for its own save, or it leaks into the
    // next test's count: `state.saves` is module state reset per test.
    await vi.waitFor(() => expect(state.saves).toHaveLength(3));
  });

  describe("applying the Rules to the backlog", () => {
    async function storeWithBacklog() {
      const useVault = await storeWithCategories({
        transactions: Array.from({ length: 30 }, (_, i) =>
          entry(`e${i}`, i < 20 ? `IFOOD PEDIDO ${i}` : `PADARIA ${i}`),
        ),
      });
      const added = useVault.getState().addRule({
        pattern: "ifood",
        categoryId: "cat-restaurant",
      });
      if (!added.ok) throw new Error(added.message);
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
      state.saves = [];
      return { useVault, ruleId: added.rule.id };
    }

    /**
     * The load-bearing invariant again: one mutation, so one save, however many
     * Transactions the Rules classify.
     */
    it("classifies twenty Transactions in exactly one save", async () => {
      const { useVault } = await storeWithBacklog();

      expect(useVault.getState().applyRulesToUncategorized()).toEqual({ applied: 20 });

      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
      await vi.waitFor(() => expect(state.inFlight).toBe(0));
      expect(state.saves).toHaveLength(1);
    });

    it("matches the count the preview promised", async () => {
      const { useVault } = await storeWithBacklog();
      const preview = pendingRuleCount(useVault.getState().vault);

      const { applied } = useVault.getState().applyRulesToUncategorized();

      expect(applied).toBe(preview);
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    });

    it("records which Rule classified each Transaction", async () => {
      const { useVault, ruleId } = await storeWithBacklog();

      useVault.getState().applyRulesToUncategorized();

      expect(txById(useVault, "e0")).toMatchObject({
        categoryId: "cat-restaurant",
        ruleId,
      });
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    });

    it("leaves what matched nothing Uncategorized", async () => {
      const { useVault } = await storeWithBacklog();

      useVault.getState().applyRulesToUncategorized();

      expect(txById(useVault, "e25")).toMatchObject({ categoryId: null });
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    });

    it("writes nothing on a second pass, because there is nothing left to do", async () => {
      const { useVault } = await storeWithBacklog();
      useVault.getState().applyRulesToUncategorized();
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
      state.saves = [];

      expect(useVault.getState().applyRulesToUncategorized()).toEqual({ applied: 0 });

      expect(state.saves).toHaveLength(0);
    });

    it("never overrules a Category the user set by hand", async () => {
      const useVault = await storeWithCategories({
        transactions: [entry("e1", "IFOOD PEDIDO", "cat-market")],
      });
      useVault.getState().addRule({ pattern: "ifood", categoryId: "cat-restaurant" });
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
      state.saves = [];

      expect(useVault.getState().applyRulesToUncategorized()).toEqual({ applied: 0 });

      expect(txById(useVault, "e1")).toMatchObject({ categoryId: "cat-market" });
      expect(state.saves).toHaveLength(0);
    });
  });

  describe("an Import with Rules in the vault", () => {
    const statementEntry = (fitid: string, description: string) => ({
      fitid,
      date: "2026-10-02",
      amount: -5000,
      description,
      trntype: "DEBIT",
    });

    it("classifies the additions in the same single save", async () => {
      const useVault = await storeWithCategories();
      useVault.getState().addRule({ pattern: "ifood", categoryId: "cat-restaurant" });
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
      state.saves = [];

      const plan = planImport(
        [
          statementEntry("F1", "IFOOD *IFOOD COM AGEN"),
          statementEntry("F2", "IFOOD *PEDIDO 22"),
          statementEntry("F3", "PADARIA DO ZE"),
        ],
        INTER,
        [],
      );
      const report = useVault.getState().commitImport({ plan, fileName: "extrato.ofx" });

      expect(report).toEqual({ added: 3, classified: 2 });
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
      await vi.waitFor(() => expect(state.inFlight).toBe(0));
      expect(state.saves).toHaveLength(1);

      const classified = useVault
        .getState()
        .vault.transactions.filter((tx) => tx.kind !== "transfer" && tx.categoryId !== null);
      expect(classified).toHaveLength(2);
    });

    it("imports exactly as before when the vault has no Rules", async () => {
      const useVault = await storeWithCategories();

      const plan = planImport([statementEntry("F1", "IFOOD *IFOOD")], INTER, []);
      const report = useVault.getState().commitImport({ plan, fileName: "extrato.ofx" });

      expect(report).toEqual({ added: 1, classified: 0 });
      expect(useVault.getState().vault.transactions[0]).toMatchObject({ categoryId: null });
      await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    });
  });

  it("forgets the Rule when the user reclassifies by hand", async () => {
    const useVault = await storeWithCategories({
      transactions: [entry("e1", "IFOOD PEDIDO")],
    });
    useVault.getState().addRule({ pattern: "ifood", categoryId: "cat-restaurant" });
    useVault.getState().applyRulesToUncategorized();
    await vi.waitFor(() => expect(state.saves).toHaveLength(2));
    expect(txById(useVault, "e1")).toHaveProperty("ruleId");

    useVault.getState().setTransactionCategory("e1", "cat-market");

    expect(txById(useVault, "e1")).toMatchObject({ categoryId: "cat-market" });
    expect(txById(useVault, "e1")).not.toHaveProperty("ruleId");
    await vi.waitFor(() => expect(state.saves).toHaveLength(3));
  });
});
