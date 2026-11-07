import { CategoryOptions, type CategoryTree } from "./CategoryOptions";

interface Props {
  selectedCount: number;
  /**
   * The kind every selected Transaction shares, or "mixed" when the selection
   * spans both. Income and expense Categories are strictly separate, so a mixed
   * selection has no Category that could apply to all of it.
   */
  kind: "income" | "expense" | "mixed";
  tree: CategoryTree;
  onAssign: (categoryId: string) => void;
  onClear: () => void;
}

/** Appears only while something is selected: assign one Category to all of it. */
export function BulkClassifyBar({ selectedCount, kind, tree, onAssign, onClear }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm dark:border-emerald-800 dark:bg-emerald-950">
      <span className="font-medium text-emerald-900 dark:text-emerald-200">
        {selectedCount === 1 ? "1 selecionada" : `${selectedCount} selecionadas`}
      </span>

      {kind === "mixed" ? (
        <span className="text-xs text-emerald-900 dark:text-emerald-200">
          Receitas e despesas usam categorias separadas. Filtre por tipo para
          classificar a seleção.
        </span>
      ) : (
        <select
          aria-label="Categoria para as selecionadas"
          className="rounded-md border border-emerald-400 bg-white px-2 py-1 text-sm dark:border-emerald-700 dark:bg-slate-900"
          value=""
          onChange={(e) => e.target.value && onAssign(e.target.value)}
        >
          <option value="">Classificar como…</option>
          <CategoryOptions tree={tree} />
        </select>
      )}

      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-xs text-emerald-900 underline hover:text-emerald-700 dark:text-emerald-300"
      >
        limpar seleção
      </button>
    </div>
  );
}
