import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import {
  entryFromTransfer,
  transferFromEntry,
  transfersFromEntries,
} from "./transferRecovery";
import type { Transaction, Vault } from "./types";
import { emptyVault } from "./types";

const CHECKING = "acc-checking";
const POCKET = "acc-pocket";

function vaultWith(transactions: Transaction[]): Vault {
  return {
    ...emptyVault(),
    accounts: [
      { id: CHECKING, name: "Banco Inter", type: "checking", openingBalance: centavos(0) },
      { id: POCKET, name: "Inter CDB", type: "savings", openingBalance: centavos(0) },
    ],
    groups: [{ id: "grp-out", name: "Saídas", kind: "expense" }],
    categories: [{ id: "cat-misc", name: "Diversos", groupId: "grp-out" }],
    transactions,
  };
}

function expense(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    kind: "expense",
    date: "2026-03-10",
    amount: centavos(150_00),
    description: "APLICACAO CDB",
    accountId: CHECKING,
    categoryId: null,
    fitid: "FIT-1",
    ...overrides,
  } as Transaction;
}

function income(overrides: Partial<Transaction> = {}): Transaction {
  return expense({
    id: "tx-2",
    kind: "income",
    description: "RESGATE CDB",
    fitid: "FIT-2",
    ...overrides,
  });
}

describe("transferFromEntry", () => {
  it("turns an Expense into a Transfer out of its own Account", () => {
    const outcome = transferFromEntry(vaultWith([expense()]), "tx-1", POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toMatchObject({
      kind: "transfer",
      fromAccountId: CHECKING,
      toAccountId: POCKET,
    });
  });

  it("turns an Income into a Transfer into its own Account", () => {
    const outcome = transferFromEntry(vaultWith([income()]), "tx-2", POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toMatchObject({
      kind: "transfer",
      fromAccountId: POCKET,
      toAccountId: CHECKING,
    });
  });

  it("keeps the amount, the date, the description and the id", () => {
    const outcome = transferFromEntry(vaultWith([expense()]), "tx-1", POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toMatchObject({
      id: "tx-1",
      date: "2026-03-10",
      amount: 150_00,
      description: "APLICACAO CDB",
    });
  });

  it("records the source entry's fitid and the Account it was imported on", () => {
    const outcome = transferFromEntry(vaultWith([expense()]), "tx-1", POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.transaction.kind !== "transfer") return;
    expect(outcome.transaction.recoveredFrom).toEqual([
      { fitid: "FIT-1", accountId: CHECKING },
    ]);
  });

  it("drops the Category whatever it was", () => {
    const vault = vaultWith([expense({ categoryId: "cat-misc" })]);

    const outcome = transferFromEntry(vault, "tx-1", POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).not.toHaveProperty("categoryId");
  });

  it("converts a hand-entered entry but records nothing to reverse to", () => {
    const vault = vaultWith([expense({ fitid: undefined })]);

    const outcome = transferFromEntry(vault, "tx-1", POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok || outcome.transaction.kind !== "transfer") return;
    expect(outcome.transaction.recoveredFrom).toBeUndefined();
  });

  it("refuses a Transaction that isn't there", () => {
    const outcome = transferFromEntry(vaultWith([expense()]), "tx-nope", POCKET);

    expect(outcome).toEqual({ ok: false, message: "Transação não encontrada." });
  });

  it("refuses a Transfer, which is already one", () => {
    const vault = vaultWith([
      {
        id: "tx-3",
        kind: "transfer",
        date: "2026-03-10",
        amount: centavos(150_00),
        description: "movido",
        fromAccountId: CHECKING,
        toAccountId: POCKET,
      },
    ]);

    const outcome = transferFromEntry(vault, "tx-3", POCKET);

    expect(outcome).toEqual({
      ok: false,
      message: "Essa transação já é uma transferência.",
    });
  });

  it("refuses an Account the Vault doesn't have", () => {
    const outcome = transferFromEntry(vaultWith([expense()]), "tx-1", "acc-ghost");

    expect(outcome).toEqual({ ok: false, message: "Conta inexistente." });
  });

  it("refuses the entry's own Account as the other side", () => {
    const outcome = transferFromEntry(vaultWith([expense()]), "tx-1", CHECKING);

    expect(outcome).toEqual({
      ok: false,
      message: "Escolha uma conta diferente da do lançamento.",
    });
  });
});

describe("entryFromTransfer", () => {
  /** The Transfer an Expense on the checking Account becomes. */
  function convertedExpense(): Vault {
    const vault = vaultWith([expense()]);
    const outcome = transferFromEntry(vault, "tx-1", POCKET);
    if (!outcome.ok) throw new Error("fixture failed to convert");
    return { ...vault, transactions: [outcome.transaction] };
  }

  it("restores the Expense it was recovered from, with its fitid", () => {
    const outcome = entryFromTransfer(convertedExpense(), "tx-1");

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toEqual({
      id: "tx-1",
      kind: "expense",
      date: "2026-03-10",
      amount: 150_00,
      description: "APLICACAO CDB",
      accountId: CHECKING,
      categoryId: null,
      fitid: "FIT-1",
    });
  });

  it("restores an Income when the entry was on the destination side", () => {
    const vault = vaultWith([income()]);
    const converted = transferFromEntry(vault, "tx-2", POCKET);
    if (!converted.ok) throw new Error("fixture failed to convert");

    const outcome = entryFromTransfer(
      { ...vault, transactions: [converted.transaction] },
      "tx-2",
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toMatchObject({
      kind: "income",
      accountId: CHECKING,
      fitid: "FIT-2",
    });
  });

  it("comes back Uncategorized even if the entry had a Category", () => {
    const vault = vaultWith([expense({ categoryId: "cat-misc" })]);
    const converted = transferFromEntry(vault, "tx-1", POCKET);
    if (!converted.ok) throw new Error("fixture failed to convert");

    const outcome = entryFromTransfer(
      { ...vault, transactions: [converted.transaction] },
      "tx-1",
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toMatchObject({ categoryId: null });
  });

  it("round-trips: converting and reversing returns the original entry", () => {
    const original = expense();
    const vault = vaultWith([original]);
    const converted = transferFromEntry(vault, "tx-1", POCKET);
    if (!converted.ok) throw new Error("fixture failed to convert");

    const outcome = entryFromTransfer(
      { ...vault, transactions: [converted.transaction] },
      "tx-1",
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transaction).toEqual(original);
  });

  it("refuses a hand-entered Transfer, which has nothing to reverse to", () => {
    const vault = vaultWith([
      {
        id: "tx-3",
        kind: "transfer",
        date: "2026-03-10",
        amount: centavos(150_00),
        description: "movido à mão",
        fromAccountId: CHECKING,
        toAccountId: POCKET,
      },
    ]);

    const outcome = entryFromTransfer(vault, "tx-3");

    expect(outcome).toEqual({
      ok: false,
      message: "Essa transferência não veio de um extrato importado.",
    });
  });

  it("refuses a Transfer recovered from both sides, which is the pair's business", () => {
    const vault = vaultWith([
      {
        id: "tx-4",
        kind: "transfer",
        date: "2026-03-10",
        amount: centavos(150_00),
        description: "par aceito",
        fromAccountId: CHECKING,
        toAccountId: POCKET,
        recoveredFrom: [
          { fitid: "FIT-1", accountId: CHECKING },
          { fitid: "FIT-9", accountId: POCKET },
        ],
      },
    ]);

    const outcome = entryFromTransfer(vault, "tx-4");

    expect(outcome).toEqual({
      ok: false,
      message: "Essa transferência foi recuperada de dois lançamentos.",
    });
  });

  it("refuses when the recorded entry sits on neither side of the Transfer", () => {
    const vault = vaultWith([
      {
        id: "tx-5",
        kind: "transfer",
        date: "2026-03-10",
        amount: centavos(150_00),
        description: "incoerente",
        fromAccountId: CHECKING,
        toAccountId: POCKET,
        recoveredFrom: [{ fitid: "FIT-1", accountId: "acc-ghost" }],
      },
    ]);

    const outcome = entryFromTransfer(vault, "tx-5");

    expect(outcome).toEqual({
      ok: false,
      message: "A transferência não corresponde ao lançamento de origem.",
    });
  });

  it("refuses an Income or Expense, which is not a Transfer", () => {
    const outcome = entryFromTransfer(vaultWith([expense()]), "tx-1");

    expect(outcome).toEqual({
      ok: false,
      message: "Essa transação não é uma transferência.",
    });
  });

  it("refuses a Transaction that isn't there", () => {
    const outcome = entryFromTransfer(vaultWith([expense()]), "tx-nope");

    expect(outcome).toEqual({ ok: false, message: "Transação não encontrada." });
  });
});

describe("transfersFromEntries", () => {
  it("marks every selected entry against the same other Account", () => {
    const vault = vaultWith([
      expense({ id: "tx-1" }),
      expense({ id: "tx-2", fitid: "FIT-2" }),
      income({ id: "tx-3" }),
    ]);

    const outcome = transfersFromEntries(vault, ["tx-1", "tx-2", "tx-3"], POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.skipped).toEqual([]);
    expect(outcome.transfers.map((tx) => tx.id)).toEqual(["tx-1", "tx-2", "tx-3"]);
    expect(outcome.transfers.every((tx) => tx.kind === "transfer")).toBe(true);
  });

  it("takes each entry's direction from its own kind, so a mixed selection is fine", () => {
    const vault = vaultWith([expense({ id: "tx-1" }), income({ id: "tx-3" })]);

    const outcome = transfersFromEntries(vault, ["tx-1", "tx-3"], POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transfers).toMatchObject([
      { id: "tx-1", fromAccountId: CHECKING, toAccountId: POCKET },
      { id: "tx-3", fromAccountId: POCKET, toAccountId: CHECKING },
    ]);
  });

  it("keeps the bank's id of every converted entry, so a re-import still skips it", () => {
    const vault = vaultWith([
      expense({ id: "tx-1", fitid: "FIT-1" }),
      expense({ id: "tx-2", fitid: "FIT-2" }),
    ]);

    const outcome = transfersFromEntries(vault, ["tx-1", "tx-2"], POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transfers).toMatchObject([
      { recoveredFrom: [{ fitid: "FIT-1", accountId: CHECKING }] },
      { recoveredFrom: [{ fitid: "FIT-2", accountId: CHECKING }] },
    ]);
  });

  it("converts what it can and reports what it cannot, rather than refusing the batch", () => {
    const vault = vaultWith([
      expense({ id: "tx-1" }),
      // Already on the chosen Account: money that left and arrived there never
      // moved between two Accounts.
      expense({ id: "tx-2", accountId: POCKET }),
      expense({ id: "tx-3", fitid: "FIT-3" }),
    ]);

    const outcome = transfersFromEntries(vault, ["tx-1", "tx-2", "tx-3"], POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transfers.map((tx) => tx.id)).toEqual(["tx-1", "tx-3"]);
    expect(outcome.skipped).toEqual([
      {
        transactionId: "tx-2",
        message: "Escolha uma conta diferente da do lançamento.",
      },
    ]);
  });

  it("skips an entry that is already a Transfer", () => {
    const vault = vaultWith([
      expense({ id: "tx-1" }),
      {
        id: "tx-2",
        kind: "transfer",
        date: "2026-03-10",
        amount: centavos(150_00),
        description: "APLICACAO CDB",
        fromAccountId: CHECKING,
        toAccountId: POCKET,
      },
    ]);

    const outcome = transfersFromEntries(vault, ["tx-1", "tx-2"], POCKET);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transfers.map((tx) => tx.id)).toEqual(["tx-1"]);
    expect(outcome.skipped).toEqual([
      { transactionId: "tx-2", message: "Essa transação já é uma transferência." },
    ]);
  });

  it("converts an id listed twice exactly once", () => {
    const outcome = transfersFromEntries(
      vaultWith([expense({ id: "tx-1" })]),
      ["tx-1", "tx-1"],
      POCKET,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.transfers.map((tx) => tx.id)).toEqual(["tx-1"]);
  });

  it("refuses the whole batch when the other Account doesn't exist", () => {
    const outcome = transfersFromEntries(
      vaultWith([expense()]),
      ["tx-1"],
      "acc-nope",
    );

    expect(outcome).toEqual({ ok: false, message: "Conta inexistente." });
  });

  it("refuses an empty selection", () => {
    const outcome = transfersFromEntries(vaultWith([expense()]), [], POCKET);

    expect(outcome).toEqual({
      ok: false,
      message: "Selecione pelo menos um lançamento.",
    });
  });
});
