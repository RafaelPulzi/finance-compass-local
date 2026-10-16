import { beforeEach, describe, expect, it, vi } from "vitest";
import { centavos } from "../domain/money";
import type { Vault } from "../domain/types";

/**
 * Repository that models the real Tauri vault: each entity is a separate file,
 * written one after another with awaits in between. That is what makes two
 * overlapping saves able to tear the vault, so the fake has to reproduce it —
 * an atomic fake would never catch the bug.
 */
const state = {
  saves: [] as Vault[],
  loadResult: null as Vault | null,
  loadCalls: 0,
  saveDelayMs: 0,
  inFlight: 0,
  maxInFlight: 0,
  /** The "files" on disk, written independently. */
  disk: {} as Partial<Record<keyof Vault, unknown>>,
  saveCount: 0,
  /** Suspend the first save after this file is written, to force a deterministic overlap. */
  stallFirstSaveAfter: null as keyof Vault | null,
  releaseStall: null as (() => void) | null,
};

const yieldToOtherTasks = () => new Promise((r) => setTimeout(r, state.saveDelayMs));

vi.mock("../persistence/repository", () => ({
  pickRepository: async () => ({
    label: "fake",
    load: async () => {
      state.loadCalls += 1;
      return state.loadResult;
    },
    save: async (vault: Vault) => {
      state.inFlight += 1;
      state.saveCount += 1;
      const isFirst = state.saveCount === 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      // One file per entity, with a suspension point between each write.
      for (const key of [
        "accounts",
        "groups",
        "categories",
        "transactions",
        "budgets",
        "imports",
      ] as const) {
        state.disk[key] = structuredClone(vault[key]);
        if (isFirst && state.stallFirstSaveAfter === key) {
          await new Promise<void>((resolve) => {
            state.releaseStall = resolve;
          });
        }
        await yieldToOtherTasks();
      }
      state.saves.push(structuredClone(vault));
      state.inFlight -= 1;
    },
  }),
}));

async function freshStore() {
  vi.resetModules();
  const mod = await import("./useVault");
  mod.resetVaultPersistence();
  return mod.useVault;
}

beforeEach(() => {
  state.saves = [];
  state.loadResult = null;
  state.loadCalls = 0;
  state.saveDelayMs = 0;
  state.inFlight = 0;
  state.maxInFlight = 0;
  state.disk = {};
  state.saveCount = 0;
  state.stallFirstSaveAfter = null;
  state.releaseStall = null;
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

    const groups = state.disk.groups as { id: string }[];
    const categories = state.disk.categories as { groupId: string }[];
    const groupIds = new Set(groups.map((g) => g.id));

    expect(categories.length).toBeGreaterThan(0);
    expect(categories.filter((c) => !groupIds.has(c.groupId))).toHaveLength(0);
  });

  it("does not re-seed when a vault already exists", async () => {
    const useVault = await freshStore();
    state.loadResult = {
      schemaVersion: 2,
      accounts: [],
      groups: [],
      categories: [],
      transactions: [],
      budgets: [],
      imports: [],
    };
    await useVault.getState().init();
    expect(state.saves).toHaveLength(0);
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
    expect(state.disk.groups).toEqual(finalVault.groups);
    expect(state.disk.categories).toEqual(finalVault.categories);
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
    expect(last.accounts.map((a) => a.name)).toEqual(["A", "B"]);
  });
});
