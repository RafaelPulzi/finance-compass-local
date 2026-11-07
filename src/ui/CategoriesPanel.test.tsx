import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Vault } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { CategoriesPanel } from "./CategoriesPanel";

const base: Vault = {
  ...emptyVault(),
  accounts: [{ id: "acc", name: "Inter", type: "checking", openingBalance: centavos(0) }],
  groups: [
    { id: "g-food", name: "Alimentação", kind: "expense" },
    { id: "g-home", name: "Moradia", kind: "expense" },
    { id: "g-in", name: "Renda", kind: "income" },
  ],
  categories: [
    { id: "c-market", name: "Mercado", groupId: "g-food" },
    { id: "c-unused", name: "Feira", groupId: "g-food" },
    { id: "c-salary", name: "Salário", groupId: "g-in" },
  ],
  transactions: [
    {
      id: "e1",
      kind: "expense",
      date: "2026-10-02",
      amount: centavos(1000),
      description: "MERCADO",
      accountId: "acc",
      categoryId: "c-market",
    },
  ],
};

function show(vault: Vault = base) {
  useVault.setState({ vault, status: "ready" });
  return render(<CategoriesPanel />);
}

const s = () => useVault.getState().vault;

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("CategoriesPanel", () => {
  it("lists expense and income Groups separately, with how many Transactions each Category holds", () => {
    show();
    expect(screen.getByRole("heading", { name: "Despesas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Receitas" })).toBeInTheDocument();
    expect(screen.getByText("Alimentação")).toBeInTheDocument();
    expect(screen.getByText("1 transação")).toBeInTheDocument();
    expect(screen.getAllByText("0 transações").length).toBeGreaterThan(0);
  });

  it("creates a Group and a Category inside it", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText("Novo grupo de despesa"), "Saúde");
    await user.click(screen.getAllByRole("button", { name: "Criar grupo" })[0]);
    expect(s().groups.map((g) => g.name)).toContain("Saúde");

    await user.type(screen.getByLabelText("Nova categoria em Saúde"), "Farmácia{Enter}");
    const saude = s().groups.find((g) => g.name === "Saúde");
    expect(s().categories).toContainEqual(expect.objectContaining({ name: "Farmácia", groupId: saude?.id }));
    expect(screen.getByLabelText("Nova categoria em Saúde")).toHaveValue("");
  });

  it("shows the refusal when a name is already taken, and keeps what was typed", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText("Nova categoria em Alimentação"), "mercado{Enter}");
    expect(screen.getByText(/já tem uma categoria/)).toBeInTheDocument();
    expect(screen.getByLabelText("Nova categoria em Alimentação")).toHaveValue("mercado");
    expect(s().categories).toHaveLength(3);
  });

  it("renames a Category in place, keeping its Transactions classified", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Renomear categoria Mercado"));
    const field = screen.getByLabelText("Novo nome da categoria Mercado");
    await user.clear(field);
    await user.type(field, "Supermercado{Enter}");

    expect(s().categories.find((c) => c.id === "c-market")?.name).toBe("Supermercado");
    expect(s().transactions[0]).toMatchObject({ categoryId: "c-market" });
    expect(screen.getByText("Supermercado")).toBeInTheDocument();
  });

  it("renames a Group", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Renomear grupo Moradia"));
    const field = screen.getByLabelText("Novo nome do grupo Moradia");
    await user.clear(field);
    await user.type(field, "Casa{Enter}");
    expect(s().groups.find((g) => g.id === "g-home")?.name).toBe("Casa");
  });

  it("moves a Category only among Groups of its own kind", async () => {
    const user = userEvent.setup();
    show();
    const move = screen.getByLabelText("Mover Mercado para outro grupo");
    // Moradia is offered; Renda, an income Group, is not.
    expect(within(move).getByRole("option", { name: "Moradia" })).toBeInTheDocument();
    expect(within(move).queryByRole("option", { name: "Renda" })).not.toBeInTheDocument();

    await user.selectOptions(move, "g-home");
    expect(s().categories.find((c) => c.id === "c-market")?.groupId).toBe("g-home");
  });

  it("refuses to delete a Category in use, saying what uses it", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Excluir categoria Mercado"));
    expect(screen.getByText(/ainda é usada por 1 transação/)).toBeInTheDocument();
    expect(s().categories.some((c) => c.id === "c-market")).toBe(true);
  });

  it("deletes a Category nothing uses", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Excluir categoria Feira"));
    expect(s().categories.some((c) => c.id === "c-unused")).toBe(false);
    expect(screen.getByText("Categoria “Feira” excluída.")).toBeInTheDocument();
  });

  it("refuses to delete a Group that still has Categories", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Excluir grupo Alimentação"));
    expect(screen.getByText(/ainda tem 2 categorias/)).toBeInTheDocument();
  });
});
