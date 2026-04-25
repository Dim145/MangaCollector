import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import MangaSearchBar from "@/components/MangaSearchBar.jsx";
import MangaSearchResults from "@/components/MangaSearchResults.jsx";
import BarcodeScanner from "@/components/BarcodeScanner.jsx";
import ScanLoadingView from "@/components/ScanLoadingView.jsx";
import Modal from "@/components/ui/Modal.jsx";
import AddCoffretModal from "@/components/AddCoffretModal.jsx";
import MangadexPrefillModal from "@/components/MangadexPrefillModal.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useAddManga, useLibrary } from "@/hooks/useLibrary.js";
import { useOnline } from "@/hooks/useOnline.js";
import { useScanCommit } from "@/hooks/useScanCommit.js";
import { consumeTourStep, TOUR_STEPS } from "@/lib/tour.js";
import { pickShareQuery } from "@/lib/share.js";
import {
  addCustomEntryToUserLibrary,
  addFromMangadexToUserLibrary,
} from "@/utils/user.js";
import { db } from "@/lib/db.js";
import {
  detectCoffret,
  lookupISBN,
  normalizeISBN,
  searchExternal,
} from "@/lib/isbn.js";
import { useT } from "@/i18n/index.jsx";

const TRANSIENT_ERROR_TIMEOUT_MS = 2500;

export default function AddPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const [customEntry, setCustomEntry] = useState(false);
  const [customEntryTitle, setCustomEntryTitle] = useState("");
  const [customEntryGenres, setCustomEntryGenres] = useState("");
  const [customEntryVolumes, setCustomEntryVolumes] = useState(0);

  // MangaDex-only results open this modal so the user fills in the volume
  // count (MangaDex rarely publishes one).
  const [mangadexPrefill, setMangadexPrefill] = useState(null);

  // ─── Scanner state machine ──────────────────────────────────────────
  // Phases that pause the camera detection:
  //   'looking-up'    → Google Books / MAL in flight
  //   'positive'      → match found; showing confirmation card
  //   'not-found'     → Google Books has no result for this ISBN
  //   'transient'     → network / 5xx error, auto-resumes
  // 'scanning' = active detection.
  // Rate-limit errors (429) close the scanner and open a separate modal.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanPhase, setScanPhase] = useState("scanning");
  const [scanStatus, setScanStatus] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [scanCandidateIdx, setScanCandidateIdx] = useState(0);
  const [scanNotFound, setScanNotFound] = useState(null); // { isbn, bookTitle? }
  const [scanTransientError, setScanTransientError] = useState(null);
  const [rateLimited, setRateLimited] = useState(null); // { message }
  // Coffret detected on scan — routes to AddCoffretModal pre-filled instead
  // of the standard single-volume confirmation card. A "Not a coffret?"
  // button inside the modal flips back to the regular volume flow.
  const [scanCoffret, setScanCoffret] = useState(null);
  const [committing, setCommitting] = useState(false);
  const [recentScans, setRecentScans] = useState([]);

  const { adult_content_level, currency: currencySetting } =
    useContext(SettingsContext);
  const navigate = useNavigate();
  const online = useOnline();
  const t = useT();

  // 始 · Welcome-tour AND PWA-shortcut handoff.
  // Two entry points feed the same choreography: (1) a tour step
  // stashed in sessionStorage by WelcomeTour, (2) a `shortcut=…` query
  // param the launcher passes when the user long-presses the installed
  // PWA icon. Both surface as the same intent here, so the rest of the
  // page reacts identically.
  //
  // Order matters: the URL param wins over the session step so a user
  // who explicitly tapped "Scan ISBN" in the launcher menu can't be
  // silently overridden by a stale tour flag. consumeTourStep() still
  // runs unconditionally so the session entry is cleared either way.
  const [tourFocusSearch, setTourFocusSearch] = useState(false);
  useEffect(() => {
    let intent = null;
    let shareQuery = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("shortcut");
      if (raw === "scan") intent = TOUR_STEPS.SCAN;
      else if (raw === "library") intent = TOUR_STEPS.LIBRARY;

      // 共有 · Web Share Target payload. Three params, any subset may
      // be present. lib/share.js condenses them into a single search
      // candidate; null means the share carried no usable signal.
      shareQuery = pickShareQuery({
        title: params.get("share_title"),
        text: params.get("share_text"),
        url: params.get("share_url"),
      });

      // Strip every param we consumed so a manual reload doesn't re-
      // fire the scanner / focus / search side-effects ad infinitum.
      // replaceState keeps the route stable and out of history.
      const consumed = ["shortcut", "share_title", "share_text", "share_url"];
      let mutated = false;
      for (const key of consumed) {
        if (params.has(key)) {
          params.delete(key);
          mutated = true;
        }
      }
      if (mutated) {
        const qs = params.toString();
        const url = window.location.pathname + (qs ? `?${qs}` : "");
        window.history.replaceState(null, "", url);
      }
    } catch {
      /* URL parsing failure — silent, fall through to the session step */
    }

    const sessionStep = consumeTourStep();
    if (!intent) intent = sessionStep;

    if (intent === TOUR_STEPS.SCAN) {
      // Defer one frame so the AddPage layout is mounted before we open
      // the scanner overlay — getUserMedia rejects on some browsers if
      // requested before the route transition settles.
      const raf = requestAnimationFrame(() => setScannerOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    if (intent === TOUR_STEPS.LIBRARY) {
      setTourFocusSearch(true);
    }

    // Share-target arrival — pre-fill the search bar with the
    // extracted candidate and auto-run the MAL/MangaDex search so the
    // user lands on a result list with zero taps. Skipped silently if
    // we already routed to the scanner (mutually exclusive with SCAN).
    if (shareQuery && intent !== TOUR_STEPS.SCAN) {
      setQuery(shareQuery);
      // Run the search after this microtask so React has flushed the
      // setQuery — keeps the input visibly filled before the network
      // request (perceived responsiveness).
      queueMicrotask(() => {
        runSearch(shareQuery);
      });
      // Force-focus the search bar even when no tour step asked for it.
      setTourFocusSearch(true);
    }
  }, []);

  // onBarcodeDetected is a stable useCallback([]) — expose the current
  // currency code through a ref so prefill stays in sync with settings.
  const currencyCodeRef = useRef(currencySetting?.code);
  useEffect(() => {
    currencyCodeRef.current = currencySetting?.code;
  }, [currencySetting?.code]);

  const { data: library } = useLibrary();
  const addManga = useAddManga();
  const commitScan = useScanCommit();

  // `runSearch` accepts an explicit query so external triggers (the
  // share-target handoff below) can fire it without going through a
  // setQuery → re-render → searchManga round-trip. The button-driven
  // path is just a thin closure over `query` for backwards compat.
  const runSearch = async (q) => {
    const trimmed = (q ?? "").trim();
    if (!trimmed || !online) return;
    try {
      setLoading(true);
      setSearched(true);
      const data = await searchExternal(trimmed);
      setResults(data);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setLoading(false);
    }
  };
  const searchManga = () => runSearch(query);

  // Entries already in the user's library — checked by either id so MAL
  // results and MangaDex results both get the "owned" badge when applicable.
  const isInLibrary = (result) => {
    if (
      result.mal_id != null &&
      library?.some((m) => m.mal_id === result.mal_id)
    ) {
      return true;
    }
    if (
      result.mangadex_id &&
      library?.some((m) => m.mangadex_id === result.mangadex_id)
    ) {
      return true;
    }
    return false;
  };

  const addToLibrary = async (result) => {
    if (isInLibrary(result)) return;

    // MangaDex-only → no reliable volume count, open prefill modal
    if (result.source === "mangadex") {
      setMangadexPrefill(result);
      return;
    }

    // MAL-sourced (source = "mal" or "both") — data already carries a
    // volume count and (optionally) a MangaDex id we carry through for
    // future refresh-from-mangadex.
    const mangaData = {
      name: result.name,
      mal_id: result.mal_id,
      volumes: result.volumes ?? 0,
      volumes_owned: 0,
      image_url_jpg: result.image_url ?? null,
      genres: result.genres ?? [],
      mangadex_id: result.mangadex_id ?? null,
    };
    await addManga.mutateAsync(mangaData);
  };

  const confirmMangadexAdd = async (payload) => {
    const res = await addFromMangadexToUserLibrary(payload);
    if (res?.success) {
      setMangadexPrefill(null);
      navigate("/mangapage", {
        state: {
          manga: res.newEntry ?? {
            ...payload,
            mal_id: null,
            mangadex_id: payload.mangadex_id,
          },
          adult_content_level,
        },
      });
    }
  };

  const clearResults = () => {
    setResults([]);
    setQuery("");
    setSearched(false);
  };

  const handleSaveCustomEntry = async () => {
    if (!customEntryTitle.trim() || !online) return;
    const mangaData = {
      name: customEntryTitle,
      mal_id: null,
      volumes: customEntryVolumes,
      volumes_owned: 0,
      image_url_jpg: null,
      genres: customEntryGenres
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0),
    };
    const res = await addCustomEntryToUserLibrary(mangaData);
    if (res.success) {
      navigate("/mangapage", {
        state: { manga: res.newEntry, adult_content_level },
      });
    }
  };

  // ─── Barcode scanning state machine ───────────────────────────────────

  const resumeScanning = () => {
    setScanPhase("scanning");
    setScanStatus("");
    setScanResult(null);
    setScanCandidateIdx(0);
    setScanNotFound(null);
    setScanTransientError(null);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    setScanPhase("scanning");
    setScanStatus("");
    setScanResult(null);
    setScanCandidateIdx(0);
    setScanNotFound(null);
    setScanTransientError(null);
  };

  // Transient errors auto-resume after a short delay
  useEffect(() => {
    if (scanPhase !== "transient") return;
    const t = setTimeout(resumeScanning, TRANSIENT_ERROR_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [scanPhase]);

  // Browser back button = close scanner, tied to the overall `scannerOpen`
  // rather than the BarcodeScanner mount (which comes and goes between
  // phases). One synthetic history entry per open session.
  useEffect(() => {
    if (!scannerOpen) return;
    window.history.pushState({ __mc_scanner: true }, "");
    const onPop = () => closeScanner();
    window.addEventListener("popstate", onPop);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = prevOverflow;
      if (window.history.state?.__mc_scanner) {
        window.history.back();
      }
    };
  }, [scannerOpen]);

  const onBarcodeDetected = useCallback(async (raw) => {
    const isbn = normalizeISBN(raw);
    if (!isbn) return; // invalid EAN — keep scanning

    try {
      navigator.vibrate?.(30);
    } catch {
      /* ignore */
    }

    // Enter "looking up" — pauses the detection loop
    setScanPhase("looking-up");
    setScanStatus(`ISBN ${isbn} — looking up…`);

    let book;
    try {
      book = await lookupISBN(isbn);
    } catch (err) {
      if (err?.code === "RATE_LIMITED") {
        // Scanner closes; dedicated modal explains + points to Settings
        setRateLimited({
          message:
            err.message ??
            "Google Books rate-limit reached. Set an API key to continue.",
        });
        setScannerOpen(false);
        return;
      }
      // Any other 5xx / network hiccup → transient, auto-resume
      setScanTransientError(err?.message ?? "Lookup failed — will retry.");
      setScanPhase("transient");
      return;
    }

    if (!book) {
      setScanNotFound({ isbn });
      setScanPhase("not-found");
      return;
    }

    // Try to pair the title with a MAL entry
    setScanStatus(
      `Found "${book.title}"${book.volume ? ` · Vol ${book.volume}` : ""} — matching on MAL…`,
    );

    let candidates;
    try {
      candidates = await searchExternal(book.title);
    } catch (err) {
      // External lookup hiccup = transient, will retry the whole scan
      setScanTransientError(
        err?.message ?? "External lookup failed — will retry.",
      );
      setScanPhase("transient");
      return;
    }

    if (!candidates.length) {
      setScanNotFound({ isbn, bookTitle: book.title });
      setScanPhase("not-found");
      return;
    }

    // Coffret detection — routed before the regular single-volume flow.
    // Google Books has no structured box-set flag; we lean on title text.
    // Coffrets rely on a server-side MAL id (the commit flow posts to
    // /library/{mal_id}/coffrets), so we only handle candidates that carry
    // one. MangaDex-only matches fall through to the single-volume flow.
    const coffretHint = detectCoffret(book);
    const coffretCandidate = candidates.find((c) => c.mal_id != null);
    if (coffretHint.isCoffret && coffretCandidate) {
      // Close the scanner overlay — the coffret modal takes over the screen.
      setScannerOpen(false);
      const prefilledPrice = pickDefaultPrice(book, currencyCodeRef.current);
      setScanCoffret({
        isbn,
        book,
        candidates,
        candidate: coffretCandidate,
        mal_id: coffretCandidate.mal_id,
        totalVolumes: coffretCandidate.volumes ?? 0,
        prefill: {
          name: coffretHint.name,
          volStart: coffretHint.volStart,
          volEnd: coffretHint.volEnd,
          price: prefilledPrice > 0 ? prefilledPrice : null,
        },
      });
      return;
    }

    setScanResult({
      isbn,
      book,
      candidates,
      volume: book.volume ?? 1,
      // Prefill price only when Google Books gave us one in the same currency
      // as the user's settings — otherwise leave at 0 (they can type it).
      price: pickDefaultPrice(book, currencyCodeRef.current),
    });
    setScanCandidateIdx(0);
    setScanPhase("positive");
    setScanStatus("");
  }, []);

  const commitCurrentScan = async ({ missingVolumes = [] } = {}) => {
    if (!scanResult) return;
    const candidate = scanResult.candidates[scanCandidateIdx];
    const volume = Number(scanResult.volume) || 1;
    const price = Number(scanResult.price) || 0;
    const volumeNumbers = [
      ...missingVolumes.filter((n) => n !== volume),
      volume,
    ];

    setCommitting(true);
    try {
      const res = await commitScan({
        manga: candidate,
        volumeNumbers,
        scannedVolume: volume,
        price,
        // Google Books payload — useScanCommit reads its `publisher` /
        // `edition` to pre-fill the new library row's editorial
        // metadata (only when the series is freshly added).
        book: scanResult.book,
      });
      setRecentScans((prev) =>
        [
          {
            id: `${candidate.mal_id ?? candidate.mangadex_id}-${volume}-${Date.now()}`,
            title: candidate.name ?? candidate.title,
            volume,
            gapFilled: missingVolumes.length,
            cover:
              candidate.image_url ??
              candidate.images?.jpg?.image_url ??
              candidate.images?.jpg?.small_image_url,
            newlyOwned: res.newlyOwned,
            alreadyOwned: res.alreadyOwned,
            added: res.added,
          },
          ...prev,
        ].slice(0, 8),
      );
      try {
        navigator.vibrate?.([30, 40, 30]);
      } catch {
        /* ignore */
      }
      resumeScanning();
    } catch (err) {
      setScanTransientError(err?.message ?? "Failed to add — will retry.");
      setScanPhase("transient");
    } finally {
      setCommitting(false);
    }
  };

  const switchToManual = (prefillTitle) => {
    closeScanner();
    setCustomEntry(true);
    if (prefillTitle) setCustomEntryTitle(prefillTitle);
  };

  // Helper — only pre-fill the price when Google Books gives us one in the
  // currency the user actually collects in. Otherwise we'd confuse them
  // (e.g. showing 7.99 as "price" when it's actually 7.99 USD for a JP
  // edition priced in yen).
  function pickDefaultPrice(book, userCurrencyCode) {
    const p = book?.price;
    if (!p || typeof p.amount !== "number") return 0;
    if (!userCurrencyCode) return 0;
    if (p.currency !== userCurrencyCode) return 0;
    return p.amount;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
      <header className="mb-8 animate-fade-up">
        <button
          onClick={() => navigate("/dashboard")}
          className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          {t("common.back")}
        </button>

        <div className="flex items-baseline gap-3">
          <span className="font-mono text-xs uppercase tracking-[0.3em] text-washi-dim">
            {t("add.eyebrow")}
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
        </div>
        <h1 className="mt-2 font-display text-4xl font-light italic leading-none tracking-tight text-washi md:text-5xl">
          {t("add.title")}{" "}
          <span className="text-hanko-gradient font-semibold not-italic">
            {t("add.titleAccent")}
          </span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-washi-muted">
          {t("add.subtitle")}
        </p>
      </header>

      {/* ─── Scan hero CTA ─── */}
      <section className="mb-6 animate-fade-up">
        <button
          onClick={() => setScannerOpen(true)}
          disabled={!online}
          className="group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl border border-hanko/30 bg-gradient-to-br from-hanko/20 via-ink-1/50 to-gold/5 p-5 text-left backdrop-blur transition hover:border-hanko/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-hanko text-washi shadow-lg glow-red">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M7 9v6M10 9v6M13 9v6M16 9v6" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko-bright">
              {t("add.scanFast")}
            </p>
            <p className="mt-1 font-display text-lg font-semibold text-washi">
              {t("add.scanCta")}
            </p>
            <p className="mt-0.5 text-xs text-washi-muted">
              {online ? t("add.scanHint") : t("add.scanOffline")}
            </p>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5 shrink-0 text-washi-muted transition-transform group-hover:translate-x-1"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </section>

      {/* ─── Tabs for search/custom ─── */}
      <div className="mb-6 inline-flex rounded-full border border-border bg-ink-1/60 p-1 backdrop-blur">
        <button
          onClick={() => setCustomEntry(false)}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            !customEntry
              ? "bg-hanko text-washi shadow-md"
              : "text-washi-muted hover:text-washi"
          }`}
        >
          {t("add.tabMalSearch")}
        </button>
        <button
          onClick={() => setCustomEntry(true)}
          className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
            customEntry
              ? "bg-hanko text-washi shadow-md"
              : "text-washi-muted hover:text-washi"
          }`}
        >
          {t("add.tabCustomEntry")}
        </button>
      </div>

      {customEntry ? (
        <section className="animate-fade-up">
          {!online && <OnlineOnlyNotice label={t("add.customEntryLabel")} />}
          <div className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur md:p-8">
            <p className="mb-6 rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-washi-muted">
              {t("add.customNote")}
            </p>
            <div className="space-y-5">
              <Field label={t("add.titleField")}>
                <input
                  type="text"
                  value={customEntryTitle}
                  onChange={(e) => setCustomEntryTitle(e.target.value)}
                  placeholder={t("add.titlePlaceholder")}
                  className="w-full rounded-lg border border-border bg-ink-0/60 px-4 py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
              </Field>
              <Field label={t("add.genresField")}>
                <input
                  type="text"
                  value={customEntryGenres}
                  onChange={(e) => setCustomEntryGenres(e.target.value)}
                  placeholder={t("add.genresPlaceholder")}
                  className="w-full rounded-lg border border-border bg-ink-0/60 px-4 py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
              </Field>
              <Field label={t("add.volumesField")}>
                <input
                  type="number"
                  value={customEntryVolumes}
                  onChange={(e) =>
                    setCustomEntryVolumes(Number(e.target.value))
                  }
                  min={0}
                  placeholder="0"
                  className="w-full rounded-lg border border-border bg-ink-0/60 px-4 py-3 text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                />
              </Field>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  setCustomEntry(false);
                  setCustomEntryTitle("");
                  setCustomEntryGenres("");
                  setCustomEntryVolumes(0);
                }}
                className="rounded-full border border-border bg-transparent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSaveCustomEntry}
                disabled={!customEntryTitle.trim() || !online}
                className="rounded-full bg-hanko px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi shadow-lg transition hover:bg-hanko-bright active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("add.createEntry")}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-6 animate-fade-up">
          {!online && <OnlineOnlyNotice label={t("add.malSearchLabel")} />}
          <MangaSearchBar
            query={query}
            setQuery={setQuery}
            searchManga={searchManga}
            clearResults={clearResults}
            loading={loading}
            hasResults={results.length > 0}
            autoFocus={tourFocusSearch}
            placeholder={
              online ? t("add.searchPlaceholder") : t("add.offlinePlaceholder")
            }
          />

          {loading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 rounded-xl border border-border p-3"
                >
                  <div className="h-24 w-16 animate-shimmer rounded-md" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-shimmer rounded" />
                    <div className="h-3 w-1/2 animate-shimmer rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length > 0 ? (
            <MangaSearchResults
              results={results}
              addToLibrary={addToLibrary}
              isAdding={addManga.isPending}
              isInLibrary={isInLibrary}
            />
          ) : searched ? (
            <div className="rounded-2xl border border-dashed border-border bg-ink-1/30 p-8 text-center">
              <p className="font-display text-lg italic text-washi-muted">
                {t("add.noResults", { query })}
              </p>
              <p className="mt-2 text-xs text-washi-dim">
                {t("add.noResultsHint")}
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-ink-1/30 p-8 text-center">
              <div
                className="hanko-seal mx-auto mb-3 grid h-12 w-12 place-items-center rounded-md font-display text-sm"
                title={t("badges.search")}
              >
                捜
              </div>
              <p className="font-display text-lg italic text-washi">
                {t("add.beginPrompt")}
              </p>
              <p className="mt-1 text-xs text-washi-muted">
                {t("add.beginHint")}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ─── Scanner (active detection only) ─── */}
      {scannerOpen && scanPhase === "scanning" && (
        <BarcodeScanner
          onDetect={onBarcodeDetected}
          onClose={closeScanner}
          statusMessage="Point the camera at the barcode"
          recentCount={recentScans.length}
        />
      )}

      {/* ─── Loading view (replaces scanner while Google Books / MAL resolves) ─── */}
      {scannerOpen &&
        (scanPhase === "looking-up" || scanPhase === "transient") && (
          <ScanLoadingView
            statusMessage={scanStatus}
            errorMessage={scanPhase === "transient" ? scanTransientError : null}
            onClose={closeScanner}
          />
        )}

      {/* ─── Positive match — confirmation card ─── */}
      <Modal
        popupOpen={Boolean(
          scannerOpen && scanPhase === "positive" && scanResult,
        )}
        handleClose={committing ? undefined : resumeScanning}
      >
        <div className="max-w-md overflow-hidden rounded-2xl border border-border bg-ink-1 shadow-2xl">
          {scanResult && (
            <ScanMatchCard
              result={scanResult}
              candidateIdx={scanCandidateIdx}
              setCandidateIdx={setScanCandidateIdx}
              setVolume={(v) =>
                setScanResult((r) => (r ? { ...r, volume: v } : r))
              }
              setPrice={(p) =>
                setScanResult((r) => (r ? { ...r, price: p } : r))
              }
              library={library}
              currencySetting={currencySetting}
              committing={committing}
              onConfirm={commitCurrentScan}
              onCancel={resumeScanning}
            />
          )}
        </div>
      </Modal>

      {/* ─── Not found — 3 options ─── */}
      <Modal
        popupOpen={Boolean(
          scannerOpen && scanPhase === "not-found" && scanNotFound,
        )}
        handleClose={resumeScanning}
      >
        <div className="max-w-md overflow-hidden rounded-2xl border border-border bg-ink-1 p-6 shadow-2xl">
          {scanNotFound && (
            <NotFoundCard
              notFound={scanNotFound}
              onRescan={resumeScanning}
              onManual={() => switchToManual(scanNotFound.bookTitle ?? "")}
              onClose={closeScanner}
            />
          )}
        </div>
      </Modal>

      {/* ─── Rate limit modal (outside scanner) ─── */}
      <Modal
        popupOpen={Boolean(rateLimited)}
        handleClose={() => setRateLimited(null)}
      >
        <div className="max-w-md rounded-2xl border border-border bg-ink-1 p-6 shadow-2xl">
          <div
            className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm"
            title={t("badges.rateLimit")}
          >
            限
          </div>
          <h3 className="text-center font-display text-xl font-semibold text-washi">
            {t("scan.rateLimitTitle")}
          </h3>
          <p className="mt-3 text-sm text-washi-muted">
            {rateLimited?.message}
          </p>
          <p className="mt-3 rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-washi-muted">
            {t("scan.rateLimitFix")}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setRateLimited(null)}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi"
            >
              {t("common.close")}
            </button>
            <button
              onClick={() => {
                setRateLimited(null);
                navigate("/settings");
              }}
              className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright"
            >
              {t("common.openSettings")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ─── Coffret modal opened by the scanner when a box-set is detected ── */}
      <AddCoffretModal
        open={Boolean(scanCoffret)}
        onClose={() => setScanCoffret(null)}
        mal_id={scanCoffret?.mal_id}
        totalVolumes={scanCoffret?.totalVolumes}
        currencySetting={currencySetting}
        prefill={scanCoffret?.prefill}
        onSwitchToVolume={() => {
          // False positive on coffret detection — fall back to the regular
          // single-volume confirmation card inside the scanner overlay.
          const fallback = scanCoffret;
          if (!fallback) return;
          setScanCoffret(null);
          setScanResult({
            isbn: fallback.isbn,
            book: fallback.book,
            candidates: fallback.candidates,
            volume: fallback.book?.volume ?? 1,
            price: pickDefaultPrice(fallback.book, currencyCodeRef.current),
          });
          setScanCandidateIdx(0);
          setScanPhase("positive");
          setScanStatus("");
          setScannerOpen(true);
        }}
      />

      {/* ─── MangaDex prefill modal — asks for volume count ─── */}
      <MangadexPrefillModal
        result={mangadexPrefill}
        onClose={() => setMangadexPrefill(null)}
        onConfirm={confirmMangadexAdd}
      />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-2 block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </label>
      {children}
    </div>
  );
}

function OnlineOnlyNotice({ label }) {
  const t = useT();
  return (
    <div
      className="mb-4 flex items-start gap-2 rounded-lg border border-hanko/30 bg-hanko/10 p-3 text-xs text-washi"
      role="alert"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-0.5 h-4 w-4 shrink-0 text-hanko-bright"
      >
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <div>
        <p className="font-semibold">
          {t("add.requiresConnection", { label })}
        </p>
        <p className="mt-0.5 text-washi-muted">{t("add.offlineHint")}</p>
      </div>
    </div>
  );
}

function ScanMatchCard({
  result,
  candidateIdx,
  setCandidateIdx,
  setVolume,
  setPrice,
  library,
  currencySetting,
  committing,
  onConfirm,
  onCancel,
}) {
  const t = useT();
  const candidate = result.candidates[candidateIdx];
  const inLibrary = library.some((m) => m.mal_id === candidate.mal_id);
  const scannedVol = Number(result.volume) || 1;

  // Compute missing preceding volumes (1..scannedVol-1 that the user doesn't
  // own yet). Reactive via useLiveQuery so cycling through MAL candidates
  // refreshes the gap based on the newly selected series' history.
  const missing = useLiveQuery(
    async () => {
      if (!candidate?.mal_id) return [];
      const owned = new Set(
        (await db.volumes.where("mal_id").equals(candidate.mal_id).toArray())
          .filter((v) => v.owned)
          .map((v) => v.vol_num),
      );
      const gap = [];
      for (let i = 1; i < scannedVol; i++) {
        if (!owned.has(i)) gap.push(i);
      }
      return gap;
    },
    [candidate?.mal_id, scannedVol],
    [],
  );

  return (
    <>
      <div className="border-b border-border p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
          {t("scan.isbnPrefix", { isbn: result.isbn })}
        </p>
        <p className="mt-1 text-xs text-washi-muted">
          {t("scan.googleBooksRaw", { title: result.book.rawTitle })}
        </p>
      </div>

      <div className="flex gap-3 p-4">
        {(candidate.image_url || candidate.images?.jpg?.image_url) && (
          <img referrerPolicy="no-referrer"
            src={candidate.image_url ?? candidate.images?.jpg?.image_url}
            alt=""
            className="h-32 w-24 shrink-0 rounded-md border border-border object-cover shadow-lg"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {t("scan.match")}
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold leading-tight text-washi">
            {candidate.name ?? candidate.title}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            <span>
              {t("searchResults.vols", { n: candidate.volumes ?? "?" })}
            </span>
            {candidate.score && (
              <span className="text-gold">★ {candidate.score}</span>
            )}
            {inLibrary && (
              <span className="text-gold">{t("scan.inLibrary")}</span>
            )}
          </div>

          {result.candidates.length > 1 && (
            <button
              onClick={() =>
                setCandidateIdx((i) => (i + 1) % result.candidates.length)
              }
              className="mt-2 inline-flex items-center gap-1 rounded-full border border-border bg-ink-0/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/40 hover:text-washi"
            >
              {t("scan.notThisOne", {
                current: candidateIdx + 1,
                total: result.candidates.length,
              })}
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <label className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {t("scan.volumeNumber")}
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={() =>
              setVolume(Math.max(1, Number(result.volume || 1) - 1))
            }
            className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-ink-0/40 text-washi transition hover:border-hanko/40"
            aria-label="-"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            value={result.volume ?? ""}
            onChange={(e) => setVolume(Number(e.target.value) || 1)}
            className="w-full rounded-lg border border-border bg-ink-0 px-3 py-2 text-center font-display text-lg font-semibold text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
          />
          <button
            onClick={() => setVolume(Number(result.volume || 0) + 1)}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-ink-0/40 text-washi transition hover:border-hanko/40"
            aria-label="+"
          >
            +
          </button>
        </div>
        {!result.book.volume && (
          <p className="mt-1.5 text-[10px] text-washi-dim">
            {t("scan.volumeUndetected")}
          </p>
        )}
      </div>

      {/* Price field with optional Google Books hint */}
      <div className="border-t border-border p-4">
        <label
          htmlFor="scan-price"
          className="block font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim"
        >
          {t("scan.priceLabel", { symbol: currencySetting?.symbol ?? "$" })}
        </label>
        <input
          id="scan-price"
          type="number"
          step="0.01"
          min="0"
          value={result.price ?? 0}
          onChange={(e) => setPrice(e.target.value)}
          onFocus={(e) => {
            if (Number(e.target.value) === 0) e.target.select();
          }}
          placeholder="0.00"
          className="mt-1.5 w-full rounded-lg border border-border bg-ink-0 px-3 py-2 font-display text-sm font-semibold text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
        />
        {result.book.price && (
          <GoogleBooksPriceHint
            bookPrice={result.book.price}
            userCurrency={currencySetting?.code}
          />
        )}
      </div>

      {/* Gap-fill proposal */}
      {missing.length > 0 && (
        <div className="border-t border-gold/20 bg-gold/5 p-4">
          <div className="flex items-start gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-0.5 h-4 w-4 shrink-0 text-gold"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold text-washi">
                {missing.length === 1
                  ? t("scan.missingVolumesOne", { n: missing[0] })
                  : t("scan.missingVolumesMany", { n: missing.length })}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-washi-muted">
                {summarizeRange(missing)}
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className={`grid gap-2 border-t border-border bg-ink-0/40 p-4 ${missing.length > 0 ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {missing.length > 0 ? (
          <>
            <button
              onClick={() => onConfirm({ missingVolumes: missing })}
              disabled={committing || !Number(result.volume)}
              className="w-full rounded-lg bg-hanko px-4 py-2.5 text-sm font-semibold text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
            >
              {committing ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                  {t("scan.addingVolumes", { n: missing.length + 1 })}
                </span>
              ) : (
                t("scan.addVolPlusMissing", {
                  n: scannedVol,
                  missing: missing.length,
                })
              )}
            </button>
            <button
              onClick={() => onConfirm({ missingVolumes: [] })}
              disabled={committing || !Number(result.volume)}
              className="w-full rounded-lg border border-border bg-transparent px-4 py-2 text-sm font-semibold text-washi-muted transition hover:border-hanko/40 hover:text-washi disabled:opacity-50"
            >
              {t("scan.onlyAddVol", { n: scannedVol })}
            </button>
            <button
              onClick={onCancel}
              disabled={committing}
              className="w-full rounded-lg border border-transparent px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-washi-dim transition hover:text-washi disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onCancel}
              disabled={committing}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => onConfirm({ missingVolumes: [] })}
              disabled={committing || !Number(result.volume)}
              className="rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
            >
              {committing ? (
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-washi/30 border-t-washi" />
                  {t("scan.addingSingle")}
                </span>
              ) : inLibrary ? (
                t("scan.markVolOwned")
              ) : (
                t("scan.addToLibrary")
              )}
            </button>
          </>
        )}
      </div>
    </>
  );
}

function GoogleBooksPriceHint({ bookPrice, userCurrency }) {
  const t = useT();
  const sameCurrency = userCurrency && bookPrice.currency === userCurrency;
  return (
    <p
      className={`mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
        sameCurrency ? "text-gold" : "text-washi-dim"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3 w-3"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
      {t("scan.googleBooksPrice", {
        amount: bookPrice.amount.toFixed(2),
        currency: bookPrice.currency,
      })}
      {!sameCurrency && t("scan.googleBooksPriceDiffCurrency")}
      {bookPrice.source === "list" &&
        sameCurrency &&
        t("scan.googleBooksListPrice")}
    </p>
  );
}

/** Turn [1,2,3,5,6,8] into "1-3, 5-6, 8". */
function summarizeRange(nums) {
  if (!nums.length) return "";
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return ranges.join(", ");
}

function NotFoundCard({ notFound, onRescan, onManual, onClose }) {
  const t = useT();
  return (
    <div className="text-center">
      <div className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm">
        ?
      </div>
      <h3 className="font-display text-xl font-semibold text-washi">
        {t("scan.noMatchTitle")}
      </h3>
      <p className="mt-2 text-sm text-washi-muted">
        {notFound.bookTitle
          ? t("scan.noMatchBodyWithTitle", {
              isbn: notFound.isbn,
              title: notFound.bookTitle,
            })
          : t("scan.noMatchBodyNoTitle", { isbn: notFound.isbn })}
      </p>

      <div className="mt-5 grid gap-2">
        <button
          type="button"
          onClick={onRescan}
          className="rounded-lg bg-hanko px-4 py-2.5 text-sm font-semibold text-washi transition hover:bg-hanko-bright active:scale-95"
        >
          {t("scan.scanAnother")}
        </button>
        <button
          type="button"
          onClick={onManual}
          className="rounded-lg border border-border bg-ink-0/40 px-4 py-2.5 text-sm font-semibold text-washi-muted transition hover:border-hanko/40 hover:text-washi"
        >
          {t("scan.enterManually")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-dim transition hover:text-washi"
        >
          {t("scan.closeScanner")}
        </button>
      </div>
    </div>
  );
}
