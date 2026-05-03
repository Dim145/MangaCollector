import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db.js";
import { useUpdateVolume } from "@/hooks/useVolumes.js";
import { useT, useLang } from "@/i18n/index.jsx";
import Modal from "./ui/Modal.jsx";
import { formatShortDate } from "@/utils/date.js";

/**
 * 預け Azuke · Self-contained loan editor for a single volume.
 *
 * Aesthetic — a vintage circulation slip dropped into the centre of
 * the screen. The form is laid out as two columns of inscriptions
 * (borrower / due date) over a paper-textured card with a hanko
 * stamp pressed across the top-right corner. The submit button
 * reads as a typewriter key cap rather than a flat CTA.
 *
 * Reads the volume directly from Dexie via `id`, so the modal can
 * be opened from any caller (the volume drawer, an inline button on
 * the dashboard rail, a future bulk-loan flow) without prop-threading.
 * The mutation rides through the same `useUpdateVolume` outbox path
 * as every other volume edit — offline support is automatic.
 */
export default function LoanModal({ open, volumeId, onClose }) {
  const t = useT();
  const lang = useLang();
  const updateVolume = useUpdateVolume();

  const volume = useLiveQuery(
    () => (volumeId != null ? db.volumes.get(volumeId) : null),
    [volumeId],
  );

  // Form state — initialised from the live volume row, kept local
  // so the user can edit without spamming the outbox per keystroke.
  const isLent = Boolean(volume?.loaned_to);
  const [borrower, setBorrower] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (!open) return;
    setBorrower(volume?.loaned_to ?? "");
    // <input type=date> wants a YYYY-MM-DD string. Strip the time
    // portion of the ISO timestamp; show empty for open-ended loans.
    setDueDate(
      volume?.loan_due_at ? toDateInputValue(volume.loan_due_at) : "",
    );
  }, [open, volume?.loaned_to, volume?.loan_due_at]);

  const lentLabel = useMemo(
    () => formatShortDate(volume?.loan_started_at, lang) || "—",
    [volume?.loan_started_at, lang],
  );

  if (!open) return null;

  async function handleLend(e) {
    e?.preventDefault?.();
    const trimmed = borrower.trim();
    if (!trimmed) return;
    const due = dueDate ? new Date(dueDate).toISOString() : null;
    await updateVolume.mutateAsync({
      id: volumeId,
      mal_id: volume?.mal_id,
      vol_num: volume?.vol_num,
      // Preserve other volume axes — the outbox merge keeps them
      // intact, but we still pass current values so the optimistic
      // Dexie write doesn't drop columns when this is the only op.
      owned: volume?.owned ?? true,
      price: Number(volume?.price) || 0,
      store: volume?.store ?? "",
      collector: Boolean(volume?.collector),
      loan: { to: trimmed, due_at: due },
    });
    onClose?.();
  }

  async function handleReturn() {
    await updateVolume.mutateAsync({
      id: volumeId,
      mal_id: volume?.mal_id,
      vol_num: volume?.vol_num,
      owned: volume?.owned ?? true,
      price: Number(volume?.price) || 0,
      store: volume?.store ?? "",
      collector: Boolean(volume?.collector),
      loan: null,
    });
    onClose?.();
  }

  return (
    <Modal popupOpen={true} handleClose={onClose}>
      <form
        onSubmit={handleLend}
        className="azuke-modal relative w-full max-w-md overflow-hidden rounded-md border border-border bg-ink-1 p-0 shadow-2xl"
      >
        {/* Punched corner — same circulation-card vocabulary as the
            dashboard widget cards. */}
        <span
          aria-hidden="true"
          className="azuke-corner absolute right-0 top-0 h-9 w-9 bg-hanko/15"
          style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
          }}
        />

        <header className="border-b border-border/70 px-6 pt-5 pb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
            {isLent ? t("loans.modalKickerEdit") : t("loans.modalKickerLend")}
            {" · "}
            <span className="font-jp text-[12px]">
              {isLent ? "預け編集" : "貸出"}
            </span>
          </p>
          <h2 className="mt-2 font-display text-xl font-light italic leading-tight text-washi">
            {isLent ? t("loans.modalTitleEdit") : t("loans.modalTitleLend")}
          </h2>
          {isLent && volume?.loan_started_at && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
              {t("loans.lentOn")} · <span className="text-washi">{lentLabel}</span>
            </p>
          )}
        </header>

        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
              {t("loans.borrowerLabel")} · 借
            </span>
            <input
              type="text"
              value={borrower}
              onChange={(e) => setBorrower(e.target.value)}
              maxLength={80}
              placeholder={t("loans.borrowerPlaceholder")}
              autoComplete="off"
              autoFocus
              className="w-full rounded-md border border-border bg-ink-0/60 px-3 py-2.5 font-display text-base italic text-washi placeholder:text-washi-dim placeholder:italic transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim">
              {t("loans.dueDateLabel")} · 期
            </span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-border bg-ink-0/60 px-3 py-2.5 font-mono text-sm tabular-nums text-washi transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
            <p className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-washi-dim">
              {t("loans.dueDateHint")}
            </p>
          </label>
        </div>

        {/* Footer — typewriter-style key caps for primary actions */}
        <div className="flex flex-col gap-2 border-t border-border/70 bg-ink-0/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {isLent ? (
            <button
              type="button"
              onClick={handleReturn}
              disabled={updateVolume.isPending}
              className="azuke-keycap inline-flex items-center justify-center gap-1.5 rounded-md border border-moegi/50 bg-moegi/8 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-moegi transition hover:border-moegi hover:bg-moegi/15 disabled:opacity-50"
            >
              <span aria-hidden="true" className="font-jp text-[12px] not-italic">
                返
              </span>
              {t("loans.returnAction")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={updateVolume.isPending}
              className="rounded-md border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-washi-muted transition hover:text-washi disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!borrower.trim() || updateVolume.isPending}
              className="azuke-keycap inline-flex items-center gap-1.5 rounded-md bg-hanko px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-washi transition hover:bg-hanko-bright disabled:opacity-60"
            >
              <span aria-hidden="true" className="font-jp text-[12px] not-italic">
                {isLent ? "更" : "貸"}
              </span>
              {updateVolume.isPending
                ? t("common.saving")
                : isLent
                  ? t("loans.updateAction")
                  : t("loans.lendAction")}
            </button>
          </div>
        </div>

        {/* Hanko corner stamp */}
        <span
          aria-hidden="true"
          className="azuke-hanko pointer-events-none absolute -bottom-3 -left-3 grid h-12 w-12 place-items-center rounded-full border border-hanko/55 bg-ink-1/95 font-jp text-base font-bold text-hanko-bright shadow-md"
          style={{ transform: "rotate(-8deg)" }}
        >
          預
        </span>
      </form>
    </Modal>
  );
}

function toDateInputValue(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    // YYYY-MM-DD in local timezone — matches what <input type=date>
    // expects without surfacing UTC drift on the user's clock.
    const yyyy = d.getFullYear().toString().padStart(4, "0");
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return "";
  }
}

