import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Modal from "@/components/utils/Modal.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import axios from "@/utils/axios.js";
import { getCachedUser } from "@/utils/auth.js";
import { db } from "@/lib/db.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Two-step GDPR account-deletion flow. Designed as a deliberately
 * ceremonial pair of modals:
 *
 *   Step 1 — "Le registre"  (solemn editorial notice)
 *     • Shows a manifest of what's about to be erased: series, volumes,
 *       coffrets, custom posters, total spent.
 *     • Each number counts up from zero with a stagger, materialising
 *       the scale of the loss.
 *     • Passive action "Relire" / committed action "Je comprends".
 *
 *   Step 2 — "L'acte"  (the final gate)
 *     • User must TYPE their email to proceed — a physical act, not a
 *       click. The "erase" button fades in as they type correctly.
 *     • Empty-handed attempts trigger a short shake.
 *     • Irreversible once validated: calls DELETE /api/user/account,
 *       wipes every local Dexie table, signs out, redirects to /.
 */
export default function DeleteAccountFlow({ open, onClose }) {
  const t = useT();
  const navigate = useNavigate();

  const [step, setStep] = useState(0); // 0 = closed, 1 = registre, 2 = acte
  const [typed, setTyped] = useState("");
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const typedInputRef = useRef(null);

  // Email is the confirmation token. Seed synchronously from localStorage
  // (written by the auth flow) so the user doesn't see "(email inconnu)"
  // flash, then freshen from /auth/user when the flow opens in case the
  // cache is stale.
  const [email, setEmail] = useState(() => getCachedUser()?.email ?? "");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    axios
      .get("/auth/user")
      .then((res) => {
        if (!cancelled && res.data?.email) setEmail(res.data.email);
      })
      .catch(() => {
        /* keep the cached value */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Data used in step 1 manifest — derived from live Dexie, so counts
  // reflect what the user actually sees in their library right now.
  const { data: library } = useLibrary();
  const { data: volumes } = useAllVolumes();

  const manifest = useMemo(() => {
    const libArr = library ?? [];
    const volArr = volumes ?? [];
    return {
      series: libArr.length,
      volumes: volArr.filter((v) => v.owned).length,
      coffrets: new Set(volArr.filter((v) => v.coffret_id).map((v) => v.coffret_id)).size,
      customPosters: libArr.filter(
        (m) => typeof m.image_url_jpg === "string" && !m.image_url_jpg.startsWith("http"),
      ).length,
      spent: volArr
        .filter((v) => v.owned)
        .reduce((s, v) => s + (Number(v.price) || 0), 0),
    };
  }, [library, volumes]);

  useEffect(() => {
    if (open) {
      setStep(1);
      setTyped("");
      setErrorMsg(null);
    } else {
      setStep(0);
    }
  }, [open]);

  // Focus the email input when step 2 opens
  useEffect(() => {
    if (step === 2) {
      setTimeout(() => typedInputRef.current?.focus(), 80);
    }
  }, [step]);

  const expected = (email ?? "").trim().toLowerCase();
  const typedNorm = typed.trim().toLowerCase();
  // Progressive reveal of the final button — fades in as user types.
  const progress =
    expected.length === 0
      ? 0
      : Math.min(typedNorm.length, expected.length) /
        Math.max(expected.length, 1);
  const matches = typedNorm.length > 0 && typedNorm === expected;

  const handleClose = () => {
    if (submitting) return;
    setStep(0);
    setTyped("");
    setErrorMsg(null);
    onClose?.();
  };

  const handleConfirmDelete = async () => {
    if (!matches || submitting) {
      setShake(true);
      setTimeout(() => setShake(false), 360);
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      await axios.delete("/api/user/account");
      // Wipe all local state so no ghost data remains
      await db.library.clear();
      await db.volumes.clear();
      await db.settings.clear();
      await db.outboxLibrary.clear();
      await db.outboxVolumes.clear();
      await db.outboxSettings.clear();
      // Hard redirect so every hook / context tree resets from scratch.
      window.location.assign("/");
    } catch (err) {
      setErrorMsg(
        err?.response?.data?.error ??
          err?.message ??
          t("deleteAccount.error"),
      );
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* ────────────────── STEP 1 · Le registre ────────────────── */}
      <Modal popupOpen={step === 1} handleClose={handleClose}>
        <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-gold/40 bg-ink-1/98 shadow-2xl backdrop-blur-xl">
          {/* Top gold hairline */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/70 to-transparent"
          />
          {/* Solemn kanji seal */}
          <div className="flex flex-col items-center border-b border-gold/20 px-8 pt-8 pb-4">
            <span
              aria-hidden="true"
              className="grid h-14 w-14 place-items-center rounded-md border border-gold/60 bg-gradient-to-br from-ink-2 to-ink-0 text-gold shadow-[0_4px_18px_rgba(201,169,97,0.35)]"
              style={{ transform: "rotate(-4deg)" }}
            >
              <span className="font-display text-2xl font-bold leading-none">
                録
              </span>
            </span>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.3em] text-gold">
              {t("deleteAccount.registryLabel")}
            </p>
            <h2 className="mt-1 text-center font-display text-2xl font-semibold italic leading-tight text-washi md:text-3xl">
              {t("deleteAccount.registryTitle")}
            </h2>
          </div>

          <div className="px-8 py-6">
            <p className="mb-5 text-sm text-washi-muted">
              {t("deleteAccount.registryBody")}
            </p>

            <ul className="space-y-2.5">
              <ManifestRow
                i={0}
                label={t("deleteAccount.manifestSeries")}
                value={manifest.series}
              />
              <ManifestRow
                i={1}
                label={t("deleteAccount.manifestVolumes")}
                value={manifest.volumes}
              />
              <ManifestRow
                i={2}
                label={t("deleteAccount.manifestCoffrets")}
                value={manifest.coffrets}
              />
              <ManifestRow
                i={3}
                label={t("deleteAccount.manifestPosters")}
                value={manifest.customPosters}
              />
              <ManifestRow
                i={4}
                label={t("deleteAccount.manifestSpent")}
                value={manifest.spent}
                decimal={2}
                suffix="€"
              />
            </ul>

            <p className="mt-6 rounded-md border border-hanko/40 bg-hanko/5 px-3 py-2 text-center font-mono text-[11px] uppercase tracking-[0.15em] text-hanko-bright">
              {t("deleteAccount.irreversibleNotice")}
            </p>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-border bg-ink-0/40 px-8 py-4">
            <button
              onClick={handleClose}
              className="rounded-full border border-border bg-ink-2 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-washi/30 hover:text-washi"
            >
              {t("deleteAccount.registryBack")}
            </button>
            <button
              onClick={() => setStep(2)}
              className="inline-flex items-center gap-2 rounded-full border border-gold/70 bg-gradient-to-br from-gold to-gold-muted px-5 py-2 text-xs font-bold uppercase tracking-wider text-ink-0 shadow-[0_4px_14px_rgba(201,169,97,0.35)] transition hover:brightness-110 active:scale-95"
            >
              {t("deleteAccount.registryAdvance")}
            </button>
          </footer>
        </div>
      </Modal>

      {/* ────────────────── STEP 2 · L'acte ────────────────── */}
      <Modal popupOpen={step === 2} handleClose={handleClose}>
        <div
          className={`relative w-full max-w-md overflow-hidden rounded-2xl border-2 border-hanko/70 bg-ink-0/95 shadow-[0_0_60px_rgba(220,38,38,0.45)] backdrop-blur-xl ${
            shake ? "animate-shake" : ""
          }`}
        >
          {/* Pulsing red glow behind */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-20 animate-delete-pulse opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 50% at 50% 30%, var(--hanko-glow), transparent 70%)",
            }}
          />

          <header className="relative flex flex-col items-center px-8 pt-7 pb-3">
            {/* 消 seal — grows on hover, grows further when final delete clicked */}
            <span
              aria-hidden="true"
              className={`grid h-16 w-16 place-items-center rounded-md bg-gradient-to-br from-hanko-bright to-hanko-deep text-washi shadow-[0_0_26px_var(--hanko-glow)] transition-transform duration-500 ${
                submitting ? "scale-[1.6]" : matches ? "scale-110" : ""
              }`}
              style={{ transform: "rotate(-3deg)" }}
            >
              <span className="font-display text-3xl font-bold leading-none">
                消
              </span>
            </span>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.4em] text-hanko-bright">
              {t("deleteAccount.actLabel")}
            </p>
            <h2 className="mt-1 text-center font-display text-xl font-semibold italic text-washi md:text-2xl">
              {t("deleteAccount.actTitle")}
            </h2>
          </header>

          <div className="relative px-8 pb-2">
            <p className="mb-4 text-center text-sm leading-relaxed text-washi-muted">
              {t("deleteAccount.actBody")}
            </p>

            <label className="block">
              <span className="mb-1.5 block text-center font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                {t("deleteAccount.typeEmailLabel")}
              </span>
              <code className="mb-2 block truncate rounded border border-hanko/30 bg-ink-1 px-3 py-1.5 text-center font-mono text-xs text-hanko-bright">
                {email || t("deleteAccount.emailUnknown")}
              </code>
              <input
                ref={typedInputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("deleteAccount.typeEmailPlaceholder")}
                className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2.5 text-center font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/70 focus:outline-none focus:ring-2 focus:ring-hanko/20"
              />
              {/* Progress bar under the input — fills as user types */}
              <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-washi/10">
                <div
                  className={`h-full transition-all duration-300 ${
                    matches
                      ? "bg-gradient-to-r from-hanko to-hanko-bright"
                      : "bg-gradient-to-r from-washi-dim to-hanko/40"
                  }`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </label>

            {errorMsg && (
              <p className="mt-3 rounded border border-hanko/40 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
                {errorMsg}
              </p>
            )}
          </div>

          <footer className="relative flex flex-col gap-2 px-8 py-4">
            <button
              onClick={handleConfirmDelete}
              disabled={!matches || submitting}
              aria-disabled={!matches || submitting}
              // Progressive materialisation — even disabled, the button
              // is partly visible so the user SEES what awaits them.
              style={{ opacity: 0.25 + progress * 0.75 }}
              className={`group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-hanko bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.2em] text-washi shadow-[0_0_24px_var(--hanko-glow)] transition-transform active:scale-95 ${
                matches && !submitting
                  ? "cursor-pointer hover:brightness-110"
                  : "cursor-not-allowed"
              }`}
            >
              {submitting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                  <span>{t("deleteAccount.submitting")}</span>
                </>
              ) : (
                <span>{t("deleteAccount.finalCta")}</span>
              )}
            </button>
            <button
              onClick={handleClose}
              disabled={submitting}
              className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim transition hover:text-washi disabled:opacity-40"
            >
              {t("deleteAccount.actCancel")}
            </button>
          </footer>
        </div>
      </Modal>
    </>
  );
}

/* ─────────────────── Manifest row — animated counter ─────────────────── */
function ManifestRow({ i, label, value, decimal = 0, suffix = "" }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    // Count-up animation — staggered per row to let the user notice each
    // number appear one by one.
    const delay = 120 + i * 110;
    const duration = 520;
    const start = performance.now() + delay;
    let raf;
    const tick = (now) => {
      if (now < start) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      // Ease-out
      const eased = 1 - Math.pow(1 - t, 3);
      setN(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setN(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, i]);

  const displayed = decimal > 0 ? n.toFixed(decimal) : Math.round(n);

  return (
    <li
      className="flex items-baseline justify-between gap-4 border-b border-border/40 pb-2 last:border-b-0"
      style={{ animation: "fade-in 0.4s ease-out both", animationDelay: `${80 + i * 100}ms` }}
    >
      <span className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
        {label}
      </span>
      <span className="font-display text-2xl font-semibold tabular-nums text-washi">
        {displayed}
        {suffix && (
          <span className="ml-1 font-mono text-sm text-washi-muted">{suffix}</span>
        )}
      </span>
    </li>
  );
}
