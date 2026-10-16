import { create } from "zustand";
import { newId } from "../domain/id";
import type { Centavos } from "../domain/money";
import { seedVault } from "../domain/seed";
import type {
  Account,
  AccountType,
  Budget,
  Category,
  Group,
  ISODate,
  Id,
  Transaction,
  Vault,
} from "../domain/types";
import { emptyVault } from "../domain/types";
import { type VaultRepository, pickRepository } from "../persistence/repository";

type Status = "loading" | "ready" | "error";

interface VaultState {
  vault: Vault;
  status: Status;
  repoLabel: string;
  error: string | null;

  init: () => Promise<void>;

  addAccount: (input: {
    name: string;
    type: AccountType;
    openingBalance: Centavos;
  }) => void;
  addGroup: (input: { name: string; kind: Group["kind"] }) => Group;
  addCategory: (input: { name: string; groupId: Id }) => Category;
  addIncome: (input: {
    date: ISODate;
    amount: Centavos;
    accountId: Id;
    categoryId: Id;
    description: string;
  }) => void;
  addExpense: (input: {
    date: ISODate;
    amount: Centavos;
    accountId: Id;
    categoryId: Id;
    description: string;
  }) => void;
  addTransfer: (input: {
    date: ISODate;
    amount: Centavos;
    fromAccountId: Id;
    toAccountId: Id;
    description: string;
  }) => void;
  setBudget: (input: { categoryId: Id; monthlyLimit: Centavos }) => void;
}

let repository: VaultRepository | null = null;

export const useVault = create<VaultState>((set, get) => {
  /** Apply a change to the vault, then persist it. */
  const mutate = (next: Vault) => {
    set({ vault: next });
    void repository?.save(next);
  };

  const addTx = (tx: Transaction) => {
    const vault = get().vault;
    mutate({ ...vault, transactions: [...vault.transactions, tx] });
  };

  return {
    vault: emptyVault(),
    status: "loading",
    repoLabel: "",
    error: null,

    async init() {
      try {
        repository = await pickRepository();
        const loaded = await repository.load();
        const vault = loaded ?? seedVault();
        if (loaded === null) await repository.save(vault);
        set({ vault, status: "ready", repoLabel: repository.label });
      } catch (e) {
        set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },

    addAccount({ name, type, openingBalance }) {
      const vault = get().vault;
      const account: Account = { id: newId(), name, type, openingBalance };
      mutate({ ...vault, accounts: [...vault.accounts, account] });
    },

    addGroup({ name, kind }) {
      const vault = get().vault;
      const group: Group = { id: newId(), name, kind };
      mutate({ ...vault, groups: [...vault.groups, group] });
      return group;
    },

    addCategory({ name, groupId }) {
      const vault = get().vault;
      const category: Category = { id: newId(), name, groupId };
      mutate({ ...vault, categories: [...vault.categories, category] });
      return category;
    },

    addIncome({ date, amount, accountId, categoryId, description }) {
      addTx({ id: newId(), kind: "income", date, amount, accountId, categoryId, description });
    },

    addExpense({ date, amount, accountId, categoryId, description }) {
      addTx({ id: newId(), kind: "expense", date, amount, accountId, categoryId, description });
    },

    addTransfer({ date, amount, fromAccountId, toAccountId, description }) {
      addTx({ id: newId(), kind: "transfer", date, amount, fromAccountId, toAccountId, description });
    },

    setBudget({ categoryId, monthlyLimit }) {
      const vault = get().vault;
      const existing = vault.budgets.find((b) => b.categoryId === categoryId);
      const budgets = existing
        ? vault.budgets.map((b) =>
            b.categoryId === categoryId ? { ...b, monthlyLimit } : b,
          )
        : [...vault.budgets, { id: newId(), categoryId, monthlyLimit } satisfies Budget];
      mutate({ ...vault, budgets });
    },
  };
});
