import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { centavos } from "../domain/money";
import type { Vault, Wish } from "../domain/types";
import { emptyVault } from "../domain/types";
import { useVault } from "../store/useVault";
import { WishlistPanel } from "./WishlistPanel";

const HOUR = 60 * 60 * 1000;

/** A Wish created `hoursAgo` hours before the test runs. */
function wishFrom(hoursAgo: number, partial: Partial<Wish> = {}): Wish {
  return {
    id: `w-${hoursAgo}`,
    name: "Fone de ouvido",
    price: centavos(19990),
    createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
    ...partial,
  };
}

function show(vault: Vault = emptyVault()) {
  useVault.setState({ vault, status: "ready" });
  return render(<WishlistPanel />);
}

beforeEach(() => {
  useVault.setState({ vault: emptyVault(), status: "ready" });
});

describe("WishlistPanel", () => {
  it("puts a new wish into the wait, telling which rule it fell under", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText(/O que você quer comprar/), "Cadeira");
    await user.type(screen.getByLabelText(/Preço/), "650,00");
    await user.click(screen.getByRole("button", { name: "Entrar na espera" }));

    expect(useVault.getState().vault.wishes).toMatchObject([
      { name: "Cadeira", price: 65000 },
    ]);
    expect(screen.getByText("Cadeira")).toBeInTheDocument();
    expect(screen.getByText(/Espera de 30 dias/)).toBeInTheDocument();
  });

  it("refuses an unreadable price without saving anything", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText(/O que você quer comprar/), "Cadeira");
    await user.type(screen.getByLabelText(/Preço/), "abc");
    await user.click(screen.getByRole("button", { name: "Entrar na espera" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Preço inválido/);
    expect(useVault.getState().vault.wishes).toEqual([]);
  });

  it("offers no buy button while the wait runs, only giving up", () => {
    show({ ...emptyVault(), wishes: [wishFrom(1)] });
    expect(screen.queryByRole("button", { name: "Comprar" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desistir" })).toBeInTheDocument();
    expect(screen.getByText(/libera em/)).toBeInTheDocument();
  });

  it("lets a wish be dropped mid-wait, and counts the money not spent", async () => {
    const user = userEvent.setup();
    show({ ...emptyVault(), wishes: [wishFrom(1)] });
    await user.click(screen.getByRole("button", { name: "Desistir" }));

    expect(useVault.getState().vault.wishes[0].decision).toBe("dropped");
    expect(screen.getByText(/deixou de gastar/)).toHaveTextContent("199,90");
  });

  it("offers the buy once the 48 hours have passed", async () => {
    const user = userEvent.setup();
    show({ ...emptyVault(), wishes: [wishFrom(49)] });
    expect(screen.getByText(/a espera acabou/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Comprar" }));
    expect(useVault.getState().vault.wishes[0].decision).toBe("bought");
    expect(screen.getByText("Comprado", { exact: false })).toBeInTheDocument();
  });

  it("an expensive wish is still waiting when a cheap one would be free", () => {
    show({
      ...emptyVault(),
      wishes: [wishFrom(49, { price: centavos(500_00) })],
    });
    expect(screen.queryByRole("button", { name: "Comprar" })).not.toBeInTheDocument();
    expect(screen.getByText(/Espera de 30 dias/)).toBeInTheDocument();
  });

  it("removes a decided wish from the history", async () => {
    const user = userEvent.setup();
    const decidedAt = new Date().toISOString();
    show({
      ...emptyVault(),
      wishes: [wishFrom(80, { decision: "bought", decidedAt })],
    });
    await user.click(screen.getByRole("button", { name: "Remover" }));
    expect(useVault.getState().vault.wishes).toEqual([]);
  });
});
