import { newId } from "./id";
import type { CategoryKind, Vault } from "./types";
import { emptyVault } from "./types";

/**
 * The Groups and Categories a brand-new Vault starts with.
 *
 * Data, not logic (issue #10): changing the starter set is editing this list.
 * It is broad enough to classify a real Brazilian bank Statement without
 * stopping to design a taxonomy first, and it is only a starting point — the
 * Categories page lets the user rename, move, add and remove.
 *
 * Only a Vault created from nothing gets it. An existing Vault is never grown by
 * an upgrade: the user's Category tree is theirs (ADR-0002).
 */
export const SEED_TREE: readonly {
  group: string;
  kind: CategoryKind;
  categories: readonly string[];
}[] = [
  {
    group: "Renda",
    kind: "income",
    categories: ["Salário", "13º e férias", "Freelance e serviços", "Outras receitas"],
  },
  {
    group: "Outras entradas",
    kind: "income",
    categories: ["Rendimentos", "Reembolsos", "Presentes recebidos"],
  },
  {
    group: "Moradia",
    kind: "expense",
    categories: ["Aluguel", "Condomínio", "Contas de casa", "Internet e telefone", "Manutenção da casa"],
  },
  {
    group: "Alimentação",
    kind: "expense",
    categories: ["Mercado", "Restaurante", "Delivery", "Padaria e lanches"],
  },
  {
    group: "Transporte",
    kind: "expense",
    categories: [
      "Combustível",
      "Transporte público",
      "Aplicativos de transporte",
      "Estacionamento e pedágio",
      "Manutenção do veículo",
    ],
  },
  {
    group: "Saúde",
    kind: "expense",
    categories: ["Plano de saúde", "Farmácia", "Consultas e exames"],
  },
  { group: "Educação", kind: "expense", categories: ["Cursos", "Livros e material"] },
  {
    group: "Lazer",
    kind: "expense",
    categories: ["Passeios e eventos", "Viagens", "Hobbies"],
  },
  {
    group: "Assinaturas",
    kind: "expense",
    categories: ["Streaming", "Serviços digitais"],
  },
  {
    group: "Compras",
    kind: "expense",
    categories: ["Roupas e calçados", "Eletrônicos", "Casa e decoração"],
  },
  {
    group: "Cuidados pessoais",
    kind: "expense",
    categories: ["Beleza e higiene", "Academia e esportes"],
  },
  { group: "Pets", kind: "expense", categories: ["Pet"] },
  {
    group: "Finanças",
    kind: "expense",
    categories: ["Tarifas bancárias", "Juros e multas", "Impostos e taxas", "Seguros"],
  },
  {
    group: "Outros",
    kind: "expense",
    categories: ["Presentes e doações", "Outras despesas"],
  },
];

/**
 * A fresh vault with the starter Groups and Categories, so a first-time user
 * can record and classify transactions straight away. No accounts and no
 * transactions — those are the user's to add.
 */
export function seedVault(makeId: () => string = newId): Vault {
  const vault = emptyVault();
  for (const { group, kind, categories } of SEED_TREE) {
    const groupId = makeId();
    vault.groups.push({ id: groupId, name: group, kind });
    for (const name of categories) {
      vault.categories.push({ id: makeId(), name, groupId });
    }
  }
  return vault;
}
