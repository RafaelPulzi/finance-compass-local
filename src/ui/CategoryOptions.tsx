import type { CategoryTree } from "../domain/categories";
import type { Group } from "../domain/types";

export type { CategoryTree };

/**
 * The `<option>`s for choosing a Category, under one `<optgroup>` per Group.
 *
 * A flat list cannot tell "Outros" under Alimentação from "Outros" under
 * Moradia, and once the tree grows past a dozen names a flat list is also just
 * hard to scan. Empty Groups are left out: there is nothing in them to choose.
 */
export function CategoryOptions({
  tree,
  value = (id) => id,
  groupLabel = (group) => group.name,
}: {
  tree: CategoryTree;
  /** The option value for a Category id, for selects that tag their values. */
  value?: (categoryId: string) => string;
  groupLabel?: (group: Group) => string;
}) {
  return (
    <>
      {tree
        .filter((branch) => branch.categories.length > 0)
        .map(({ group, categories }) => (
          <optgroup key={group.id} label={groupLabel(group)}>
            {categories.map((c) => (
              <option key={c.id} value={value(c.id)}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}
