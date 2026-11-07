import type { MonthKey } from "../domain/reporting";
import type { CategoryFilter, TransactionFilter } from "../domain/transactionQuery";
import { NO_FILTER } from "../domain/transactionQuery";
import type { Account, Transaction } from "../domain/types";
import { CategoryOptions, type CategoryTree } from "./CategoryOptions";
import { monthLongLabel } from "./charts/format";

const KIND_LABELS: Record<Transaction["kind"], string> = {
  expense: "Despesa",
  income: "Receita",
  transfer: "Transferência",
};

const KINDS: Transaction["kind"][] = ["expense", "income", "transfer"];

/**
 * The Category select carries three kinds of choice, so its option values are
 * tagged rather than being bare ids: "Sem categoria" is the absence of a
 * Category (ADR-0005) and has no id to stand for it.
 */
const ANY = "any";
const NONE = "none";
const idValue = (id: string) => `id:${id}`;

function toCategoryFilter(value: string): CategoryFilter {
  if (value === ANY) return { kind: "any" };
  if (value === NONE) return { kind: "uncategorized" };
  return { kind: "category", categoryId: value.slice("id:".length) };
}

function categoryValue(filter: CategoryFilter): string {
  if (filter.kind === "any") return ANY;
  if (filter.kind === "uncategorized") return NONE;
  return idValue(filter.categoryId);
}

interface Props {
  filter: TransactionFilter;
  onChange: (next: TransactionFilter) => void;
  accounts: readonly Account[];
  treesByKind: Record<"income" | "expense", CategoryTree>;
  months: readonly MonthKey[];
}

/** One filter row above the list it scopes — never a filter per column. */
export function TransactionFilters({
  filter,
  onChange,
  accounts,
  treesByKind,
  months,
}: Props) {
  const selectClass =
    "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";

  const isFiltered =
    filter.accountId !== null ||
    filter.month !== null ||
    filter.kind !== null ||
    filter.category.kind !== "any" ||
    filter.search !== "";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <input
        className={`${selectClass} min-w-40 flex-1`}
        type="search"
        placeholder="Buscar descrição"
        aria-label="Buscar descrição"
        value={filter.search}
        onChange={(e) => onChange({ ...filter, search: e.target.value })}
      />

      <select
        className={selectClass}
        aria-label="Conta"
        value={filter.accountId ?? ""}
        onChange={(e) => onChange({ ...filter, accountId: e.target.value || null })}
      >
        <option value="">Todas as contas</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        aria-label="Mês"
        value={filter.month ?? ""}
        onChange={(e) => onChange({ ...filter, month: e.target.value || null })}
      >
        <option value="">Todos os meses</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLongLabel(m)}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        aria-label="Tipo"
        value={filter.kind ?? ""}
        onChange={(e) =>
          onChange({
            ...filter,
            kind: (e.target.value || null) as Transaction["kind"] | null,
          })
        }
      >
        <option value="">Todos os tipos</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>

      <select
        className={selectClass}
        aria-label="Categoria"
        value={categoryValue(filter.category)}
        onChange={(e) => onChange({ ...filter, category: toCategoryFilter(e.target.value) })}
      >
        <option value={ANY}>Todas as categorias</option>
        <option value={NONE}>Sem categoria</option>
        <CategoryOptions
          tree={treesByKind.expense}
          value={idValue}
          groupLabel={(g) => `${g.name} (despesa)`}
        />
        <CategoryOptions
          tree={treesByKind.income}
          value={idValue}
          groupLabel={(g) => `${g.name} (receita)`}
        />
      </select>

      {isFiltered && (
        <button
          type="button"
          onClick={() => onChange(NO_FILTER)}
          className="text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300"
        >
          limpar filtros
        </button>
      )}
    </div>
  );
}
