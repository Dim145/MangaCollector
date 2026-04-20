import { useEffect, useState } from "react";
import { useUpdateVolume } from "@/hooks/useVolumes.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

export default function Volume({
  id,
  mal_id,
  owned,
  volNum,
  paid,
  store,
  collector,
  onUpdate,
  currencySetting,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState(owned);
  const [price, setPrice] = useState(Number(paid) || 0);
  const [purchaseLocation, setPurchaseLocation] = useState(store ?? "");
  const [collectorStatus, setCollectorStatus] = useState(Boolean(collector));

  const updateVolume = useUpdateVolume();
  const isLoading = updateVolume.isPending;
  const t = useT();

  async function persist(nextOwned, nextPrice, nextStore, nextCollector, ownedChanged) {
    await updateVolume.mutateAsync({
      id,
      mal_id,
      vol_num: volNum,
      owned: nextOwned,
      price: Number(nextPrice) || 0,
      store: nextStore ?? "",
      collector: Boolean(nextCollector),
    });
    onUpdate?.({ ownedChanged });
  }

  const toggleOwned = async () => {
    if (isEditing) return;
    const next = !ownedStatus;
    setOwnedStatus(next);
    await persist(next, price, purchaseLocation, collectorStatus, true);
  };

  const handleSave = async () => {
    setIsEditing(false);
    const ownedChanged = ownedStatus !== owned;
    await persist(ownedStatus, price, purchaseLocation, collectorStatus, ownedChanged);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
  };

  useEffect(() => {
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
    setCollectorStatus(Boolean(collector));
  }, [owned, paid, store, collector]);

  // Card shell — collector adds a gold ring + subtle gold glow, stacking on
  // top of whatever the ownership state dictates.
  const borderClasses = collectorStatus
    ? "border-transparent ring-2 ring-gold/80 shadow-[0_0_22px_rgba(201,169,97,0.25)]"
    : ownedStatus
      ? "border-hanko/40 bg-hanko/5 hover:border-hanko/60"
      : "border-border bg-ink-1/40 hover:border-border/80";

  // Volume-number badge colors: gold-inverted when collector, hanko when
  // merely owned, neutral otherwise.
  const badgeClasses = collectorStatus
    ? "border-gold bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-md"
    : ownedStatus
      ? "border-hanko bg-hanko text-washi shadow-md glow-red"
      : "border-border bg-ink-2 text-washi-dim hover:border-hanko/40 hover:text-washi";

  return (
    <div
      className={`group relative rounded-xl border transition-all duration-300 ${collectorStatus ? "bg-gradient-to-br from-gold/5 via-ink-1/40 to-ink-1/40" : ""} ${borderClasses}`}
    >
      {/* Hanko gold seal — pinned like a wax seal at the card's top-right
          corner, peeking past the border so it reads as a "stamp affixed to
          the document" rather than a floating UI chip. Stays clear of the
          pencil on the right of the flex row (the pencil lives inside the
          card's p-4; the seal overflows the border). */}
      {collectorStatus && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-2 -top-2 z-20 grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_2px_12px_rgba(201,169,97,0.6)] ring-1 ring-gold/80"
          style={{ transform: "rotate(-8deg)" }}
          title={t("volume.collectorTitle")}
        >
          <span className="font-display text-[10px] font-bold leading-none">
            限
          </span>
        </span>
      )}

      <div className="flex items-center gap-3 p-4">
        <button
          onClick={toggleOwned}
          disabled={isEditing || isLoading}
          aria-label={
            ownedStatus ? t("volume.markNotOwned") : t("volume.markOwned")
          }
          className={`relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border font-mono text-xs font-bold transition ${badgeClasses}`}
        >
          {isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                {t("manga.volumesShort")}
              </span>
              <span className="absolute -bottom-0.5 right-0.5 text-[9px]">
                {volNum}
              </span>
            </>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 font-display text-base font-semibold leading-none text-washi">
            <span>{t("volume.volume", { n: volNum })}</span>
            {collectorStatus && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/50 bg-gold/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-gold">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-2.5 w-2.5"
                  aria-hidden="true"
                >
                  <path d="M12 2l2.5 6.5L21 9l-5 4.8L17.5 21 12 17.5 6.5 21l1.5-7.2L3 9l6.5-.5L12 2z" />
                </svg>
                {t("volume.collectorBadge")}
              </span>
            )}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${
                ownedStatus ? "text-gold" : "text-washi-dim"
              }`}
            >
              {ownedStatus ? t("volume.inCollection") : t("volume.missing")}
            </span>
            {ownedStatus && price > 0 && (
              <span className="font-mono text-xs text-washi-muted">
                {formatCurrency(price, currencySetting)}
              </span>
            )}
          </div>
        </div>

        {!isEditing ? (
          <button
            onClick={() => setIsEditing(true)}
            aria-label={t("common.edit")}
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-washi-dim transition hover:bg-washi/5 hover:text-washi"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
        ) : null}
      </div>

      {isEditing && (
        <div className="space-y-3 border-t border-border bg-ink-0/40 p-4 animate-fade-up">
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("volume.statusLabel")}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: t("volume.ownedOption") },
                { v: false, label: t("volume.missingOption") },
              ].map((opt) => (
                <button
                  key={String(opt.v)}
                  onClick={() => setOwnedStatus(opt.v)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                    ownedStatus === opt.v
                      ? opt.v
                        ? "border-hanko bg-hanko text-washi"
                        : "border-border bg-ink-2 text-washi"
                      : "border-border bg-transparent text-washi-dim hover:text-washi"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Collector toggle — a distinct gold-accented switch so users
              associate it with the "rare / limited" visual language. */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
              {t("volume.editionLabel")}
            </label>
            <button
              type="button"
              onClick={() => setCollectorStatus((c) => !c)}
              aria-pressed={collectorStatus}
              className={`group flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                collectorStatus
                  ? "border-gold/70 bg-gradient-to-br from-gold/10 to-transparent"
                  : "border-border bg-ink-1 hover:border-gold/40"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold transition ${
                    collectorStatus
                      ? "bg-gradient-to-br from-gold to-gold-muted text-ink-0 shadow-[0_0_10px_rgba(201,169,97,0.5)]"
                      : "bg-ink-2 text-washi-dim"
                  }`}
                  style={
                    collectorStatus ? { transform: "rotate(-6deg)" } : undefined
                  }
                >
                  限
                </span>
                <span>
                  <span className={`block text-sm font-semibold ${collectorStatus ? "text-gold" : "text-washi"}`}>
                    {t("volume.collectorOption")}
                  </span>
                  <span className="block text-[11px] text-washi-muted">
                    {t("volume.collectorHint")}
                  </span>
                </span>
              </span>
              <span
                className={`relative h-6 w-11 rounded-full border transition ${
                  collectorStatus
                    ? "border-gold bg-gold/90"
                    : "border-border bg-ink-2"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                    collectorStatus
                      ? "right-0.5 bg-ink-0 shadow-md"
                      : "left-0.5 bg-washi-dim"
                  }`}
                />
              </span>
            </button>
          </div>

          <div>
            <label
              htmlFor={`price-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.priceLabel", {
                symbol: currencySetting?.symbol || "$",
              })}
            </label>
            <input
              id={`price-${id}`}
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onFocus={(e) => {
                if (Number(e.target.value) === 0) e.target.select();
              }}
              placeholder="0"
              step="0.01"
              min="0"
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>

          <div>
            <label
              htmlFor={`store-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              {t("volume.storeLabel")}
            </label>
            <input
              id={`store-${id}`}
              type="text"
              maxLength={30}
              value={purchaseLocation ?? ""}
              onChange={(e) => setPurchaseLocation(e.target.value)}
              placeholder={t("volume.storePlaceholder")}
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 rounded-lg bg-hanko px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
            >
              {isLoading ? t("common.saving") : t("common.save")}
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi hover:border-border/80"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {!isEditing && ownedStatus && purchaseLocation && (
        <div className="flex items-center gap-1.5 border-t border-border/50 px-4 py-2 text-[11px] text-washi-muted">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3 text-washi-dim"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
          <span className="truncate">{purchaseLocation}</span>
        </div>
      )}
    </div>
  );
}
