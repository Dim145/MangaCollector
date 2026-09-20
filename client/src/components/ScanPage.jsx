import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import BarcodeScanner from "@/components/BarcodeScanner.jsx";
import CoverImage from "@/components/ui/CoverImage.jsx";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes, useUpdateVolume } from "@/hooks/useVolumes.js";
import { useT } from "@/i18n/index.jsx";
import { lookupISBN, normalizeISBN } from "@/lib/isbn.js";
import axios from "@/utils/axios.js";
import { addCustomEntryToUserLibrary } from "@/utils/user.js";
import { notifySyncError } from "@/lib/sync.js";
import { findLocalByIsbn } from "@/lib/scanLookup.js";
import haptics from "@/lib/haptics.js";

/**
 * 番 · The global scanner — "is this on my shelf?" before "add it".
 *
 * A barcode is looked up on the shelf first (Dexie, so it works with
 * the server down and offline): a hit shows the tome — series, number,
 * owned / lent / where it lives / how many copies — with a way to open
 * the series or count one more copy (the doubles collectors buy by
 * mistake). A miss asks the catalogues for a title, then hands the
 * barcode to the add flow. The camera itself never needs the server.
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

  const onDetect = useCallback(
    async (raw) => {
      if (busyRef.current) return;
      const isbn = normalizeISBN(raw);
      if (!isbn) return;
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
    [volumes, library],
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
      navigate("/mangapage", { state: { manga: entry }, viewTransition: true });
    } catch (err) {
      notifySyncError(err, "scan-create-series");
    } finally {
      setCreating(false);
    }
  };

  const statusMessage =
    result?.phase === "found"
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
      />

      {result &&
        createPortal(
          <div
            role="dialog"
            aria-label={t("scanPage.resultAria")}
            className="fixed inset-x-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[2147483645] mx-auto max-w-lg animate-fade-up rounded-2xl border border-border bg-ink-1/95 p-4 shadow-2xl backdrop-blur-xl md:bottom-8"
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
          </div>,
          document.body,
        )}
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
