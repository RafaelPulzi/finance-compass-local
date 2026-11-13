import { describe, expect, it } from "vitest";
import { centavos } from "./money";
import { type NewTransaction, createdTransaction } from "./transactionCreate";
import type { Vault } from "./types";
import { emptyVault } from "./types";

const vault: Vault = {
  ...emptyVault(),
  accounts: [
    { id: "inter", name: "Inter", type: "checking", openingBalance: centavos(0) },
    { id: "cdb", name: "CDB", type: "savings", openingBalance: centavos(0) },
  ],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "c-market", name: "Mercado", groupId: "g-food" },
    { id: "c-salary", name: "Salário", groupId: "g-in" },
  ],
};

const expense: NewTransaction = {
  kind: "expense",
  date: "2026-10-07",
  amount: centavos(4990),
  accountId: "inter",
  categoryId: "c-market",
  description: "  Feira  ",
};

function message(input: NewTransaction): string {
  const outcome = createdTransaction(vault, input, "id");
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome.message;
}

describe("createdTransaction", () => {
  it("builds an Expense with a trimmed description and no bank id", () => {
    const outcome = createdTransaction(vault, expense, "tx-1");
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.transaction).toEqual({
      id: "tx-1",
      kind: "expense",
      date: "2026-10-07",
      amount: 4990,
      description: "Feira",
      accountId: "inter",
      categoryId: "c-market",
    });
    expect(outcome.transaction).not.toHaveProperty("fitid");
  });

  it("allows recording it Uncategorized, to classify later", () => {
    expect(createdTransaction(vault, { ...expense, categoryId: null }, "x").ok).toBe(true);
  });

  it("refuses an Income filed under an expense Category — the bug the form used to allow", () => {
    expect(message({ ...expense, kind: "income" })).toMatch(/não vale/);
    expect(message({ ...expense, categoryId: "c-salary" })).toMatch(/não vale/);
  });

  it("refuses a Category or an Account the Vault doesn't have", () => {
    expect(message({ ...expense, categoryId: "nope" })).toMatch(/Categoria inexistente/);
    expect(message({ ...expense, accountId: "nope" })).toMatch(/Conta inexistente/);
  });

  it("refuses zero, negative and fractional amounts", () => {
    expect(message({ ...expense, amount: centavos(0) })).toMatch(/maior que zero/);
    expect(message({ ...expense, amount: centavos(-100) })).toMatch(/maior que zero/);
    expect(message({ ...expense, amount: 1.5 as never })).toMatch(/maior que zero/);
  });

  it("refuses a date that does not exist", () => {
    expect(message({ ...expense, date: "2026-02-30" })).toMatch(/data/);
    expect(message({ ...expense, date: "" })).toMatch(/data/);
  });

  it("builds a Transfer between two different Accounts, with no Category", () => {
    const outcome = createdTransaction(
      vault,
      {
        kind: "transfer",
        date: "2026-10-07",
        amount: centavos(10000),
        fromAccountId: "inter",
        toAccountId: "cdb",
        description: "aplicação",
      },
      "t1",
    );
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.transaction).not.toHaveProperty("categoryId");
    expect(outcome.transaction).not.toHaveProperty("recoveredFrom");
  });

  it("refuses a Transfer to the same Account or to one that doesn't exist", () => {
    const transfer: NewTransaction = {
      kind: "transfer",
      date: "2026-10-07",
      amount: centavos(10000),
      fromAccountId: "inter",
      toAccountId: "inter",
      description: "",
    };
    expect(message(transfer)).toMatch(/diferentes/);
    expect(message({ ...transfer, toAccountId: "nope" })).toMatch(/inexistente/);
  });
});
