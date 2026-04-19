import { useEffect, useState } from "react";
import { useUpdateVolume } from "@/hooks/useVolumes.js";
import { formatCurrency } from "@/utils/price.js";

export default function Volume({
  id,
  mal_id,
  owned,
  volNum,
  paid,
  store,
  onUpdate,
  currencySetting,
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [ownedStatus, setOwnedStatus] = useState(owned);
  const [price, setPrice] = useState(Number(paid) || 0);
  const [purchaseLocation, setPurchaseLocation] = useState(store ?? "");

  const updateVolume = useUpdateVolume();
  const isLoading = updateVolume.isPending;

  async function persist(nextOwned, nextPrice, nextStore, ownedChanged) {
    await updateVolume.mutateAsync({
      id,
      mal_id,
      vol_num: volNum,
      owned: nextOwned,
      price: Number(nextPrice) || 0,
      store: nextStore ?? "",
    });
    onUpdate?.({ ownedChanged });
  }

  const toggleOwned = async () => {
    if (isEditing) return;
    const next = !ownedStatus;
    setOwnedStatus(next);
    await persist(next, price, purchaseLocation, true);
  };

  const handleSave = async () => {
    setIsEditing(false);
    const ownedChanged = ownedStatus !== owned;
    await persist(ownedStatus, price, purchaseLocation, ownedChanged);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
  };

  useEffect(() => {
    setOwnedStatus(owned);
    setPrice(Number(paid) || 0);
    setPurchaseLocation(store ?? "");
  }, [owned, paid, store]);

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border transition-all duration-300 ${
        ownedStatus
          ? "border-hanko/40 bg-hanko/5 hover:border-hanko/60"
          : "border-border bg-ink-1/40 hover:border-border/80"
      }`}
    >
      <div className="flex items-center gap-3 p-4">
        <button
          onClick={toggleOwned}
          disabled={isEditing || isLoading}
          aria-label={ownedStatus ? "Mark as not owned" : "Mark as owned"}
          className={`relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border font-mono text-xs font-bold transition ${
            ownedStatus
              ? "border-hanko bg-hanko text-washi shadow-md glow-red"
              : "border-border bg-ink-2 text-washi-dim hover:border-hanko/40 hover:text-washi"
          }`}
        >
          {isLoading ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <>
              <span className="text-[10px] font-semibold uppercase tracking-wider">
                Vol
              </span>
              <span className="absolute -bottom-0.5 right-0.5 text-[9px]">
                {volNum}
              </span>
            </>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-semibold leading-none text-washi">
            Volume {volNum}
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider ${
                ownedStatus ? "text-gold" : "text-washi-dim"
              }`}
            >
              {ownedStatus ? "In Collection" : "Missing"}
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
            aria-label="Edit volume"
            className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-washi-dim transition hover:bg-white/5 hover:text-washi"
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
              Status
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: true, label: "Owned" },
                { v: false, label: "Missing" },
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

          <div>
            <label
              htmlFor={`price-${id}`}
              className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim"
            >
              Price ({currencySetting?.symbol || "$"})
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
              Store / Location
            </label>
            <input
              id={`store-${id}`}
              type="text"
              maxLength={30}
              value={purchaseLocation ?? ""}
              onChange={(e) => setPurchaseLocation(e.target.value)}
              placeholder="Amazon, local shop…"
              className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={isLoading}
              className="flex-1 rounded-lg bg-hanko px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
            >
              {isLoading ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={isLoading}
              className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi hover:border-border/80"
            >
              Cancel
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
