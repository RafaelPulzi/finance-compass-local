import { describe, expect, it } from "vitest";
import { accountTransactionCount, addAccount, deleteAccount, editAccount } from "./accounts";
import { deriveAccountBalance } from "./balances";
import { centavos } from "./money";
import type { Vault } from "./types";
import { emptyVault } from "./types";

const vault: Vault = {
  ...emptyVault(),
  accounts: [
    { id: "inter", name: "Banco Inter", type: "checking", openingBalance: centavos(10000) },
    { id: "cdb", name: "Inter CDB", type: "savings", openingBalance: centavos(0) },
    { id: "empty", name: "Carteira", type: "cash", openingBalance: centavos(0) },
  ],
  transactions: [
    {
      id: "e1",
      kind: "expense",
      date: "2026-10-01",
      amount: centavos(2500),
      description: "MERCADO",
      accountId: "inter",
      categoryId: null,
    },
    {
      id: "t1",
      kind: "transfer",
      date: "2026-10-02",
      amount: centavos(5000),
      description: "APLICACAO",
      fromAccountId: "inter",
      toAccountId: "cdb",
    },
  ],
  imports: [
    { id: "imp1", accountId: "inter", importedAt: "2026-10-16T12:00:00.000Z", fileName: "a.ofx", added: 1, skipped: 0 },
    { id: "imp2", accountId: "empty", importedAt: "2026-10-16T12:00:00.000Z", fileName: "b.ofx", added: 0, skipped: 3 },
  ],
};

const makeId = () => "acc-new";

describe("addAccount", () => {
  it("adds an Account with a trimmed name", () => {
    const outcome = addAccount(
      vault,
      { name: "  Nubank  ", type: "credit-card", openingBalance: centavos(-120000) },
      makeId,
    );
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.account).toEqual({
      id: "acc-new",
      name: "Nubank",
      type: "credit-card",
      openingBalance: -120000,
    });
    expect(outcome.vault.accounts).toHaveLength(4);
  });

  it("refuses an empty name and a duplicate one, ignoring case and accents", () => {
    expect(addAccount(vault, { name: " ", type: "cash", openingBalance: centavos(0) }, makeId).ok).toBe(false);
    const dup = addAccount(vault, { name: "banco inter", type: "cash", openingBalance: centavos(0) }, makeId);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.message).toMatch(/Já existe/);
  });

  it("refuses an unknown type and a fractional balance", () => {
    expect(
      addAccount(vault, { name: "X", type: "crypto" as never, openingBalance: centavos(0) }, makeId).ok,
    ).toBe(false);
    expect(
      addAccount(vault, { name: "X", type: "cash", openingBalance: 1.5 as never }, makeId).ok,
    ).toBe(false);
  });
});

describe("editAccount", () => {
  it("corrects the opening balance, and every derived balance follows with no bookkeeping", () => {
    const outcome = editAccount(vault, "inter", {
      name: "Banco Inter",
      type: "checking",
      openingBalance: centavos(25000),
    });
    if (!outcome.ok) throw new Error(outcome.message);
    const inter = outcome.vault.accounts.find((a) => a.id === "inter");
    if (!inter) throw new Error("missing");
    // 250,00 - 25,00 expense - 50,00 transfer out
    expect(deriveAccountBalance(inter, outcome.vault.transactions)).toBe(17500);
    // No Transaction was touched.
    expect(outcome.vault.transactions).toBe(vault.transactions);
  });

  it("renames and retypes, keeping the id every Transaction points at", () => {
    const outcome = editAccount(vault, "cdb", { name: "CDB Liquidez", type: "savings", openingBalance: centavos(0) });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.accounts.find((a) => a.id === "cdb")?.name).toBe("CDB Liquidez");
    expect(accountTransactionCount(outcome.vault, "cdb")).toBe(1);
  });

  it("lets an Account keep its own name, but not take another's", () => {
    expect(editAccount(vault, "inter", { name: "BANCO INTER", type: "checking", openingBalance: centavos(0) }).ok).toBe(true);
    expect(editAccount(vault, "inter", { name: "Carteira", type: "checking", openingBalance: centavos(0) }).ok).toBe(false);
  });

  it("refuses an unknown Account", () => {
    expect(editAccount(vault, "nope", { name: "X", type: "cash", openingBalance: centavos(0) }).ok).toBe(false);
  });
});

describe("deleteAccount", () => {
  it("counts Transactions on either side of a Transfer", () => {
    expect(accountTransactionCount(vault, "inter")).toBe(2);
    expect(accountTransactionCount(vault, "cdb")).toBe(1);
    expect(accountTransactionCount(vault, "empty")).toBe(0);
  });

  it("refuses an Account that still has Transactions, naming how many", () => {
    const outcome = deleteAccount(vault, "cdb");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/1 transação/);
  });

  it("deletes an unused Account along with the Import records made into it", () => {
    const outcome = deleteAccount(vault, "empty");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.vault.accounts.map((a) => a.id)).toEqual(["inter", "cdb"]);
    expect(outcome.vault.imports.map((i) => i.id)).toEqual(["imp1"]);
  });

  it("refuses an unknown Account", () => {
    expect(deleteAccount(vault, "nope").ok).toBe(false);
  });
});
