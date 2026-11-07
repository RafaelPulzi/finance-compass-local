import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import { editedTransaction } from "./transactionEdit";
import type { Vault } from "./types";
import { emptyVault } from "./types";

const ACC = "acc-1";
const SAVINGS = "acc-2";

const vault: Vault = {
  ...emptyVault(),
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
    },
    {
      id: "e2",
      kind: "expense",
      date: "2026-10-03",
      amount: centavos(1000),
      description: "sem categoria",
      accountId: ACC,
      categoryId: null,
    },
    {
      id: "t1",
      kind: "transfer",
      date: "2026-10-07",
      amount: centavos(20000),
      description: "para poupança",
      fromAccountId: ACC,
      toAccountId: SAVINGS,
    },
  ],
};

/** The edited Transaction, failing the test if the edit was refused. */
function edited(id: string, changes: Parameters<typeof editedTransaction>[2]) {
  const outcome = editedTransaction(vault, id, changes);
  if (!outcome.ok) throw new Error(`refused: ${outcome.message}`);
  return outcome.transaction;
}

function refusal(id: string, changes: Parameters<typeof editedTransaction>[2]) {
  const outcome = editedTransaction(vault, id, changes);
  if (outcome.ok) throw new Error("expected the edit to be refused");
  return outcome.message;
}

describe("editedTransaction", () => {
  it("changes only the fields it was given", () => {
    expect(edited("e1", { description: "SUPERMERCADO" })).toMatchObject({
      id: "e1",
      kind: "expense",
      date: "2026-10-02",
      amount: 30000,
      description: "SUPERMERCADO",
      accountId: ACC,
      categoryId: "cat-market",
    });
  });

  it("corrects the date, amount and account", () => {
    expect(
      edited("e1", {
        date: "2026-09-30",
        amount: centavos(12345),
        accountId: SAVINGS,
      }),
    ).toMatchObject({ date: "2026-09-30", amount: 12345, accountId: SAVINGS });
  });

  it("keeps the bank's fitid, so an edit can't make the entry importable again", () => {
    expect(edited("e1", { description: "outra coisa" })).toHaveProperty("fitid", "bank-1");
  });

  it("leaves a Transaction with no fitid without one", () => {
    expect(edited("e2", { description: "x" })).not.toHaveProperty("fitid");
  });

  it("assigns a Category to an Uncategorized Transaction", () => {
    expect(edited("e2", { categoryId: "cat-market" })).toHaveProperty(
      "categoryId",
      "cat-market",
    );
  });

  it("clears a Category back to Uncategorized (ADR-0005)", () => {
    expect(edited("e1", { categoryId: null })).toHaveProperty("categoryId", null);
  });

  describe("swapping income and expense", () => {
    it("changes the kind", () => {
      expect(edited("e2", { kind: "income" })).toHaveProperty("kind", "income");
    });

    it("drops a Category that the new kind can't use", () => {
      // cat-market is an expense Category; as an Income this must not keep it.
      expect(edited("e1", { kind: "income" })).toMatchObject({
        kind: "income",
        categoryId: null,
      });
    });

    it("keeps a Category that is still valid for the new kind", () => {
      const sameKind = edited("e1", { kind: "expense" });
      expect(sameKind).toMatchObject({ kind: "expense", categoryId: "cat-market" });
    });

    it("sets the new kind's Category when one is given with the flip", () => {
      expect(edited("e1", { kind: "income", categoryId: "cat-salary" })).toMatchObject({
        kind: "income",
        categoryId: "cat-salary",
      });
    });

    it("refuses a Category of the wrong kind asked for outright", () => {
      expect(refusal("e1", { categoryId: "cat-salary" })).toMatch(/não vale para esse tipo/i);
    });
  });

  describe("transfers", () => {
    it("edits the date, amount, description and both accounts", () => {
      expect(
        edited("t1", {
          amount: centavos(500),
          fromAccountId: SAVINGS,
          toAccountId: ACC,
        }),
      ).toMatchObject({
        kind: "transfer",
        amount: 500,
        fromAccountId: SAVINGS,
        toAccountId: ACC,
      });
    });

    it("never gains a Category", () => {
      expect(refusal("t1", { categoryId: "cat-market" })).toMatch(/não tem categoria/i);
    });

    it("cannot become an Income or an Expense", () => {
      expect(refusal("t1", { kind: "expense" })).toMatch(/não pode se tornar/i);
    });

    it("refuses the same Account on both sides", () => {
      expect(refusal("t1", { toAccountId: ACC })).toMatch(/diferentes/i);
    });
  });

  describe("refusals", () => {
    it("reports a Transaction that isn't there instead of inventing one", () => {
      expect(refusal("nao-existe", { description: "x" })).toMatch(/não encontrada/i);
    });

    it("refuses a zero or negative amount", () => {
      expect(refusal("e1", { amount: centavos(0) })).toMatch(/maior que zero/i);
      expect(refusal("e1", { amount: centavos(-100) })).toMatch(/maior que zero/i);
    });

    it("refuses a non-integer amount, which would be a float leaking into money", () => {
      expect(refusal("e1", { amount: 12.5 as never })).toMatch(/maior que zero/i);
    });

    it("refuses a malformed date", () => {
      expect(refusal("e1", { date: "02/10/2026" })).toMatch(/data válida/i);
    });

    it("refuses an Account the Vault doesn't have", () => {
      expect(refusal("e1", { accountId: "nao-existe" })).toMatch(/conta inexistente/i);
      expect(refusal("t1", { toAccountId: "nao-existe" })).toMatch(/conta inexistente/i);
    });

    it("refuses a Category the Vault doesn't have", () => {
      expect(refusal("e1", { categoryId: "nao-existe" })).toMatch(/categoria inexistente/i);
    });
  });

  it("never mutates the Vault it was given", () => {
    const before = JSON.stringify(vault);
    edited("e1", { description: "mudou", amount: centavos(1) });
    expect(JSON.stringify(vault)).toBe(before);
  });
});

describe("editedTransaction: dates and recovered Transfers", () => {
  it("refuses a date with the right shape that does not exist", () => {
    const outcome = editedTransaction(vault, "e1", { date: "2026-02-30" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/data válida/);
  });

  /** The Vault with t1 recovered from an Expense imported on ACC. */
  const recovered: Vault = {
    ...vault,
    accounts: [
      ...vault.accounts,
      { id: "acc-3", name: "CDB", type: "savings", openingBalance: centavos(0) },
    ],
    transactions: vault.transactions.map((tx) =>
      tx.id === "t1" ? { ...tx, recoveredFrom: [{ fitid: "bank-t1", accountId: ACC }] } : tx,
    ),
  };

  it("lets the user re-point the side they chose by hand", () => {
    const outcome = editedTransaction(recovered, "t1", { toAccountId: "acc-3" });
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.transaction).toMatchObject({ fromAccountId: ACC, toAccountId: "acc-3" });
    // The bank ids survive the edit, so a re-import still skips the entry.
    expect(outcome.transaction).toHaveProperty("recoveredFrom", [{ fitid: "bank-t1", accountId: ACC }]);
  });

  it("refuses to move the side the bank's Statement recorded", () => {
    const outcome = editedTransaction(recovered, "t1", { fromAccountId: "acc-3" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toMatch(/lançamento importado/);
  });

  it("refuses to swap the direction, which would contradict the Statement's sign", () => {
    const outcome = editedTransaction(recovered, "t1", {
      fromAccountId: SAVINGS,
      toAccountId: ACC,
    });
    expect(outcome.ok).toBe(false);
  });

  it("still lets a hand-entered Transfer change both sides freely", () => {
    const outcome = editedTransaction(vault, "t1", { fromAccountId: SAVINGS, toAccountId: ACC });
    expect(outcome.ok).toBe(true);
  });
});
