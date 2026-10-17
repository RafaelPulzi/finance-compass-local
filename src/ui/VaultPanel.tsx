import { useState } from "react";
import type { VaultFolderPick } from "../persistence/repository";
import { useVault } from "../store/useVault";

/**
 * Where the vault lives, and how to point the app somewhere else.
 *
 * Picking a folder means one of two very different things depending on what is
 * already in it — open that vault, or move this one there. Neither should happen
 * as a surprise, so the folder is inspected first and the user confirms the
 * specific action, named, before anything is read or written.
 */
export function VaultPanel() {
  const vaultDir = useVault((s) => s.vaultDir);
  const canChooseVault = useVault((s) => s.canChooseVault);
  const chooseVaultFolder = useVault((s) => s.chooseVaultFolder);
  const openVaultAt = useVault((s) => s.openVaultAt);
  const moveVaultTo = useVault((s) => s.moveVaultTo);

  const [pick, setPick] = useState<VaultFolderPick | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function choose() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const picked = await chooseVaultFolder();
      if (picked !== null) setPick(picked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a pasta.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (pick === null) return;
    setError(null);
    setBusy(true);
    const result = pick.hasVault
      ? await openVaultAt(pick.dir)
      : await moveVaultTo(pick.dir);
    setBusy(false);
    if (result.ok) {
      setDone(
        pick.hasVault
          ? "Cofre aberto nessa pasta."
          : "Cofre movido para essa pasta.",
      );
      setPick(null);
    } else {
      setError(result.message);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-100">
        Pasta do cofre
      </h2>
      <p className="mb-3 text-xs text-slate-500">
        Seus dados são arquivos JSON comuns nesta pasta. Você pode lê-los, copiá-los
        e versioná-los sem o Finance Compass.
      </p>

      <div className="rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-900">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Pasta atual
        </div>
        <div className="break-all font-mono text-xs text-slate-800 dark:text-slate-100">
          {vaultDir ?? "Nenhuma pasta aberta"}
        </div>
      </div>

      {canChooseVault ? (
        <button
          type="button"
          onClick={choose}
          disabled={busy}
          className="mt-3 rounded-md bg-slate-700 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:text-slate-500 dark:bg-slate-600 dark:hover:bg-slate-500 dark:disabled:bg-slate-700"
        >
          Escolher outra pasta…
        </button>
      ) : (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          No navegador os dados ficam no localStorage e não há pasta para escolher.
          Abra o aplicativo para desktop para usar um cofre em arquivos.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {done && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {done}
        </p>
      )}

      {pick && (
        <div className="mt-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
          <div className="break-all font-mono text-xs text-slate-800 dark:text-slate-100">
            {pick.dir}
          </div>

          <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
            {pick.hasVault ? (
              <>
                Essa pasta <strong>já contém um cofre</strong>. Abrir e passar a usar
                os dados dele? O cofre atual continua intacto onde está.
              </>
            ) : (
              <>
                Essa pasta <strong>não contém um cofre</strong>. Mover o cofre atual
                para cá? Os arquivos JSON serão escritos nessa pasta e passarão a ser
                usados daqui em diante.
              </>
            )}
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={confirm}
              disabled={busy}
              className="rounded-md bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700"
            >
              {pick.hasVault ? "Abrir este cofre" : "Mover o cofre para cá"}
            </button>
            <button
              type="button"
              onClick={() => setPick(null)}
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-1 text-sm dark:border-slate-600"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
