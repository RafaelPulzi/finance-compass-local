import { type FormEvent, useState } from "react";

interface Props {
  /** The pattern guessed from the descriptions just classified. */
  suggested: string;
  categoryName: string;
  onAccept: (pattern: string) => void;
  onDecline: () => void;
}

/**
 * Offered right after the user classifies by hand: remember this as a Rule?
 *
 * The app has just watched someone do work it could have done, so this is the
 * moment it has something to learn. The pattern is prefilled and editable
 * because the merchant name inside a bank description is a guess — "UBER TRIP"
 * is right, "UBER TRIP 8213" is one receipt — and declining has to be as easy
 * as accepting, or a one-off purchase becomes a Rule by inertia.
 */
export function RuleOfferForm({ suggested, categoryName, onAccept, onDecline }: Props) {
  const [pattern, setPattern] = useState(suggested);

  function submit(e: FormEvent) {
    e.preventDefault();
    onAccept(pattern);
  }

  return (
    <form
      onSubmit={submit}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm dark:border-sky-800 dark:bg-sky-950"
    >
      <span className="text-sky-900 dark:text-sky-200">
        Criar uma regra para classificar isso sozinho? Descrição contém
      </span>
      <input
        aria-label="Padrão da regra sugerida"
        className="min-w-0 flex-1 rounded-md border border-sky-400 bg-white px-2 py-1 text-sm dark:border-sky-700 dark:bg-slate-900"
        value={pattern}
        onChange={(e) => setPattern(e.target.value)}
      />
      <span className="text-sky-900 dark:text-sky-200">→ {categoryName}</span>
      <button
        type="submit"
        className="rounded-md bg-sky-700 px-3 py-1 text-xs font-medium text-white hover:bg-sky-800"
      >
        Criar regra
      </button>
      <button
        type="button"
        className="text-xs text-sky-900 underline hover:text-sky-700 dark:text-sky-300"
        onClick={onDecline}
      >
        não, obrigado
      </button>
    </form>
  );
}
