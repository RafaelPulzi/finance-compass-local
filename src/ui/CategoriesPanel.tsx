import { type FormEvent, useMemo, useState } from "react";
import { categoryTree, transactionCountByCategory } from "../domain/categories";
import type { CategoryKind, Id } from "../domain/types";
import { type ActionResult, useVault } from "../store/useVault";

type Renaming = { target: "group" | "category"; id: Id; draft: string } | null;

const KIND_TITLE: Record<CategoryKind, string> = {
  expense: "Despesas",
  income: "Receitas",
};

const inputClass =
  "rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-900";
const linkClass = "text-xs text-slate-500 underline hover:text-slate-700 dark:hover:text-slate-300";

/**
 * Where the Group → Category tree is managed (issue #10).
 *
 * Every rule lives in domain/categories; this page only asks and shows the
 * verdict. Deleting something still in use is refused with the count of what
 * uses it — never cascaded — so tidying up can't cost classification work.
 */
export function CategoriesPanel() {
  const vault = useVault((s) => s.vault);
  const addGroup = useVault((s) => s.addGroup);
  const addCategory = useVault((s) => s.addCategory);
  const renameGroup = useVault((s) => s.renameGroup);
  const renameCategory = useVault((s) => s.renameCategory);
  const moveCategory = useVault((s) => s.moveCategory);
  const deleteCategory = useVault((s) => s.deleteCategory);
  const deleteGroup = useVault((s) => s.deleteGroup);

  const trees = useMemo(
    () => ({ expense: categoryTree(vault, "expense"), income: categoryTree(vault, "income") }),
    [vault],
  );
  const counts = useMemo(() => transactionCountByCategory(vault), [vault]);

  const [renaming, setRenaming] = useState<Renaming>(null);
  const [newCategory, setNewCategory] = useState<Record<Id, string>>({});
  const [newGroup, setNewGroup] = useState<Record<CategoryKind, string>>({
    expense: "",
    income: "",
  });
  const [message, setMessage] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  /** Show the verdict of an action; returns whether it went through. */
  function report(result: ActionResult, ok?: string) {
    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return false;
    }
    setMessage(ok ? { tone: "ok", text: ok } : null);
    return true;
  }

  function submitRename(e: FormEvent) {
    e.preventDefault();
    if (renaming === null) return;
    const result =
      renaming.target === "group"
        ? renameGroup(renaming.id, renaming.draft)
        : renameCategory(renaming.id, renaming.draft);
    if (report(result)) setRenaming(null);
  }

  function submitCategory(e: FormEvent, groupId: Id) {
    e.preventDefault();
    const result = addCategory({ name: newCategory[groupId] ?? "", groupId });
    if (report(result)) setNewCategory((d) => ({ ...d, [groupId]: "" }));
  }

  function submitGroup(e: FormEvent, kind: CategoryKind) {
    e.preventDefault();
    const result = addGroup({ name: newGroup[kind], kind });
    if (report(result)) setNewGroup((d) => ({ ...d, [kind]: "" }));
  }

  function renameForm(label: string) {
    if (renaming === null) return null;
    return (
      <form onSubmit={submitRename} className="flex flex-1 flex-wrap items-center gap-2">
        <input
          aria-label={label}
          className={`${inputClass} min-w-0 flex-1`}
          value={renaming.draft}
          autoFocus
          onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
        />
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
        >
          Salvar
        </button>
        <button type="button" className={linkClass} onClick={() => setRenaming(null)}>
          Cancelar
        </button>
      </form>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Categorias</h2>
      <p className="mb-3 text-xs text-slate-500">
        Organize suas categorias em grupos. Renomear ou mover uma categoria mantém todas as
        transações classificadas nela. Só é possível excluir o que nada mais usa.
      </p>

      <div aria-live="polite">
        {message && (
          <p
            className={
              message.tone === "error"
                ? "mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
                : "mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            }
          >
            {message.text}
          </p>
        )}
      </div>

      <div className="grid items-start gap-6 md:grid-cols-2">
        {(["expense", "income"] as const).map((kind) => (
          <div key={kind}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {KIND_TITLE[kind]}
            </h3>

            <ul className="space-y-3">
              {trees[kind].map(({ group, categories }) => {
                const otherGroups = trees[kind].filter((b) => b.group.id !== group.id);
                return (
                  <li
                    key={group.id}
                    className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {renaming?.target === "group" && renaming.id === group.id ? (
                        renameForm(`Novo nome do grupo ${group.name}`)
                      ) : (
                        <>
                          <span className="flex-1 font-medium text-slate-800 dark:text-slate-100">
                            {group.name}
                          </span>
                          <button
                            type="button"
                            className={linkClass}
                            aria-label={`Renomear grupo ${group.name}`}
                            onClick={() =>
                              setRenaming({ target: "group", id: group.id, draft: group.name })
                            }
                          >
                            renomear
                          </button>
                          <button
                            type="button"
                            className={linkClass}
                            aria-label={`Excluir grupo ${group.name}`}
                            onClick={() =>
                              report(deleteGroup(group.id), `Grupo “${group.name}” excluído.`)
                            }
                          >
                            excluir
                          </button>
                        </>
                      )}
                    </div>

                    <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                      {categories.length === 0 && (
                        <li className="py-1 text-xs text-slate-500">Nenhuma categoria ainda.</li>
                      )}
                      {categories.map((category) => {
                        const count = counts.get(category.id) ?? 0;
                        return (
                          <li key={category.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                            {renaming?.target === "category" && renaming.id === category.id ? (
                              renameForm(`Novo nome da categoria ${category.name}`)
                            ) : (
                              <>
                                <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                                  {category.name}
                                </span>
                                <span className="text-xs tabular-nums text-slate-400">
                                  {count === 1 ? "1 transação" : `${count} transações`}
                                </span>
                                <button
                                  type="button"
                                  className={linkClass}
                                  aria-label={`Renomear categoria ${category.name}`}
                                  onClick={() =>
                                    setRenaming({
                                      target: "category",
                                      id: category.id,
                                      draft: category.name,
                                    })
                                  }
                                >
                                  renomear
                                </button>
                                {otherGroups.length > 0 && (
                                  <select
                                    aria-label={`Mover ${category.name} para outro grupo`}
                                    className="rounded border border-slate-300 px-1 py-0.5 text-xs dark:border-slate-600 dark:bg-slate-900"
                                    value=""
                                    onChange={(e) =>
                                      e.target.value &&
                                      report(
                                        moveCategory(category.id, e.target.value),
                                        `“${category.name}” movida.`,
                                      )
                                    }
                                  >
                                    <option value="">mover para…</option>
                                    {otherGroups.map((b) => (
                                      <option key={b.group.id} value={b.group.id}>
                                        {b.group.name}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <button
                                  type="button"
                                  className={linkClass}
                                  aria-label={`Excluir categoria ${category.name}`}
                                  onClick={() =>
                                    report(
                                      deleteCategory(category.id),
                                      `Categoria “${category.name}” excluída.`,
                                    )
                                  }
                                >
                                  excluir
                                </button>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <form
                      onSubmit={(e) => submitCategory(e, group.id)}
                      className="mt-2 flex gap-2"
                    >
                      <input
                        aria-label={`Nova categoria em ${group.name}`}
                        className={`${inputClass} min-w-0 flex-1`}
                        placeholder="Nova categoria"
                        value={newCategory[group.id] ?? ""}
                        onChange={(e) =>
                          setNewCategory((d) => ({ ...d, [group.id]: e.target.value }))
                        }
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                      >
                        Adicionar
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>

            <form onSubmit={(e) => submitGroup(e, kind)} className="mt-3 flex gap-2">
              <input
                aria-label={`Novo grupo de ${kind === "expense" ? "despesa" : "receita"}`}
                className={`${inputClass} min-w-0 flex-1`}
                placeholder={`Novo grupo de ${kind === "expense" ? "despesa" : "receita"}`}
                value={newGroup[kind]}
                onChange={(e) => setNewGroup((d) => ({ ...d, [kind]: e.target.value }))}
              />
              <button
                type="submit"
                className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Criar grupo
              </button>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}
