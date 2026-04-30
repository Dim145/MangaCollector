import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal.jsx";
import StoreAutocomplete from "./ui/StoreAutocomplete.jsx";
import { useCreateCoffret } from "@/hooks/useCoffrets.js";
import { useOnline } from "@/hooks/useOnline.js";
import { notifySyncError } from "@/lib/sync.js";
import { haptics } from "@/lib/haptics.js";
import { useT } from "@/i18n/index.jsx";

/**
 * AddCoffretModal — create a box-set grouping a contiguous volume range.
 *
 * The modal uses the washi (cream) accent for coffret-specific chrome so it
 * visually parts ways with the collector feature (which owns gold). The
 * collector toggle INSIDE the modal keeps its gold seal because it's still
 * the collector feature — orthogonal to the coffret grouping.
 *
 * The server atomically:
 *   1. Inserts the coffret row
 *   2. Marks every volume in [vol_start, vol_end] as owned + linked
 *   3. Splits `price` evenly across those volumes (optional)
 *   4. Propagates `collector=true` to each volume if the toggle is set
 */
export default function AddCoffretModal({
  open,
  onClose,
  mal_id,
  totalVolumes,
  currencySetting,
  prefill = null,
  onSwitchToVolume = null,
}) {
  const t = useT();
  const online = useOnline();
  const [volStart, setVolStart] = useState(1);
  const [volEnd, setVolEnd] = useState(Math.min(5, totalVolumes || 5));
  const [price, setPrice] = useState("");
  const [store, setStore] = useState("");
  const [collector, setCollector] = useState(false);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);

  const createCoffret = useCreateCoffret(mal_id);

  // Re-seed fields every time the modal opens. AddCoffretModal stays
  // mounted across open toggles, so `useState` initialisers alone can't
  // pick up fresh prefill values from a new scan.
  useEffect(() => {
    if (!open) return;
    setVolStart(prefill?.volStart ?? 1);
    setVolEnd(prefill?.volEnd ?? Math.min(5, totalVolumes || 5));
    setPrice(prefill?.price != null ? String(prefill.price) : "");
    setStore("");
    setCollector(false);
    setName(prefill?.name ?? "");
    setNameTouched(!!prefill?.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const autoName = useMemo(() => {
    const s = Math.max(1, Number(volStart) || 1);
    const e = Math.max(s, Number(volEnd) || s);
    return s === e
      ? t("coffret.autoNameOne", { n: s })
      : t("coffret.autoNameRange", { start: s, end: e });
  }, [volStart, volEnd, t]);

  const effectiveName = nameTouched ? name : autoName;
  const volumesCount = Math.max(
    0,
    (Number(volEnd) || 0) - (Number(volStart) || 0) + 1,
  );
  const pricePerVol = useMemo(() => {
    const p = Number(price);
    if (!p || !volumesCount) return null;
    return (p / volumesCount).toFixed(2);
  }, [price, volumesCount]);

  const rangeInvalid =
    Number(volStart) < 1 || Number(volEnd) < Number(volStart);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rangeInvalid || volumesCount === 0) return;
    if (!online) {
      // Coffret creation is online-only for now: the server atomically
      // inserts the coffret row AND re-links every volume in the range
      // (owned, price split, collector propagation). Queueing it would
      // need a temp client-side coffret id and a full reconciliation
      // pass on sync — deferred. Surface a clear message instead of
      // letting the POST 0-hang-retry.
      notifySyncError(t("coffret.offlineRequired"), "coffret-create");
      return;
    }
    try {
      await createCoffret.mutateAsync({
        name: effectiveName.trim() || autoName,
        vol_start: Number(volStart),
        vol_end: Number(volEnd),
        price: price ? Number(price) : null,
        store: store.trim() || null,
        collector,
      });
      setName("");
      setNameTouched(false);
      setPrice("");
      setStore("");
      setCollector(false);
      haptics.success();
      onClose?.();
    } catch (err) {
      console.error("[coffret] create failed:", err?.message);
      haptics.error();
      notifySyncError(err, "coffret-create");
    }
  };

  return (
    <Modal
      popupOpen={open}
      handleClose={onClose}
      additionalClasses="w-full max-w-lg"
    >
      <form
        onSubmit={handleSubmit}
        // Modal overlay already applies backdrop-blur over the page;
        // stacking another blur-xl on the modal body is pure GPU
        // overhead. Bumped opacity /95 → /98 to compensate.
        className="relative overflow-hidden rounded-2xl border border-washi/15 bg-ink-1/98 shadow-2xl"
      >
        {/* Atmospheric accents — cream + hanko, no gold (reserved for collector) */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-washi/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-hanko/10 blur-3xl" />

        {/* 集 (shu, "gather/collect") watermark — vertical script, sat
            against the bottom-right corner. Cream-tinted to stay in the
            coffret family (gold is reserved for the collector toggle
            inside the form). Anchors the modal in the same kanji-poster
            voice as AddUpcomingVolumeModal's 来. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 -right-12 select-none font-jp text-[24rem] font-bold leading-none text-washi/[0.06]"
          style={{ writingMode: "vertical-rl" }}
        >
          集
        </span>

        <header className="relative border-b border-border/60 px-6 pt-6 pb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("coffret.label")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h2 className="mt-2 font-display text-2xl font-light italic leading-none tracking-tight text-washi md:text-3xl">
            {t("coffret.modalTitle")}{" "}
            <span className="font-semibold not-italic text-washi-muted">
              {t("coffret.modalTitleAccent")}
            </span>
          </h2>
          <p className="mt-2 max-w-md text-sm text-washi-muted">
            {t("coffret.modalByline")}
          </p>
        </header>

        <div className="relative space-y-4 px-6 py-5">
          {/* Range */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("coffret.rangeLabel")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={volStart}
                onChange={(e) => setVolStart(e.target.value)}
                className="w-20 rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
              />
              <span className="font-display text-lg italic text-washi-dim">
                →
              </span>
              <input
                type="number"
                min={volStart || 1}
                value={volEnd}
                onChange={(e) => setVolEnd(e.target.value)}
                className="w-20 rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
              />
              <span className="ml-2 flex-1 text-right font-mono text-xs text-washi-muted">
                {t("coffret.volumesCount", { n: volumesCount })}
              </span>
            </div>
            {rangeInvalid && (
              <p className="mt-1 font-mono text-[10px] text-hanko-bright">
                {t("coffret.rangeInvalid")}
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label
              htmlFor="coffret-name"
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("coffret.nameLabel")}
            </label>
            <input
              id="coffret-name"
              type="text"
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
              maxLength={100}
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
            />
          </div>

          {/* Price + store row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="coffret-price"
                className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
              >
                {t("coffret.priceLabel", {
                  symbol: currencySetting?.symbol || "$",
                })}
              </label>
              <input
                id="coffret-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
              />
              {pricePerVol && (
                <p className="mt-1 font-mono text-[10px] text-washi-dim">
                  {t("coffret.pricePerVol", {
                    amount: pricePerVol,
                    symbol: currencySetting?.symbol || "$",
                  })}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="coffret-store"
                className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
              >
                {t("coffret.storeLabel")}
              </label>
              <StoreAutocomplete
                id="coffret-store"
                placeholder={t("coffret.storePlaceholder")}
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-washi/50 focus:outline-none focus:ring-2 focus:ring-washi/20"
              />
            </div>
          </div>

          {/* Collector toggle — KEEPS the gold seal since this IS still the
              collector feature (orthogonal to coffret grouping). */}
          <button
            type="button"
            onClick={() => {
              setCollector((c) => !c);
              haptics.bump();
            }}
            aria-pressed={collector}
            className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
              collector
                ? "border-gold/70 bg-gradient-to-br from-gold/10 to-transparent"
                : "border-border bg-ink-1 hover:border-gold/40"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition ${
                  collector
                    ? "bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_0_10px_rgba(201,169,97,0.5)]"
                    : "bg-ink-2 text-washi-dim"
                }`}
                style={collector ? { transform: "rotate(-6deg)" } : undefined}
                title={t("badges.collector")}
              >
                限
              </span>
              <span>
                <span
                  className={`block text-sm font-semibold ${collector ? "text-gold" : "text-washi"}`}
                >
                  {t("coffret.collectorToggle")}
                </span>
                <span className="block text-[11px] text-washi-muted">
                  {t("coffret.collectorHint")}
                </span>
              </span>
            </span>
            <span
              className={`relative h-6 w-11 rounded-full border transition ${
                collector ? "border-gold bg-gold/90" : "border-border bg-ink-2"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                  collector
                    ? "right-0.5 bg-ink-0 shadow-md"
                    : "left-0.5 bg-washi-dim"
                }`}
              />
            </span>
          </button>
        </div>

        <div className="relative border-t border-border/60 px-6 pt-3 pb-4">
          {/* Tertiary "escape hatch" — offered only when the caller supplied
              a fallback (typically the barcode scan flow that may have
              misdetected a single volume as a coffret). Dotted underline,
              washi-dim, centered above the primary row so it looks like an
              intentional off-ramp rather than a CTA. */}
          {onSwitchToVolume && (
            <div className="mb-3 flex justify-center">
              <button
                type="button"
                onClick={onSwitchToVolume}
                disabled={createCoffret.isPending}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-washi-dim underline decoration-dotted underline-offset-4 transition hover:text-washi hover:decoration-solid disabled:opacity-50"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden="true"
                >
                  <path d="M9 14l-4-4 4-4" />
                  <path d="M5 10h11a4 4 0 0 1 4 4v2" />
                </svg>
                {t("coffret.notACoffret")}
              </button>
            </div>
          )}
          {/* Offline notice — coffret creation is online-only (server
              atomic transaction over coffret row + N volume rows, not
              currently outbox-queueable without a temp-id reconciliation
              pass). Explain rather than fail silently. */}
          {!online && (
            <div
              role="status"
              className="mb-3 flex items-start gap-2 rounded-md border border-hanko/30 bg-hanko/5 px-3 py-2 text-[11px] text-hanko-bright"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              >
                <path d="M1 1l22 22" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
              <span>{t("coffret.offlineRequired")}</span>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={createCoffret.isPending}
              className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi hover:border-border/80"
            >
              {t("common.cancel")}
            </button>
            {/* Primary CTA — hanko red, consistent with every other "save" in the app */}
            <button
              type="submit"
              disabled={
                createCoffret.isPending ||
                rangeInvalid ||
                volumesCount === 0 ||
                !online
              }
              title={!online ? t("coffret.offlineRequired") : undefined}
              className="relative flex-1 overflow-hidden rounded-lg bg-hanko px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi shadow-md transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {createCoffret.isPending
                ? t("common.saving")
                : t("coffret.createCta", { n: volumesCount })}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
