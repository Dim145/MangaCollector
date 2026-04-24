import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "@/components/ui/Modal.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes } from "@/hooks/useVolumes.js";
import axios from "@/utils/axios.js";
import { getCachedUser } from "@/utils/auth.js";
import { clearAllUserData } from "@/lib/db.js";
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
 *     • User must TYPE a localised vow — "ERASE {name}" — as a
 *       physical act. The "erase" button fades in as they approach
 *       the expected phrase. Empty-handed attempts trigger a short
 *       shake. Irreversible once validated.
 *
 *   Why a vow and not the email?
 *     The /auth/user DTO was trimmed in the security-hardening pass
 *     (no email, no google_id), so we can't use email as the
 *     confirmation token any more — and we pointedly don't want to
 *     re-widen the DTO just to feed this one modal. A localised
 *     imperative phrase plus the user's display name is:
 *       - specific (requires awareness of the app language + your
 *         own name, neither of which password managers autofill)
 *       - shorter + easier on mobile keyboards
 *       - aligned with the already-ceremonial aesthetic of the
 *         flow (label already says "Scellez l'effacement", seal is
 *         the 消 kanji — a verbal oath fits the register).
 */
export default function DeleteAccountFlow({ open, onClose }) {
  const t = useT();

  const [step, setStep] = useState(0); // 0 = closed, 1 = registre, 2 = acte
  const [typed, setTyped] = useState("");
  const [shake, setShake] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const typedInputRef = useRef(null);

  // Identity token for the vow.
  //
  //   1st choice  — `name` (display name).
  //   2nd choice  — `public_slug` prefixed with `@` so it reads as a
  //                 handle even when the user never set a name.
  //   3rd choice  — dedicated fallback phrase that is LONGER than the
  //                 usual "VERB name" form. This preserves the
  //                 "takes some time to type" guard for edge-case
  //                 accounts that have neither name nor slug.
  //
  // All three are derived from the localStorage cache (populated by
  // the auth flow). We don't fetch from the server at open-time
  // because the point of the DTO trim is to NOT pull PII down again.
  const cached = getCachedUser();
  const verb = t("deleteAccount.vowEraseVerb");
  const fallbackPhrase = t("deleteAccount.vowFallbackPhrase");
  const { identity, expectedPhrase } = useMemo(() => {
    const name = (cached?.name || "").trim();
    if (name) return { identity: name, expectedPhrase: `${verb} ${name}` };
    const slug = (cached?.public_slug || "").trim();
    if (slug)
      return {
        identity: `@${slug}`,
        expectedPhrase: `${verb} @${slug}`,
      };
    return { identity: null, expectedPhrase: fallbackPhrase };
  }, [cached?.name, cached?.public_slug, verb, fallbackPhrase]);

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

  // Focus the vow input when step 2 opens — slight delay so the
  // modal's enter animation completes before we raise the mobile
  // keyboard (iOS Safari silently refuses focus() on a paint-not-
  // landed-yet element).
  useEffect(() => {
    if (step === 2) {
      setTimeout(() => typedInputRef.current?.focus(), 80);
    }
  }, [step]);

  // Normalise both sides the same way: collapse any inner whitespace
  // to a single space, strip surrounding whitespace, case-insensitive.
  // Accent-preserving on purpose: a user with an accented name still
  // has to type the accents — protects against mindless slam-typing.
  const normalise = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const expected = normalise(expectedPhrase);
  const typedNorm = normalise(typed);
  // Progressive reveal of the final button — fades in as user types.
  // Advances based on how many leading characters match, not just
  // length, so random mashing doesn't move the bar at all.
  const matchingPrefix = (() => {
    let i = 0;
    while (i < typedNorm.length && i < expected.length && typedNorm[i] === expected[i]) i++;
    return i;
  })();
  const progress =
    expected.length === 0
      ? 0
      : matchingPrefix / expected.length;
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
      // Wipe every client-side trace of this user: Dexie tables,
      // Workbox caches, TanStack Query cache, AND the
      // `mc:auth-user` localStorage entry (display name / email /
      // avatar). Previously this block only touched Dexie — on the
      // redirect to `/`, localStorage still held the old identity
      // until the next API call 401'd, during which a quick keep-
      // alive hit might flash the previous user's profile chip.
      await clearAllUserData();
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
          // Perf pass on this surface:
          //   • dropped `backdrop-blur-xl` — the Modal overlay
          //     already applies a backdrop-blur covering the whole
          //     viewport; stacking a second one on the modal body
          //     doubled the GPU cost for zero visual gain (the body
          //     is already opaque at bg-ink-0/95).
          //   • shadow radius 60px → 28px. GPU shadow cost scales
          //     with area, so halving the radius is roughly a 4×
          //     speedup on that layer with no perceptible change
          //     (60px was way past the point of visual diminishing
          //     returns for this use case).
          className={`relative w-full max-w-md overflow-hidden rounded-2xl border-2 border-hanko/70 bg-ink-0/95 shadow-[0_0_28px_rgba(220,38,38,0.45)] ${
            shake ? "animate-shake" : ""
          }`}
        >
          {/* Pulsing red glow behind.
              `will-change` pre-promotes the layer to its own GPU
              texture so `transform: scale` + `opacity` stay on the
              compositor thread and never trigger a re-rasterisation
              of the radial gradient (which would be very expensive
              because it's 2× the modal size via -inset-20). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-20 animate-delete-pulse opacity-40"
            style={{
              backgroundImage:
                "radial-gradient(ellipse 60% 50% at 50% 30%, var(--hanko-glow), transparent 70%)",
              willChange: "transform, opacity",
            }}
          />

          <header className="relative flex flex-col items-center px-8 pt-7 pb-3">
            {/* 消 seal — grows on hover, grows further when final
                delete clicked.
                Rotation moved into the CSS transform chain so it
                composes with the scale changes rather than fighting
                them. Shadow radius reduced from 26px to 14px for the
                same GPU-cost reason as the container. */}
            <span
              aria-hidden="true"
              className={`grid h-16 w-16 place-items-center rounded-md bg-gradient-to-br from-hanko-bright to-hanko-deep text-washi shadow-[0_0_14px_var(--hanko-glow)] transition-transform duration-500 ${
                submitting
                  ? "[transform:rotate(-3deg)_scale(1.6)]"
                  : matches
                    ? "[transform:rotate(-3deg)_scale(1.1)]"
                    : "[transform:rotate(-3deg)]"
              }`}
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
              <span className="mb-2 block text-center font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                {t("deleteAccount.vowLabel")}
              </span>

              {/* ── The vow card ──
                  Calligraphic display of the expected phrase, rendered
                  as a leaning brush-stroke oath. The verb gets the
                  hanko accent, the identity half gets washi. A subtle
                  rotation + hairline underline sell the "seal on
                  paper" feel. Matches the actTitle tone rather than
                  the utilitarian <code> block we had before. */}
              <VowCard
                verb={verb}
                identity={identity}
                fallbackPhrase={identity ? null : fallbackPhrase}
                hint={t("deleteAccount.vowIdentityHint")}
                matches={matches}
              />

              <input
                ref={typedInputRef}
                type="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck="false"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("deleteAccount.vowPlaceholder")}
                aria-label={t("deleteAccount.vowLabel")}
                aria-invalid={typed.length > 0 && !matches}
                className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2.5 text-center font-mono text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/70 focus:outline-none focus:ring-2 focus:ring-hanko/20"
              />
              {/* Progress bar — fills based on matching PREFIX length,
                  not raw length. Random keystrokes don't advance it;
                  only correct typing does. When complete, the gradient
                  locks to the hanko tones.
                  Driven by `transform: scaleX` with a fixed-width
                  inner bar — compositor-only. The previous version
                  animated `width` directly, which fires a layout +
                  paint on every keystroke (bar width is derived
                  from typed state, so that's a repaint per key).
                  `transform-origin: left` anchors the growth. */}
              <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-washi/10">
                <div
                  className={`h-full w-full origin-left transition-transform duration-300 will-change-transform ${
                    matches
                      ? "bg-gradient-to-r from-hanko to-hanko-bright"
                      : "bg-gradient-to-r from-washi-dim to-hanko/40"
                  }`}
                  style={{ transform: `scaleX(${progress})` }}
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
              className={`group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full border border-hanko bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright px-5 py-3 font-display text-sm font-bold uppercase tracking-[0.2em] text-washi shadow-[0_0_12px_var(--hanko-glow)] transition-transform active:scale-95 ${
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

/* ─────────────────── Vow card — calligraphic phrase to reproduce ─────
 *
 * Visual anchor of step 2. The user's "oath" sits in this card; the
 * adjacent input demands they reproduce it.
 *
 * Two modes:
 *   • `identity` set   →  split display: VERB in hanko, identity in
 *                         washi, a middle-dot kanji-style separator
 *                         between them.
 *   • `fallbackPhrase` →  single-line rendering of the ceremonial
 *                         phrase when the user has no name/slug.
 *
 * When the user's typed text matches, the card gets a soft hanko glow
 * (no loud animation — this is still a destructive flow, not a
 * celebration).
 */
function VowCard({ verb, identity, fallbackPhrase, hint, matches }) {
  const base =
    "relative mx-auto mb-3 overflow-hidden rounded-xl border px-4 py-3 transition-colors duration-300";
  // Perf: the "matched" state previously added a third large
  // box-shadow (0_0_18px) on top of the container's already-heavy
  // glow. On a ceremonial modal where the user is actively typing,
  // every frame's compositing bill adds up. We swap to a slightly
  // stronger border color + the existing bg tint for the same
  // visual "the match is registered" signal, without the shadow.
  const tone = matches
    ? "border-hanko/70 bg-hanko/10"
    : "border-hanko/30 bg-ink-1";

  return (
    <div className={`${base} ${tone}`} style={{ transform: "rotate(-0.35deg)" }}>
      {/* Paper-seal hairline — top */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-hanko/60 to-transparent"
      />
      {/* Small 消 sigil, quietly placed as a stamp */}
      <span
        aria-hidden="true"
        className="absolute right-2.5 top-2 font-display text-[11px] leading-none text-hanko/60"
        style={{ letterSpacing: "-0.05em" }}
      >
        消
      </span>

      {fallbackPhrase ? (
        // No name available — render the full ceremonial phrase on
        // one line, no identity split. Slightly tighter tracking so
        // it doesn't overflow on narrow viewports.
        <p className="text-center font-display text-base italic leading-snug tracking-tight text-hanko-bright sm:text-lg">
          {fallbackPhrase}
        </p>
      ) : (
        <p className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-0.5 text-center leading-tight">
          <span className="font-display text-xl font-bold uppercase tracking-[0.12em] text-hanko-bright sm:text-2xl">
            {verb}
          </span>
          <span
            aria-hidden="true"
            className="font-display text-sm text-washi-dim"
          >
            ·
          </span>
          <span className="font-display text-xl italic text-washi sm:text-2xl">
            {identity}
          </span>
        </p>
      )}

      {!fallbackPhrase && (
        <p className="mt-1 text-center font-mono text-[9px] uppercase tracking-[0.22em] text-washi-dim">
          {hint}
        </p>
      )}
    </div>
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
