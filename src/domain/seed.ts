import { newId } from "./id";
import type { Category, Group, Vault } from "./types";
import { emptyVault } from "./types";

/**
 * A fresh vault with a small set of Brazilian income/expense Groups and
 * Categories, so a first-time user can record transactions straight away.
 * No accounts and no transactions — those are the user's to add.
 */
export function seedVault(): Vault {
  const vault = emptyVault();

  const group = (name: string, kind: Group["kind"]): Group => {
    const g: Group = { id: newId(), name, kind };
    vault.groups.push(g);
    return g;
  };
  const category = (name: string, g: Group): Category => {
    const c: Category = { id: newId(), name, groupId: g.id };
    vault.categories.push(c);
    return c;
  };

  const renda = group("Renda", "income");
  category("Salário", renda);
  category("Outras receitas", renda);

  const moradia = group("Moradia", "expense");
  category("Aluguel", moradia);
  category("Contas de casa", moradia);

  const alimentacao = group("Alimentação", "expense");
  category("Mercado", alimentacao);
  category("Restaurante", alimentacao);

  const transporte = group("Transporte", "expense");
  category("Combustível", transporte);
  category("Transporte público", transporte);

  return vault;
}
