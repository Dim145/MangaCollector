import { useEffect, useState } from "react";
import { useDeleteCoffret, useUpdateCoffret } from "@/hooks/useCoffrets.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Visual container that groups the Volume cards of a single coffret.
 * Washi (cream) accent to stay distinct from the gold collector palette —
 * reads as a paper slipcase rather than a trophy.
 *
 * Header is two-mode:
 *   - view mode (default): seal + name + meta + edit/delete buttons
 *   - edit mode:           inline inputs for name / price / store + save/cancel
 *     (volume range stays frozen — changing it means delete + recreate)
 */
export default function CoffretGroup({ coffret, currencySetting, children }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(coffret.name ?? "");
  const [price, setPrice] = useState(
    coffret.price != null ? String(coffret.price) : "",
  );
  const [store, setStore] = useState(coffret.store ?? "");

  const updateCoffret = useUpdateCoffret(coffret.mal_id);
  const deleteCoffret = useDeleteCoffret(coffret.mal_id);

  // Re-seed local edit state whenever the server-authoritative coffret row
  // changes (e.g. after a successful patch + refetch).
  useEffect(() => {
    setName(coffret.name ?? "");
    setPrice(coffret.price != null ? String(coffret.price) : "");
    setStore(coffret.store ?? "");
  }, [coffret.name, coffret.price, coffret.store]);

  const range =
    coffret.vol_start === coffret.vol_end
      ? `${coffret.vol_start}`
      : `${coffret.vol_start}–${coffret.vol_end}`;
  const count = coffret.vol_end - coffret.vol_start + 1;

  const enterEdit = () => {
    setConfirming(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    setName(coffret.name ?? "");
    setPrice(coffret.price != null ? String(coffret.price) : "");
    setStore(coffret.store ?? "");
    setEditing(false);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedStore = store.trim();

    const patch = { id: coffret.id };
    if (trimmedName !== (coffret.name ?? "")) patch.name = trimmedName;

    // Price: empty string clears, number updates, no change = no field.
    const currentPriceStr = coffret.price != null ? String(coffret.price) : "";
    if (price !== currentPriceStr) {
      if (price === "") patch.clear_price = true;
      else {
        const n = Number(price);
        if (!Number.isFinite(n) || n < 0) return;
        patch.price = n;
      }
    }

    // Store: same idea — empty clears, new value updates.
    if (trimmedStore !== (coffret.store ?? "")) {
      if (trimmedStore === "") patch.clear_store = true;
      else patch.store = trimmedStore;
    }

    // Nothing changed? Just exit edit mode silently.
    if (Object.keys(patch).length === 1) {
      setEditing(false);
      return;
    }

    try {
      await updateCoffret.mutateAsync(patch);
      setEditing(false);
    } catch (err) {
      console.error("[coffret] update failed:", err?.message);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteCoffret.mutateAsync(coffret.id);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <section
      aria-label={coffret.name}
      className="relative overflow-hidden rounded-2xl border border-washi/15 bg-gradient-to-br from-ink-2/50 via-ink-1/40 to-ink-1/30 shadow-[0_0_30px_rgba(244,235,222,0.02)] transition hover:border-washi/30"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-washi/40 to-transparent"
      />

      {!editing ? (
        <header className="relative flex flex-wrap items-baseline gap-x-4 gap-y-2 px-4 pt-4 pb-3 md:px-5 md:pt-5">
          <div className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-washi text-ink-0 shadow-[0_1px_4px_rgba(10,9,8,0.4)]"
              style={{ transform: "rotate(-4deg)" }}
            >
              <span className="font-display text-[11px] font-bold leading-none">
                盒
              </span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-muted">
              {t("coffret.label")}
            </span>
          </div>

          <span className="hidden h-3 w-px bg-border md:inline-block" />

          <h3 className="font-display text-base font-semibold italic text-washi">
            {coffret.name}
          </h3>

          <div className="ml-auto flex flex-wrap items-baseline gap-3 font-mono text-[10px] uppercase tracking-wider text-washi-muted">
            <span>
              {t("coffret.volsLabel")} {range}
            </span>
            <span className="text-washi-dim">·</span>
            <span>{t("coffret.nVols", { n: count })}</span>
            {coffret.price && (
              <>
                <span className="text-washi-dim">·</span>
                <span className="text-washi">
                  {formatCurrency(Number(coffret.price), currencySetting)}
                </span>
              </>
            )}
            {coffret.store && (
              <>
                <span className="text-washi-dim">·</span>
                <span className="flex items-center gap-1">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                  <span className="truncate">{coffret.store}</span>
                </span>
              </>
            )}
          </div>

          {/* Actions — edit + delete (two-step confirm) */}
          {confirming ? (
            <div className="flex w-full items-center gap-2 pt-1 md:w-auto md:pt-0">
              <span className="font-mono text-[10px] uppercase tracking-wider text-hanko-bright">
                {t("coffret.confirmDelete")}
              </span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteCoffret.isPending}
                className="rounded-md bg-hanko px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
              >
                {deleteCoffret.isPending ? t("common.saving") : t("common.yes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleteCoffret.isPending}
                className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-washi-muted transition hover:text-washi"
              >
                {t("common.no")}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={enterEdit}
                aria-label={t("coffret.editAria")}
                title={t("coffret.editAria")}
                className="grid h-7 w-7 place-items-center rounded-md text-washi-dim transition hover:bg-washi/10 hover:text-washi"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label={t("coffret.deleteAria")}
                className="grid h-7 w-7 place-items-center rounded-md text-washi-dim transition hover:bg-hanko/10 hover:text-hanko-bright"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
              </button>
            </div>
          )}
        </header>
      ) : (
        <header className="relative space-y-3 px-4 pt-4 pb-4 md:px-5 md:pt-5">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-washi text-ink-0 shadow-[0_1px_4px_rgba(10,9,8,0.4)]"
              style={{ transform: "rotate(-4deg)" }}
            >
              <span className="font-display text-[11px] font-bold leading-none">
                盒
              </span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-muted">
              {t("coffret.editingLabel")}
            </span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("coffret.volsLabel")} {range} · {t("coffret.nVols", { n: count })}
            </span>
          </div>

          <div>
            <label
              htmlFor={`coffret-name-${coffret.id}`}
              className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-washi-dim"
            >
              {t("coffret.nameLabel")}
            </label>
            <input
              id={`coffret-name-${coffret.id}`}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 font-display text-base font-semibold italic text-washi transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`coffret-price-${coffret.id}`}
                className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-washi-dim"
              >
                {t("coffret.priceLabel", {
                  symbol: currencySetting?.symbol || "$",
                })}
              </label>
              <input
                id={`coffret-price-${coffret.id}`}
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
              />
            </div>
            <div>
              <label
                htmlFor={`coffret-store-${coffret.id}`}
                className="mb-1 block font-mono text-[9px] uppercase tracking-wider text-washi-dim"
              >
                {t("coffret.storeLabel")}
              </label>
              <input
                id={`coffret-store-${coffret.id}`}
                type="text"
                maxLength={30}
                placeholder={t("coffret.storePlaceholder")}
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleSave}
              disabled={updateCoffret.isPending || !name.trim()}
              className="flex-1 rounded-lg bg-hanko px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
            >
              {updateCoffret.isPending
                ? t("common.saving")
                : t("common.save")}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={updateCoffret.isPending}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi hover:border-border/80"
            >
              {t("common.cancel")}
            </button>
          </div>
        </header>
      )}

      <div className="grid grid-cols-1 gap-3 border-t border-washi/10 p-3 md:grid-cols-2 md:p-4 lg:grid-cols-3">
        {children}
      </div>
    </section>
  );
}
