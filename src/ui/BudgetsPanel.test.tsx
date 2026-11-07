import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { BudgetsPanel } from "./BudgetsPanel";

const base: Vault = {
  ...emptyVault(),
  accounts: [{ id: "acc", name: "Inter", type: "checking", openingBalance: centavos(0) }],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "c-market", name: "Mercado", groupId: "g-food" },
    { id: "c-salary", name: "Salário", groupId: "g-in" },
  ],
  transactions: [
    {
      id: "e1",
      kind: "expense",
      date: "2026-10-02",
      amount: centavos(60000),
      description: "MERCADO",
      accountId: "acc",
      categoryId: "c-market",
    },
  ],
};

function show(vault: Vault = base) {
  useVault.setState({ vault, status: "ready" });
  return render(<BudgetsPanel month="2026-10" />);
}

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("BudgetsPanel", () => {
  it("offers only expense Categories for a limit", () => {
    show();
    expect(screen.getAllByText("Mercado").length).toBeGreaterThan(0);
    expect(screen.queryByText("Salário")).not.toBeInTheDocument();
  });

  it("says nothing is budgeted when every limit is 0, instead of an empty list", () => {
    // A limit cleared back to 0 is a Budget record with nothing to meter.
    show({ ...base, budgets: [{ id: "b1", categoryId: "c-market", monthlyLimit: centavos(0) }] });
    expect(screen.getByText(/Nenhum limite definido ainda/)).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("sets a limit on blur and meters the month's spending against it", async () => {
    const user = userEvent.setup();
    show();
    const field = screen.getByPlaceholderText("0,00");
    await user.type(field, "800{Enter}");

    expect(useVault.getState().vault.budgets).toMatchObject([
      { categoryId: "c-market", monthlyLimit: 80000 },
    ]);
    const meter = screen.getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "75");
    expect(field).toHaveValue("800,00");
  });

  it("refuses an unreadable limit", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByPlaceholderText("0,00"), "abc{Enter}");
    expect(screen.getByText(/Valor inválido/)).toBeInTheDocument();
    expect(useVault.getState().vault.budgets).toEqual([]);
  });
});
