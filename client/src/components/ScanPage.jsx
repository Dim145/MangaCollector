import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import BarcodeScanner from "@/components/BarcodeScanner.jsx";
import CoverImage from "@/components/ui/CoverImage.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes, useUpdateVolume } from "@/hooks/useVolumes.js";
import { useT } from "@/i18n/index.jsx";
import { lookupISBN, normalizeISBN } from "@/lib/isbn.js";
import axios from "@/utils/axios.js";
import { addCustomEntryToUserLibrary } from "@/utils/user.js";
import { notifySyncError, notifySyncInfo } from "@/lib/sync.js";
import { findLocalByIsbn } from "@/lib/scanLookup.js";
import {
  classifyScan,
  clearQueue,
  loadQueue,
  queueSummary,
  resolveWithBook,
  saveQueue,
} from "@/lib/scanQueue.js";
import { announce } from "@/lib/announce.js";
import haptics from "@/lib/haptics.js";
import sounds from "@/lib/sounds.js";

// 遅 · The review is needed once a batch is done, not to open the
// scanner: fetched when the Review button is approached, rendered when
// pressed (it stays mounted afterwards so its sheet can animate out).
const loadReview = () => import("./ScanBatchReview.jsx");
const BatchReview = lazy(loadReview);

const MODE_KEY = "mc:scan-mode";
function readMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "batch" ? "batch" : "single";
  } catch {
    return "single";
  }
}

/**
 * 番 · The global scanner — "is this on my shelf?" before "add it".
 *
 * A barcode is looked up on the shelf first (Dexie, so it works with
 * the server down and offline): a hit shows the tome — series, number,
 * owned / lent / where it lives / how many copies — with a way to open
 * the series or count one more copy (the doubles collectors buy by
 * mistake). A miss asks the catalogues for a title, then hands the
 * barcode to the add flow. The camera itself never needs the server.
 *
 * 列 · Two rhythms (`mc:scan-mode`): one by one, each book shown and
 * decided on the spot — or in a row, as CLZ offers: each barcode is
 * read, sorted and ticked off without stopping (`lib/scanQueue.js`), and
 * the batch is reviewed at the end — the tomes waiting to be marked
 * owned in one go, the copies already there, the strangers to add one
 * at a time. The batch is kept for the session, so a visit to the add
 * flow comes back to it.
 */
export default function ScanPage() {
  const t = useT();
  const navigate = useNavigate();
  const { data: volumes } = useAllVolumes();
  const { data: library } = useLibrary();
  const updateVolume = useUpdateVolume();
  const [result, setResult] = useState(null);
  const busyRef = useRef(false);
  const [creating, setCreating] = useState(false);

  // ── 列 · The batch ─────────────────────────────────────────────
  const [mode, setMode] = useState(readMode);
  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* private mode: the choice lasts the visit */
    }
  }, [mode]);
  const [queue, setQueue] = useState([]);
  const queueRef = useRef(queue);
  const [lastNote, setLastNote] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewMounted, setReviewMounted] = useState(false);
  // The shelf as it is now, for the lookups that answer later.
  const shelfRef = useRef({ volumes: [], library: [] });
  useEffect(() => {
    shelfRef.current = { volumes: volumes ?? [], library: library ?? [] };
  }, [volumes, library]);
  // Back from the add flow: the batch kept for the session, re-read
  // against the shelf once it is there.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !volumes || !library) return;
    restoredRef.current = true;
    const kept = loadQueue(volumes, library);
    if (kept.length) {
      queueRef.current = kept;
      setQueue(kept);
    }
  }, [volumes, library]);
  const commitQueue = (next) => {
    queueRef.current = next;
    setQueue(next);
    saveQueue(next);
  };
  // One catalogue lookup at a time: a reader scanning fast must not
  // turn into a burst of requests to the resolver.
  const lookupsRef = useRef(Promise.resolve());
  const lookUpLater = (isbn) => {
    lookupsRef.current = lookupsRef.current.then(async () => {
      let book = null;
      try {
        book = await lookupISBN(isbn);
      } catch {
        book = null;
      }
      const { volumes: vs, library: lib } = shelfRef.current;
      const next = queueRef.current.map((item) =>
        item.isbn === isbn && item.kind === "unknown"
          ? resolveWithBook(item, book ?? { title: null }, vs, lib)
          : item,
      );
      commitQueue(next);
    });
  };
  const labelOf = (item) =>
    item.series
      ? `${item.series.name} #${item.volume?.vol_num ?? "?"}`
      : item.book?.title
        ? [item.book.title, item.book.volume ? `#${item.book.volume}` : ""]
            .filter(Boolean)
            .join(" ")
        : item.isbn;
  const addToBatch = (isbn) => {
    const item = classifyScan(isbn, volumes ?? [], library ?? []);
    if (!item) return;
    if (queueRef.current.some((i) => i.isbn === item.isbn)) {
      haptics.tap();
      setLastNote({ tone: "already", label: labelOf(item) });
      announce(t("scanPage.batchAlready"));
      return;
    }
    commitQueue([...queueRef.current, item]);
    haptics.check();
    sounds.tap();
    const note =
      item.kind === "unknown"
        ? t("scanPage.batchUnknown", { isbn: item.isbn })
        : t(
            item.kind === "owned"
              ? "scanPage.batchOwned"
              : item.kind === "upcoming"
                ? "scanPage.batchUpcoming"
                : "scanPage.batchMissing",
            { label: labelOf(item) },
          );
    setLastNote({ tone: item.kind, text: note });
    announce(note);
    if (item.kind === "unknown") lookUpLater(item.isbn);
  };
  const removeFromBatch = (isbn) =>
    commitQueue(queueRef.current.filter((i) => i.isbn !== isbn));
  const switchMode = (next) => {
    setMode(next);
    busyRef.current = false;
    setResult(null);
    setLastNote(null);
  };

  const onDetect = useCallback(
    async (raw) => {
      const isbn = normalizeISBN(raw);
      if (!isbn) return;
      if (mode === "batch") {
        addToBatch(isbn);
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      haptics.bump();
      const local = findLocalByIsbn(volumes ?? [], library ?? [], isbn);
      if (local) {
        setResult({ isbn, phase: "found", local });
        return;
      }
      setResult({ isbn, phase: "looking" });
      try {
        const book = await lookupISBN(isbn);
        setResult({ isbn, phase: "unknown", book });
      } catch {
        setResult({ isbn, phase: "unknown", book: null });
      }
    },
    // `addToBatch` reads the batch through its ref and the shelf from
    // this render's values, listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [volumes, library, mode],
  );

  const scanNext = () => {
    busyRef.current = false;
    setResult(null);
  };

  const addCopy = async () => {
    const v = result?.local?.volume;
    if (!v) return;
    const nextExtra = (Number(v.extra_copies) || 0) + 1;
    await updateVolume.mutateAsync({
      id: v.id,
      mal_id: v.mal_id,
      vol_num: v.vol_num,
      owned: true,
      price: Number(v.price) || 0,
      store: v.store ?? "",
      collector: Boolean(v.collector),
      extra_copies: nextExtra,
    });
    setResult((r) =>
      r?.local
        ? {
            ...r,
            local: {
              ...r.local,
              volume: { ...r.local.volume, extra_copies: nextExtra },
            },
          }
        : r,
    );
  };

  /**
   * 叢 · Create a series from the book the catalogue described.
   *
   * The way in for everything MyAnimeList does not have: bande
   * dessinée, comics, art books, a small press. The ISBN chain has
   * already told us the series, the volume number, the publisher and
   * often the cover — enough to build the shelf entry and put the
   * scanned tome on it, rather than send the reader to a MAL search
   * that will find nothing.
   *
   * The run is as long as the tome that was scanned: volume 7 makes a
   * series of seven, with only the seventh owned. Shorter than the
   * truth is easy to fix from the series page; longer would invent
   * volumes.
   */
  const createSeriesFromBook = async () => {
    const book = result?.book;
    if (!book || creating) return;
    setCreating(true);
    try {
      const volume = Math.max(1, Number(book.volume) || 1);
      const res = await addCustomEntryToUserLibrary({
        name: book.title,
        volumes: volume,
        volumes_owned: 0,
        genres: [],
        image_url_jpg: book.thumbnail ?? null,
        publisher: book.publisher ?? null,
        edition: book.edition ?? null,
        author: book.authors?.[0] ?? null,
      });
      const entry = res?.newEntry;
      if (!entry?.mal_id) return;
      // The server materialised the run; put the scanned tome on it,
      // with the barcode that identified it and the cover price when
      // the catalogue knew one.
      const rows = (await axios.get(`/api/user/volume/${entry.mal_id}`)).data;
      const row = Array.isArray(rows)
        ? rows.find((r) => r.vol_num === volume)
        : null;
      if (row) {
        await updateVolume.mutateAsync({
          id: row.id,
          mal_id: entry.mal_id,
          vol_num: row.vol_num,
          owned: true,
          price: Number(book.price?.amount) || 0,
          store: "",
          collector: false,
          isbn: book.isbn,
        });
      }
      navigate("/mangapage", { state: { manga: entry } });
    } catch (err) {
      notifySyncError(err, "scan-create-series");
    } finally {
      setCreating(false);
    }
  };

  // ── 列 · Applying the batch ────────────────────────────────────
  const [marking, setMarking] = useState(false);
  const markOwned = async (items) => {
    if (marking || !items.length) return;
    setMarking(true);
    let done = 0;
    try {
      for (const item of items) {
        const v = item.volume;
        if (!v) continue;
        await updateVolume.mutateAsync({
          id: v.id,
          mal_id: v.mal_id,
          vol_num: v.vol_num,
          owned: true,
          price: Number(v.price) || 0,
          store: v.store ?? "",
          collector: Boolean(v.collector),
          // The barcode that found it, kept on the copy — the next scan
          // of it will not need a catalogue.
          ...(v.isbn ? {} : { isbn: item.isbn }),
        });
        done += 1;
      }
    } catch (err) {
      notifySyncError(err, "scan-batch-mark");
    } finally {
      setMarking(false);
    }
    if (done) {
      const marked = new Set(items.slice(0, done).map((i) => i.isbn));
      commitQueue(queueRef.current.filter((i) => !marked.has(i.isbn)));
      sounds.success();
      notifySyncInfo({ title: t("scanPage.reviewMarked", { n: done }), tone: "success" });
      announce(t("scanPage.reviewMarked", { n: done }));
    }
  };
  const addCopyOf = async (item) => {
    const v = item.volume;
    if (!v) return;
    await updateVolume.mutateAsync({
      id: v.id,
      mal_id: v.mal_id,
      vol_num: v.vol_num,
      owned: true,
      price: Number(v.price) || 0,
      store: v.store ?? "",
      collector: Boolean(v.collector),
      extra_copies: (Number(v.extra_copies) || 0) + 1,
    });
    removeFromBatch(item.isbn);
  };

  const summary = queueSummary(queue);
  const statusMessage =
    mode === "batch"
      ? lastNote?.tone === "already"
        ? `${t("scanPage.batchAlready")} · ${lastNote.label}`
        : (lastNote?.text ?? t("scanPage.batchPrompt"))
      : result?.phase === "found"
        ? t("scanPage.onShelf")
        : result?.phase === "looking"
          ? t("scanPage.looking")
          : result?.phase === "unknown"
            ? t("scanPage.notOnShelf")
            : t("scanPage.pointCamera");

  return (
    <div className="relative min-h-dvh">
      <BarcodeScanner
        onDetect={onDetect}
        onClose={() => navigate(-1)}
        statusMessage={statusMessage}
        recentCount={mode === "batch" ? summary.total : 0}
        topSlot={<ModeSwitch mode={mode} onChange={switchMode} t={t} />}
      >
      {mode === "batch" && summary.total > 0 && (
        <BatchTray
          summary={summary}
          onReview={() => {
            setReviewMounted(true);
            setReviewOpen(true);
          }}
          onPrefetch={loadReview}
          t={t}
        />
      )}
      {mode === "single" && result && (
          <div
            role="region"
            aria-label={t("scanPage.resultAria")}
            className="fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] mx-auto max-w-lg animate-fade-up rounded-2xl border border-border bg-ink-1/95 p-4 shadow-2xl backdrop-blur-xl md:bottom-8"
          >
            {result.phase === "found" && (
              <FoundCard
                local={result.local}
                t={t}
                busy={updateVolume.isPending}
                onOpen={() =>
                  result.local.series
                    ? navigate("/mangapage", {
                        state: { manga: result.local.series },
                      })
                    : null
                }
                onAddCopy={addCopy}
                onNext={scanNext}
              />
            )}
            {result.phase === "looking" && (
              <div className="flex items-center gap-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold/30 border-t-gold" />
                <p className="font-display text-sm italic text-washi-muted">
                  {t("scanPage.looking")}
                </p>
              </div>
            )}
            {result.phase === "unknown" && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
                  {t("scanPage.notOnShelf")} · {result.isbn}
                </p>
                <p className="mt-1 font-display text-lg italic text-washi">
                  {result.book
                    ? [
                        result.book.title,
                        result.book.volume
                          ? `— ${t("scanPage.tome", { n: result.book.volume })}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" ")
                    : t("scanPage.unknownTitle")}
                </p>
                {/* 叢 · What the catalogue found, when it found
                    something: the series and the tome number are what
                    turn a barcode into a shelf entry. */}
                {result.book?.publisher && (
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                    {result.book.publisher}
                    {result.book.authors?.[0]
                      ? ` · ${result.book.authors[0]}`
                      : ""}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* 叢 · The way in for everything MyAnimeList does not
                      have — bande dessinée, comics, art books. Offered
                      only when a catalogue actually described the book;
                      with nothing to prefill it would be the same blank
                      form as the manual route. */}
                  {result.book?.title && (
                    <button
                      type="button"
                      onClick={createSeriesFromBook}
                      disabled={creating}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-0 transition hover:bg-gold-muted disabled:opacity-60"
                    >
                      <span aria-hidden="true" className="font-jp text-[12px]">
                        叢
                      </span>
                      {creating
                        ? t("scanPage.creatingSeries")
                        : t("scanPage.createSeries")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      navigate("/addmanga", { state: { isbn: result.isbn } })
                    }
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
                      result.book?.title
                        ? "border border-border text-washi-muted hover:text-washi"
                        : "bg-hanko text-on-hanko hover:bg-hanko-deep"
                    }`}
                  >
                    <span aria-hidden="true" className="font-jp text-[12px]">
                      追
                    </span>
                    {t("scanPage.addToLibrary")}
                  </button>
                  <button
                    type="button"
                    onClick={scanNext}
                    className="rounded-full border border-border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:text-washi"
                  >
                    {t("scanPage.scanNext")}
                  </button>
                </div>
              </div>
            )}
          </div>
      )}
      </BarcodeScanner>

      {reviewMounted && (
      <Suspense fallback={null}>
      <BatchReview
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        queue={queue}
        labelOf={labelOf}
        marking={marking}
        onMark={markOwned}
        onCopy={addCopyOf}
        onRemove={removeFromBatch}
        onAdd={(item) => navigate("/addmanga", { state: { isbn: item.isbn } })}
        onClear={() => {
          commitQueue([]);
          clearQueue();
          setLastNote(null);
          setReviewOpen(false);
        }}
        t={t}
      />
      </Suspense>
      )}
    </div>
  );
}

/**
 * 単 / 列 · One by one, or in a row — two radios under the scanner's
 * top bar. Native inputs: arrows move between them.
 */
function ModeSwitch({ mode, onChange, t }) {
  return (
    <fieldset className="inline-flex rounded-full border border-border bg-ink-0/80 p-1 backdrop-blur-md">
      <legend className="sr-only">{t("scanPage.modeLabel")}</legend>
      {[
        { id: "single", glyph: "単", label: t("scanPage.modeSingle") },
        { id: "batch", glyph: "列", label: t("scanPage.modeBatch") },
      ].map((opt) => {
        const active = mode === opt.id;
        return (
          <label
            key={opt.id}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3.5 font-mono text-[11px] uppercase tracking-wider transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hanko/50 pointer-coarse:min-h-11 ${
              active ? "bg-hanko text-on-hanko" : "text-washi-muted hover:text-washi"
            }`}
          >
            <input
              type="radio"
              name="scan-mode"
              value={opt.id}
              checked={active}
              onChange={() => onChange(opt.id)}
              className="sr-only"
            />
            <span aria-hidden="true" className="font-jp text-[13px] normal-case leading-none">
              {opt.glyph}
            </span>
            {opt.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/** 列 · The batch so far, over the camera: three counts and the way to review it. */
function BatchTray({ summary, onReview, onPrefetch, t }) {
  return (
    <div className="fixed inset-x-3 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] mx-auto flex max-w-lg animate-fade-up items-center gap-3 rounded-2xl border border-gold/40 bg-ink-1/95 p-3 shadow-2xl backdrop-blur-xl md:bottom-36">
      <span aria-hidden="true" className="font-jp text-xl leading-none text-gold">
        列
      </span>
      <p className="min-w-0 flex-1 font-mono text-[11px] uppercase tracking-[0.12em] text-washi-muted">
        <span className="font-display text-base normal-case tracking-normal text-washi">
          {t("scanPage.batchCount", { n: summary.total })}
        </span>
        <span className="block truncate">
          {summary.missing > 0 && `${t("scanPage.reviewMissingShort", { n: summary.missing })} · `}
          {summary.owned > 0 && `${t("scanPage.reviewOwnedShort", { n: summary.owned })} · `}
          {summary.upcoming > 0 && `${t("scanPage.reviewUpcomingShort", { n: summary.upcoming })} · `}
          {summary.unknown > 0 && t("scanPage.reviewUnknownShort", { n: summary.unknown })}
        </span>
      </p>
      <button
        type="button"
        onClick={onReview}
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        onTouchStart={onPrefetch}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-0 transition hover:bg-gold-muted"
      >
        {t("scanPage.batchReview")}
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

function FoundCard({ local, t, busy, onOpen, onAddCopy, onNext }) {
  const { volume, series } = local;
  const copies = 1 + (Number(volume.extra_copies) || 0);
  return (
    <div className="flex gap-3">
      <div className="aspect-[2/3] h-24 shrink-0 overflow-hidden rounded-sm border border-border/60 bg-ink-2/40">
        {series?.image_url_jpg ? (
          <CoverImage
            src={series.image_url_jpg}
            sizes="64px"
            alt=""
            paletteSeed={series.mal_id}
            imgClassName="h-full w-full object-cover"
          />
        ) : (
          <div className="grid h-full w-full place-items-center font-display text-2xl italic text-gold/40">
            巻
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-moegi">
          {t("scanPage.onShelf")}
        </p>
        <p className="mt-0.5 truncate font-display text-lg italic text-washi">
          {series?.name ?? t("scanPage.unknownTitle")}
          <span className="ml-2 font-mono text-sm not-italic tabular-nums text-gold">
            #{volume.vol_num}
          </span>
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-washi-muted">
          {volume.owned ? t("scanPage.owned") : t("scanPage.notOwned")}
          {volume.loaned_to
            ? ` · ${t("scanPage.lentTo", { name: volume.loaned_to })}`
            : ""}
          {volume.location ? ` · ${volume.location}` : ""}
          {copies > 1 ? ` · ×${copies}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {series && (
            <button
              type="button"
              onClick={onOpen}
              className="rounded-full bg-hanko px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-on-hanko transition hover:bg-hanko-deep"
            >
              {t("scanPage.openSeries")}
            </button>
          )}
          {volume.owned && (
            <button
              type="button"
              disabled={busy}
              onClick={onAddCopy}
              title={t("scanPage.addCopyHint")}
              className="rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-gold transition hover:bg-gold/20 disabled:opacity-50"
            >
              {t("scanPage.addCopy", { n: copies + 1 })}
            </button>
          )}
          <button
            type="button"
            onClick={onNext}
            className="rounded-full border border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted transition hover:text-washi"
          >
            {t("scanPage.scanNext")}
          </button>
        </div>
      </div>
    </div>
  );
}
