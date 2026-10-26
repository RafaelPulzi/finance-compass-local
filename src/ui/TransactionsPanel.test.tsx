import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Transaction, Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { TransactionsPanel } from "./TransactionsPanel";

const INTER = "acc-inter";
const SAVINGS = "acc-savings";

const base: Vault = {
  ...emptyVault(),
  accounts: [
    { id: INTER, name: "Banco Inter", type: "checking", openingBalance: centavos(10000) },
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
};

const expense = (
  id: string,
  date: string,
  amount: number,
  description: string,
  categoryId: string | null,
  accountId = INTER,
): Transaction => ({
  id,
  kind: "expense",
  date,
  amount: centavos(amount),
  description,
  accountId,
  categoryId,
});

/** Mount the panel against a Vault, without going near the repository. */
function show(vault: Vault) {
  useVault.setState({ vault, status: "ready" });
  return render(<TransactionsPanel />);
}

/** The Transaction list, as distinct from the add form above it. */
function listItems() {
  return screen.getAllByRole("listitem");
}

function listText() {
  return listItems()
    .map((li) => li.textContent ?? "")
    .join("\n");
}

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("TransactionsPanel list", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 30000, "SUPERMERCADO SAO JOSE", "cat-market"),
      expense("e2", "2026-10-15", 4500, "AÇAÍ DA PRAÇA", null),
      expense("e3", "2026-09-20", 9900, "UBER TRIP", null),
      expense("e4", "2026-10-11", 1200, "Padaria", null, SAVINGS),
      {
        id: "i1",
        kind: "income",
        date: "2026-10-05",
        amount: centavos(485000),
        description: "SALARIO EMPRESA",
        accountId: INTER,
        categoryId: "cat-salary",
      },
    ],
  };

  it("shows every Transaction, not just the newest few", () => {
    show(vault);
    const text = listText();
    for (const description of [
      "SUPERMERCADO SAO JOSE",
      "AÇAÍ DA PRAÇA",
      "UBER TRIP",
      "Padaria",
      "SALARIO EMPRESA",
    ]) {
      expect(text).toContain(description);
    }
  });

  it("reports how many Transactions match and what they total", () => {
    show(vault);
    const summary = screen.getByTestId("selection-summary");
    expect(summary).toHaveTextContent("5 transações");
    expect(summary).toHaveTextContent("4.850,00"); // income
    expect(summary).toHaveTextContent("456,00"); // 300 + 45 + 99 + 12
  });

  it("narrows the list by account", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Conta"), "Poupança");
    expect(listText()).toContain("Padaria");
    expect(listText()).not.toContain("SUPERMERCADO");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("1 transação");
  });

  it("narrows the list by month", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Mês"), "2026-09");
    expect(listText()).toContain("UBER TRIP");
    expect(listText()).not.toContain("Padaria");
  });

  it("narrows the list by kind", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Tipo"), "income");
    expect(listText()).toContain("SALARIO EMPRESA");
    expect(listText()).not.toContain("SUPERMERCADO");
  });

  it("narrows the list to the Uncategorized ones", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "none");
    const text = listText();
    expect(text).toContain("AÇAÍ DA PRAÇA");
    expect(text).toContain("UBER TRIP");
    expect(text).toContain("Padaria");
    expect(text).not.toContain("SUPERMERCADO SAO JOSE"); // has a Category
  });

  it("narrows the list to one Category", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "id:cat-market");
    expect(listText()).toContain("SUPERMERCADO SAO JOSE");
    expect(listText()).not.toContain("AÇAÍ");
  });

  it("finds an accented description typed without accents", async () => {
    show(vault);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "acai");
    expect(listText()).toContain("AÇAÍ DA PRAÇA");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("1 transação");
  });

  it("combines filters", async () => {
    show(vault);
    await userEvent.selectOptions(screen.getByLabelText("Conta"), "Banco Inter");
    await userEvent.selectOptions(screen.getByLabelText("Mês"), "2026-10");
    await userEvent.selectOptions(screen.getByLabelText("Categoria"), "none");
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("1 transação");
    expect(listText()).toContain("AÇAÍ DA PRAÇA");
  });

  it("clears every filter at once", async () => {
    show(vault);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "acai");
    await userEvent.click(screen.getByRole("button", { name: "limpar filtros" }));
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("5 transações");
  });

  it("says so plainly when nothing matches", async () => {
    show(vault);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "nao existe nada assim");
    expect(listText()).toContain("Nenhuma transação corresponde aos filtros");
  });

  it("distinguishes an empty Vault from an empty filter result", () => {
    show(base);
    expect(listText()).toContain("Nenhuma transação ainda");
  });

  it("still offers a Category on each Uncategorized row", () => {
    show(vault);
    expect(screen.getByLabelText("Categoria de UBER TRIP")).toBeInTheDocument();
  });

  it("still shows how many Transactions are Uncategorized", () => {
    show(vault);
    expect(screen.getByText("3 sem categoria")).toBeInTheDocument();
  });
});

describe("TransactionsPanel paging", () => {
  /** 60 Transactions on consecutive days, so "Compra 59" is the newest. */
  const many: Vault = {
    ...base,
    transactions: Array.from({ length: 60 }, (_, i) => {
      const day = new Date(Date.UTC(2026, 2, 1 + i)).toISOString().slice(0, 10);
      return expense(
        `e${String(i).padStart(2, "0")}`,
        day,
        1000 + i,
        `Compra ${String(i).padStart(2, "0")}`,
        null,
      );
    }),
  };

  it("pages the list instead of truncating it", () => {
    show(many);
    expect(listItems()).toHaveLength(50);
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(listText()).toContain("Compra 59");
    expect(listText()).not.toContain("Compra 00");
  });

  it("reaches a Transaction that isn't on the first page", async () => {
    show(many);
    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(listText()).toContain("Compra 00");
    expect(listText()).not.toContain("Compra 59");
  });

  it("counts every match, not just the visible page", () => {
    show(many);
    expect(screen.getByTestId("selection-summary")).toHaveTextContent("60 transações");
  });

  it("goes back to the first page when the filter changes", async () => {
    show(many);
    await userEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "Compra");
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(listText()).toContain("Compra 59");
  });

  it("hides the pager when everything fits on one page", async () => {
    show(many);
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "Compra 1");
    expect(screen.queryByRole("button", { name: "Próxima" })).not.toBeInTheDocument();
  });

  it("keeps the newest-first order within a page", () => {
    show(many);
    const first = within(listItems()[0]).getByText(/Compra/);
    expect(first).toHaveTextContent("Compra 59");
  });
});

describe("TransactionsPanel bulk classification", () => {
  const vault: Vault = {
    ...base,
    transactions: [
      expense("e1", "2026-10-02", 30000, "UBER TRIP 1", null),
      expense("e2", "2026-10-03", 20000, "UBER TRIP 2", null),
      expense("e3", "2026-10-04", 10000, "PADARIA", null),
      {
        id: "i1",
        kind: "income",
        date: "2026-10-05",
        amount: centavos(485000),
        description: "SALARIO",
        accountId: INTER,
        categoryId: null,
      },
      {
        id: "t1",
        kind: "transfer",
        date: "2026-10-06",
        amount: centavos(50000),
        description: "PARA POUPANCA",
        fromAccountId: INTER,
        toAccountId: SAVINGS,
      },
    ],
  };

  const categoryOf = (id: string) => {
    const tx = useVault.getState().vault.transactions.find((t) => t.id === id);
    return tx === undefined || tx.kind === "transfer" ? undefined : tx.categoryId;
  };

  it("offers no selection bar until something is selected", () => {
    show(vault);
    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
  });

  it("assigns one Category to everything selected, in one step", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 2"));
    expect(screen.getByText("2 selecionadas")).toBeInTheDocument();

    await userEvent.selectOptions(
      screen.getByLabelText("Categoria para as selecionadas"),
      "cat-market",
    );

    expect(categoryOf("e1")).toBe("cat-market");
    expect(categoryOf("e2")).toBe("cat-market");
    expect(categoryOf("e3")).toBeNull();
  });

  it("clears the selection after assigning", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar PADARIA"));
    await userEvent.selectOptions(
      screen.getByLabelText("Categoria para as selecionadas"),
      "cat-market",
    );
    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
  });

  it("selects every match of the filter, across all pages", async () => {
    show(vault);
    await userEvent.click(
      screen.getByLabelText("Selecionar todas as transações do filtro"),
    );
    // The Transfer is not selectable: it has no Category to be classified into.
    expect(screen.getByText("4 selecionadas")).toBeInTheDocument();
  });

  it("reports the whole result set in the select-all control, not the visible page", async () => {
    show(vault);
    expect(screen.getByText("Selecionar todas (4)")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Buscar descrição"), "uber");
    expect(screen.getByText("Selecionar todas (2)")).toBeInTheDocument();
  });

  it("offers no checkbox for a Transfer", () => {
    show(vault);
    expect(screen.queryByLabelText("Selecionar PARA POUPANCA")).not.toBeInTheDocument();
  });

  it("offers only Categories of the selection's kind", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    const select = screen.getByLabelText("Categoria para as selecionadas");
    expect(within(select).getByText("Mercado")).toBeInTheDocument();
    expect(within(select).queryByText("Salário")).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByLabelText("Selecionar SALARIO"));
    const incomeSelect = screen.getByLabelText("Categoria para as selecionadas");
    expect(within(incomeSelect).getByText("Salário")).toBeInTheDocument();
    expect(within(incomeSelect).queryByText("Mercado")).not.toBeInTheDocument();
  });

  it("refuses to classify a selection spanning both kinds, and says why", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByLabelText("Selecionar SALARIO"));

    expect(screen.queryByLabelText("Categoria para as selecionadas")).not.toBeInTheDocument();
    expect(screen.getByText(/categorias separadas/i)).toBeInTheDocument();
    expect(screen.getByText("2 selecionadas")).toBeInTheDocument();
  });

  it("clears the selection without assigning anything", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    await userEvent.click(screen.getByRole("button", { name: "limpar seleção" }));

    expect(screen.queryByText("1 selecionada")).not.toBeInTheDocument();
    expect(categoryOf("e1")).toBeNull();
  });

  it("drops the selection when the filter changes", async () => {
    show(vault);
    await userEvent.click(screen.getByLabelText("Selecionar UBER TRIP 1"));
    expect(screen.getByText("1 selecionada")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Buscar descrição"), "uber");
    expect(screen.queryByText("1 selecionada")).not.toBeInTheDocument();
  });

  it("deselects a row that was selected", async () => {
    show(vault);
    const box = screen.getByLabelText("Selecionar PADARIA");
    await userEvent.click(box);
    await userEvent.click(box);
    expect(screen.queryByText("1 selecionada")).not.toBeInTheDocument();
  });

  it("select-all toggles back off", async () => {
    show(vault);
    const all = screen.getByLabelText("Selecionar todas as transações do filtro");
    await userEvent.click(all);
    expect(screen.getByText("4 selecionadas")).toBeInTheDocument();
    await userEvent.click(all);
    expect(screen.queryByText("4 selecionadas")).not.toBeInTheDocument();
  });
});
