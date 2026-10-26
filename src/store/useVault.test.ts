import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAccountBalance } from "../domain/balances";
import { centavos } from "../domain/money";
import type { Transaction, Vault } from "../domain/types";

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
};

function folder(dir: string): FakeFolder {
  let found = state.folders.get(dir);
  if (found === undefined) {
    found = { disk: {}, hasVault: false };
    state.folders.set(dir, found);
  }
  return found;
}

const ENTITIES = [
  "accounts",
  "groups",
  "categories",
  "transactions",
  "budgets",
  "imports",
] as const;

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
    schemaVersion: 2,
    accounts: [],
    groups: [],
    categories: [],
    transactions: [],
    budgets: [],
    imports: [],
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

    const group = useVault.getState().addGroup({ name: "Lazer", kind: "expense" });
    await vi.waitFor(() => expect(state.releaseStall).not.toBeNull());

    // A second mutation while the first save is suspended.
    useVault.getState().addCategory({ name: "Cinema", groupId: group.id });
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
