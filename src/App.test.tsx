import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { centavos } from "./domain/money";
import type { Vault } from "./domain/types";
import { emptyVault } from "./domain/types";
import { resetVaultPersistence, useVault } from "./store/useVault";

/**
 * The whole app in the browser runtime: no Tauri shell, so the store picks the
 * localStorage repository, exactly as `npm run dev` does.
 */

const KEY = "finance-compass:vault";

const twoYears: Vault = {
  ...emptyVault(),
  accounts: [{ id: "inter", name: "Banco Inter", type: "checking", openingBalance: centavos(10000) }],
  transactions: [
    {
      id: "old",
      kind: "expense",
      date: "2024-10-16",
      amount: centavos(1000),
      description: "PRIMEIRO",
      accountId: "inter",
      categoryId: null,
      fitid: "F1",
    },
  ],
};

beforeEach(() => {
  localStorage.clear();
  resetVaultPersistence();
  useVault.setState({ vault: emptyVault(), status: "loading", error: null, saveError: null });
  window.location.hash = "#/";
});

describe("App", () => {
  it("seeds a vault on first run and persists it", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Finance Compass" })).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Vault;
    expect(stored.groups.length).toBeGreaterThan(5);
    expect(stored.accounts).toEqual([]);
  });

  it("lets the dashboard reach the oldest month the vault has, not just the last twelve", async () => {
    localStorage.setItem(KEY, JSON.stringify(twoYears));
    render(<App />);
    const month = await screen.findByLabelText("Mês");
    expect(within(month).getByRole("option", { name: "outubro de 2024" })).toBeInTheDocument();
  });

  it("says plainly when changes did not reach the disk, and retries on request", async () => {
    const user = userEvent.setup();
    localStorage.setItem(KEY, JSON.stringify(twoYears));
    render(<App />);
    await screen.findByRole("heading", { name: "Finance Compass" });

    useVault.setState({ saveError: "QuotaExceededError" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("As últimas alterações não foram salvas no disco.");
    expect(alert).toHaveTextContent("QuotaExceededError");

    await user.click(screen.getByRole("button", { name: "Tentar salvar de novo" }));
    await screen.findByRole("heading", { name: "Finance Compass" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reaches the Categories page from the navigation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Categorias" }));
    expect(await screen.findByRole("heading", { name: "Categorias" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Categorias" })).toHaveAttribute("aria-current", "page");
  });

  it("shows why a vault could not be opened, without overwriting it", async () => {
    localStorage.setItem(KEY, "{ isto não é json");
    render(<App />);
    expect(await screen.findByText("Não foi possível abrir o cofre.")).toBeInTheDocument();
    expect(screen.getByText(/corrompidos/)).toBeInTheDocument();
    // The broken data is left exactly as it was, for the user to recover.
    expect(localStorage.getItem(KEY)).toBe("{ isto não é json");
  });
});
