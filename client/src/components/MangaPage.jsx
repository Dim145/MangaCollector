import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import Volume from "./Volume";
import VolumeShelfTile from "./VolumeShelfTile.jsx";
import VolumesViewToggle from "./VolumesViewToggle.jsx";
import CoffretGroup from "./CoffretGroup";
// Heavy overlay modals that only mount on user action — lazy so a
// reader who's just consulting a series doesn't pay for the coffret
// builder or the cover picker bundle. Combined ~900 lines of code.
const AddCoffretModal = lazy(() => import("./AddCoffretModal"));
const CoverPickerModal = lazy(() => import("./CoverPickerModal.jsx"));
const AddUpcomingVolumeModal = lazy(() =>
  import("./AddUpcomingVolumeModal.jsx"),
);
import Skeleton from "./ui/Skeleton.jsx";
import StoreAutocomplete from "./ui/StoreAutocomplete.jsx";
import Modal from "@/components/ui/Modal.jsx";
import SettingsContext from "@/SettingsContext.js";
import {
  useDeleteManga,
  useUpdateMangaMeta,
  useLibrary,
  useSetPoster,
  useUpdateManga,
  useUpdateVolumesOwned,
} from "@/hooks/useLibrary.js";
import { useVolumesForManga, useUpdateVolume } from "@/hooks/useVolumes.js";
import { useCoffretsForManga } from "@/hooks/useCoffrets.js";
import { useVolumesView } from "@/hooks/useVolumesView.js";
import { useVolumeCovers } from "@/hooks/useVolumeCovers.js";
import { useVolumePreviewController } from "@/hooks/useVolumePreviewController.js";
import CoverPreview from "./ui/CoverPreview.jsx";
import { useOnline } from "@/hooks/useOnline.js";
import { hasToBlurImage, updateLibFromMal } from "@/utils/library.js";
import { refreshFromMangadex, refreshUpcoming } from "@/utils/user.js";
import { queryClient } from "@/lib/queryClient.js";
import { db } from "@/lib/db.js";
import { notifySyncError, notifySyncInfo } from "@/lib/sync.js";
import { removePoster, uploadPoster } from "@/utils/user.js";
import { formatCurrency } from "@/utils/price.js";
import { useT } from "@/i18n/index.jsx";

export default function MangaPage({ manga, adult_content_level }) {
  const navigate = useNavigate();
  const { currency: currencySetting } = useContext(SettingsContext);
  const online = useOnline();
  const t = useT();

  const [isEditing, setIsEditing] = useState(false);
  const [posterPopUp, setPosterPopUp] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Per-source refresh tracker: null | "mal" | "mangadex". Lets the
  // dropdown spin only the item the user clicked while keeping the
  // other item (and the caret) in their idle state but disabled, so
  // a user can't fire two syncs in parallel.
  const [refreshingSource, setRefreshingSource] = useState(null);
  const refreshing = refreshingSource !== null;
  // Split-button dropdown state — holds the sync actions (MAL + MangaDex)
  // attached to the edit button's caret. Visible only when the series has
  // at least one external reference (mal_id > 0 or mangadex_id).
  //
  // Portaled to document.body with fixed positioning so the menu escapes
  // every ancestor stacking context (the "Total dépensé" card uses
  // backdrop-blur which creates one, trapping any in-tree z-index).
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const [editMenuPos, setEditMenuPos] = useState(null);
  const splitButtonRef = useRef(null);

  const [totalVolumes, setTotalVolumes] = useState(manga.volumes ?? 0);
  // Seed from the frozen prop on first render; subsequent resyncs use the
  // live library row (see effect below).
  const [poster, setPoster] = useState(manga.image_url_jpg);
  const [genres, setGenres] = useState(manga.genres ?? []);
  const [name, setName] = useState(manga.name || t("manga.unknownTitle"));
  // 出版社 · Edition / publisher metadata. Free-text by design — the
  // datalist below offers common imprints as suggestions but the user
  // can type anything (or wipe the field by leaving it empty). Hard
  // length cap mirrors the server clamp so the UI fails fast rather
  // than letting a 10 KB paste through.
  //
  // Seeded to "" here (NOT from `liveLibraryRow` which is declared
  // further down — TDZ would crash the first render). The effect a
  // few hooks below repopulates from the live row as soon as Dexie
  // resolves, then keeps it synced through realtime pushes.
  const [publisher, setPublisher] = useState("");
  const [edition, setEdition] = useState("");

  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [addAvgPrice, setAddAvgPrice] = useState("");
  const [addStore, setAddStore] = useState("");

  const [selectedImage, setSelectedImage] = useState(undefined);
  const [selectedImagePreview, setSelectedImagePreview] = useState(null);

  const { data: volumes, isInitialLoad: volumesLoading } = useVolumesForManga(
    manga.mal_id,
  );
  const { data: coffrets } = useCoffretsForManga(manga.mal_id);
  const { data: volumeCoverMap } = useVolumeCovers(manga.mal_id);

  // Shared preview controller — one <CoverPreview /> instance rendered
  // for the whole page, cross-volume ← / → navigation, sticky mode on
  // long-press, zoom modal on tap.
  const previewCtl = useVolumePreviewController({ coverMap: volumeCoverMap });
  const { mode: volumesView } = useVolumesView();
  const isShelfMode = volumesView === "shelf";
  // `manga` comes frozen from React Router's location.state, so its volume
  // count never updates after navigation. Grab the live row from the Dexie-
  // backed library so edits (and background syncs) are reflected here.
  const { data: library } = useLibrary();
  const liveLibraryRow = library?.find((m) => m.mal_id === manga.mal_id);
  const liveVolumeCount = liveLibraryRow?.volumes ?? (manga.volumes ?? 0);
  const liveMangadexId = liveLibraryRow?.mangadex_id ?? manga.mangadex_id ?? null;
  // 自由 · Genres are editable only when the row has no upstream link
  // to MAL or MangaDex. The same gate is enforced on the server in
  // `apply_library_patch`; the UI mirrors it so non-custom rows show
  // their tags read-only (a refresh-from-* would otherwise silently
  // wipe the user's edits without an override-tracking schema).
  const isCustomGenresEditable =
    manga.mal_id != null && manga.mal_id < 0 && !liveMangadexId;
  const updateManga = useUpdateManga();
  const updateMangaMeta = useUpdateMangaMeta();
  const deleteManga = useDeleteManga();
  const updateVolumesOwned = useUpdateVolumesOwned();
  const setPosterMutation = useSetPoster();
  const updateVolume = useUpdateVolume();
  const [coffretModalOpen, setCoffretModalOpen] = useState(false);
  // 来 · State for the manual-upcoming modal. `editingUpcoming` holds the
  // volume row when we're in edit mode (drawer → "edit announce" CTA),
  // or null when we're creating a fresh row from the menu item.
  const [upcomingModalOpen, setUpcomingModalOpen] = useState(false);
  const [editingUpcoming, setEditingUpcoming] = useState(null);

  // Build an ordered sequence that preserves volume order: walk volumes
  // sorted by vol_num, emit each loose volume in-line and insert the
  // coffret block at the position of its first volume. Consecutive loose
  // volumes batch into a single grid.
  //
  //   [v1, v2, v3, v4]  where v2+v3 belong to coffret A
  //   →  loose-grid(v1) · coffret(A: v2, v3) · loose-grid(v4)
  const volumeSequence = useMemo(() => {
    const out = [];
    const coffretsById = new Map((coffrets ?? []).map((c) => [c.id, c]));
    const sorted = [...(volumes ?? [])].sort((a, b) => a.vol_num - b.vol_num);

    let looseBatch = [];
    const flush = () => {
      if (looseBatch.length > 0) {
        out.push({ type: "loose", vols: looseBatch });
        looseBatch = [];
      }
    };

    const rendered = new Set();
    for (const v of sorted) {
      if (v.coffret_id != null && coffretsById.has(v.coffret_id)) {
        if (!rendered.has(v.coffret_id)) {
          flush();
          const members = sorted.filter((x) => x.coffret_id === v.coffret_id);
          out.push({
            type: "coffret",
            coffret: coffretsById.get(v.coffret_id),
            members,
          });
          rendered.add(v.coffret_id);
        }
        // else: volume is inside an already-rendered coffret block, skip
      } else {
        looseBatch.push(v);
      }
    }
    flush();
    return out;
  }, [volumes, coffrets]);

  // Derive owned counts & pricing from the live volumes table
  const { volumesOwned, totalPrice, avgPrice, allCollector } = useMemo(() => {
    let counter = 0;
    let sum = 0;
    let anyNonCollector = false;
    for (const v of volumes) {
      if (v.owned) {
        counter += 1;
        sum += Number(v.price) || 0;
        if (!v.collector) anyNonCollector = true;
      }
    }
    return {
      volumesOwned: counter,
      totalPrice: sum,
      avgPrice: counter > 0 ? sum / counter : 0,
      allCollector: counter > 0 && !anyNonCollector,
    };
  }, [volumes]);

  // Keep total volumes input in sync when live data arrives. We watch the
  // LIVE library row rather than the stale `manga` prop — otherwise saving
  // a new total would flip the input back to the old value the moment we
  // exit edit mode (the effect would re-fire with the frozen prop value).
  useEffect(() => {
    if (!isEditing) setTotalVolumes(liveVolumeCount);
  }, [liveVolumeCount, isEditing]);

  // Same reasoning for name / genres / poster: location.state.manga is a
  // frozen snapshot from the moment the user navigated here. Without live
  // sync, a refresh-from-MAL/MangaDex that rewrites these fields on the
  // server is invisible after a page reload. Re-seed from the Dexie row
  // whenever it changes — but never mid-edit, since the edit form writes
  // to these setters too (`setPoster` on upload/remove).
  useEffect(() => {
    if (liveLibraryRow?.name && !isEditing) setName(liveLibraryRow.name);
  }, [liveLibraryRow?.name, isEditing]);

  useEffect(() => {
    if (liveLibraryRow?.genres && !isEditing) setGenres(liveLibraryRow.genres);
  }, [liveLibraryRow?.genres, isEditing]);

  useEffect(() => {
    // Sync publisher / edition from the live row when not editing — same
    // pattern as name / genres above, so an outbox flush or another tab's
    // realtime push updates the read-only display immediately.
    if (!isEditing) {
      setPublisher(liveLibraryRow?.publisher ?? "");
      setEdition(liveLibraryRow?.edition ?? "");
    }
  }, [liveLibraryRow?.publisher, liveLibraryRow?.edition, isEditing]);

  useEffect(() => {
    if (liveLibraryRow?.image_url_jpg != null && !isEditing) {
      setPoster(liveLibraryRow.image_url_jpg);
    }
  }, [liveLibraryRow?.image_url_jpg, isEditing]);

  // Close the edit caret dropdown on outside-click, scroll, or Escape —
  // matches the standard menu ergonomics (cmd palette, context menus).
  // Scroll dismiss is important here because the menu is `position:fixed`
  // and would otherwise stay glued to the viewport while the anchor
  // scrolls away.
  useEffect(() => {
    if (!editMenuOpen) return;
    const close = () => setEditMenuOpen(false);
    const onClick = (e) => {
      if (e.target.closest("[data-edit-menu]")) return;
      close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    // Defer listener attachment so the click that opened the menu doesn't
    // immediately close it (same pattern as the cover-preview controller).
    const id = setTimeout(() => {
      window.addEventListener("click", onClick);
      window.addEventListener("keydown", onKey);
      window.addEventListener("scroll", close, {
        passive: true,
        capture: true,
      });
    }, 50);
    return () => {
      clearTimeout(id);
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, { capture: true });
    };
  }, [editMenuOpen]);

  const handleSave = async () => {
    try {
      const newTotal = parseInt(totalVolumes) || 0;
      await updateManga.mutateAsync({
        mal_id: manga.mal_id,
        volumes: newTotal,
      });

      // 出版社 · Persist publisher / edition only when one of them
      // actually changed. Empty string is the canonical "clear this
      // column" value (sync.js trims and folds it to null before the
      // outbox enqueue; the server's sanitize_label finishes the job).
      const prevPublisher = liveLibraryRow?.publisher ?? "";
      const prevEdition = liveLibraryRow?.edition ?? "";
      const nextPublisher = publisher.trim();
      const nextEdition = edition.trim();
      const metaPatch = {};
      if (nextPublisher !== prevPublisher) metaPatch.publisher = nextPublisher;
      if (nextEdition !== prevEdition) metaPatch.edition = nextEdition;

      // 自由 · Genres diff — only relevant for custom rows (the editor
      // is gated on the same condition; on a non-custom row `genres`
      // stayed in lockstep with the live row via the useEffect above,
      // so the diff would be empty anyway). Sort-then-stringify gives
      // an order-insensitive compare: a user who removed and re-added
      // the same tag during the edit session doesn't generate a
      // pointless PATCH.
      if (isCustomGenresEditable) {
        const prevGenres = liveLibraryRow?.genres ?? [];
        const sortedPrev = [...prevGenres].sort();
        const sortedNext = [...genres].sort();
        if (JSON.stringify(sortedPrev) !== JSON.stringify(sortedNext)) {
          metaPatch.genres = genres;
        }
      }

      if (Object.keys(metaPatch).length > 0) {
        await updateMangaMeta.mutateAsync({ mal_id: manga.mal_id, ...metaPatch });
      }

      // Poster upload is online-only (file payloads can't be queued)
      if (selectedImage && online) {
        try {
          await uploadPoster(manga.mal_id, selectedImage);
          const newPoster = `/api/user/storage/poster/${manga.mal_id}`;
          setPoster(newPoster + `?t=${Date.now()}`);
        } catch (err) {
          console.error("Poster upload failed:", err);
          notifySyncError(err, "poster-upload");
        }
      } else if (selectedImage === null && online) {
        try {
          setPoster(await removePoster(manga.mal_id));
        } catch (err) {
          console.error("Poster remove failed:", err);
          notifySyncError(err, "poster-remove");
        }
      }
    } finally {
      setIsEditing(false);
      setSelectedImage(undefined);
      setSelectedImagePreview(null);
    }
  };

  // Called by Volume after a persist() succeeds. We only need to sync the
  // library's `volumes_owned` counter when the ownership actually changed
  // (price/store/collector edits don't affect the count).
  //
  // CRITICAL: re-read the count from Dexie at call time. Relying on the
  // memoised `volumesOwned` from the current render would capture a stale
  // closure — by the time the callback fires, `persist()` has already put
  // the new volume row into Dexie but React hasn't necessarily re-rendered
  // yet, so the closure would still send the previous count to the server.
  const volumeUpdateCallback = async ({ ownedChanged } = {}) => {
    if (!ownedChanged) return;
    const rows = await db.volumes
      .where("mal_id")
      .equals(manga.mal_id)
      .toArray();
    const nbOwned = rows.filter((v) => v.owned).length;
    await updateVolumesOwned.mutateAsync({
      mal_id: manga.mal_id,
      nbOwned,
    });
  };

  const handleAddAllVolumes = async () => {
    const numericPrice = Number(addAvgPrice) || 0;
    if (numericPrice >= 0 && addStore.trim() !== "") {
      try {
        const unownedVolumes = volumes.filter((vol) => !vol.owned);
        await Promise.all(
          unownedVolumes.map((vol) =>
            updateVolume.mutateAsync({
              ...vol,
              owned: true,
              price: numericPrice,
              store: addStore,
            }),
          ),
        );
        await updateVolumesOwned.mutateAsync({
          mal_id: manga.mal_id,
          nbOwned: volumes.length,
        });
      } catch (error) {
        console.error(error);
        notifySyncError(error, "bulk-add");
      } finally {
        setShowAddDropdown(false);
        setAddAvgPrice("");
        setAddStore("");
      }
    }
  };

  const updateFromMal = async () => {
    if (!online) return;
    setRefreshingSource("mal");
    try {
      const { new_genres, new_name } = await updateLibFromMal(manga.mal_id);
      if (new_genres) setGenres(new_genres);
      if (new_name) setName(new_name);
      // Server updated the DB; invalidate library so Dexie re-caches from
      // the fresh server state. Without this, a reload would re-seed from
      // the stale location.state snapshot.
      queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      console.error(e);
      notifySyncError(e, "mal-refresh");
    } finally {
      setRefreshingSource(null);
    }
  };

  const updateFromMangadex = async () => {
    if (!online) return;
    setRefreshingSource("mangadex");
    try {
      const { new_genres, new_name, new_image_url_jpg } =
        await refreshFromMangadex(manga.mal_id);
      if (new_genres) setGenres(new_genres);
      if (new_name) setName(new_name);
      if (new_image_url_jpg) setPoster(new_image_url_jpg);
      queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      console.error(e);
      notifySyncError(e, "mangadex-refresh");
    } finally {
      setRefreshingSource(null);
    }
  };

  // Outcome surfacing routes through SyncToaster (notifySyncInfo) so success /
  // no-change / failure share the same corner as other sync feedback.
  const refreshUpcomingVolumes = async () => {
    if (!online || refreshingSource) return;
    setRefreshingSource("upcoming");
    try {
      const report = await refreshUpcoming(manga.mal_id);
      const added = report?.added?.length ?? 0;
      const updated = report?.updated?.length ?? 0;
      // Server publishes SyncKind::Volumes itself; we still kick the
      // query cache so users on a flaky WebSocket re-fetch quickly.
      if (added > 0 || updated > 0) {
        queryClient.invalidateQueries({
          queryKey: ["volumes", manga.mal_id],
        });
      }
      // Two payload shapes — one for "concrete result, celebrate"
      // and one for "all good but nothing new." The toaster picks
      // tone (moegi vs washi) off the `tone` field.
      if (added + updated > 0) {
        notifySyncInfo({
          op: "upcoming-refresh",
          tone: "success",
          icon: "来",
          title: t("manga.upcomingResultChanged", { added, updated }),
          body: t("manga.upcomingResultChangedBody", { name: manga.name }),
        });
      } else {
        notifySyncInfo({
          op: "upcoming-refresh",
          tone: "neutral",
          icon: "来",
          title: t("manga.upcomingResultNone"),
          body: t("manga.upcomingResultNoneBody"),
        });
      }
    } catch (e) {
      console.error(e);
      notifySyncError(e, "upcoming-refresh");
    } finally {
      setRefreshingSource(null);
    }
  };

  const handleSelectFile = (e) => {
    const file = e.currentTarget.files[0];
    setSelectedImage(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setSelectedImagePreview(ev.target.result);
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setSelectedImage(null);
    setSelectedImagePreview(null);
  };

  const confirmDeleteManga = async () => {
    try {
      await deleteManga.mutateAsync(manga.mal_id);
      navigate("/dashboard");
    } catch (error) {
      console.error(error);
      notifySyncError(error, "delete-manga");
    }
  };

  const completion = useMemo(() => {
    const total = totalVolumes || liveVolumeCount || 0;
    return total > 0 ? Math.round((volumesOwned / total) * 100) : 0;
  }, [volumesOwned, totalVolumes, liveVolumeCount]);

  const isBlurred = hasToBlurImage(manga, adult_content_level);
  const displayPoster = selectedImagePreview || poster;

  return (
    <DefaultBackground>
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-nav md:pb-16 sm:px-6 md:pt-10">
        {/* Back */}
        <button
          onClick={() => navigate("/dashboard")}
          className="mb-6 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
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
          {t("manga.backToLibrary")}
        </button>

        {/* Hero */}
        <section className="relative mb-12 animate-fade-up">
          {displayPoster && !isBlurred && (
            <div
              className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl"
              aria-hidden="true"
            >
              <img referrerPolicy="no-referrer"
                src={displayPoster}
                alt=""
                className="h-full w-full scale-150 object-cover opacity-30 blur-3xl"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-ink-0/60 via-ink-0/80 to-ink-0" />
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-[minmax(0,280px)_1fr] md:gap-10">
            <div className="mx-auto w-full max-w-[220px] md:mx-0 md:max-w-none">
              <div
                className={`relative aspect-[2/3] overflow-hidden rounded-2xl border border-border shadow-2xl glow-red transition-colors ${
                  allCollector
                    ? "hover:border-gold/60"
                    : completion === 100
                      ? "hover:border-moegi/60"
                      : "hover:border-hanko/50"
                }`}
              >
                {displayPoster ? (
                  <img referrerPolicy="no-referrer"
                    src={displayPoster}
                    alt={name}
                    onClick={() => {
                      if (isBlurred) return;
                      // Custom-uploaded posters (served from our own
                      // /storage/poster/ endpoint) always open in zoom —
                      // the user explicitly chose that image, no picker.
                      // Otherwise, open the carousel when we have any
                      // external reference (MAL id OR MangaDex id), even
                      // for custom entries with negative mal_ids.
                      const isCustomUpload =
                        typeof displayPoster === "string" &&
                        !displayPoster.startsWith("http");
                      const hasExternalRef =
                        manga.mal_id > 0 || Boolean(liveMangadexId);
                      if (isCustomUpload || !hasExternalRef) {
                        setPosterPopUp(true);
                      } else {
                        setCoverPickerOpen(true);
                      }
                    }}
                    className={`h-full w-full object-cover transition-transform duration-700 ${
                      isBlurred ? "blur-lg" : "cursor-zoom-in hover:scale-105"
                    }`}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-ink-2">
                    <span
                      className="font-display text-6xl italic text-hanko/40"
                      title={t("badges.volume")}
                    >
                      巻
                    </span>
                  </div>
                )}
              </div>

              {isEditing && (
                <div className="mt-3 space-y-2">
                  {online ? (
                    <label
                      htmlFor="poster"
                      className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-ink-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/50 hover:text-washi"
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
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      {selectedImage?.name
                        ? t("manga.selected", {
                            name: selectedImage.name.substring(0, 16) + "…",
                          })
                        : t("manga.uploadCover")}
                      <input
                        id="poster"
                        type="file"
                        onChange={handleSelectFile}
                        accept="image/jpeg,image/png,image/webp"
                        multiple={false}
                        className="sr-only"
                      />
                    </label>
                  ) : (
                    <div className="rounded-lg border border-dashed border-washi-dim/40 bg-ink-1/60 px-3 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                      {t("manga.uploadOffline")}
                    </div>
                  )}
                  {poster &&
                    typeof poster === "string" &&
                    !poster.startsWith("http") &&
                    !selectedImagePreview &&
                    online && (
                      <button
                        onClick={removeImage}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-hanko/30 bg-hanko/10 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20"
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
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        {t("manga.removeCover")}
                      </button>
                    )}
                </div>
              )}
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-hanko">
                  {t("manga.seriesLabel")}
                </span>
              </div>

              <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-washi md:text-5xl">
                {name}
              </h1>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {manga.mal_id > 0 && (
                  <a
                    href={`https://myanimelist.net/manga/${manga.mal_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-washi-dim hover:text-washi"
                  >
                    {t("manga.malLink", { id: manga.mal_id })}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-2.5 w-2.5"
                    >
                      <path d="M7 17 17 7M7 7h10v10" />
                    </svg>
                  </a>
                )}
                {liveMangadexId && (
                  <a
                    href={`https://mangadex.org/title/${liveMangadexId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-washi-dim hover:text-gold"
                  >
                    {t("manga.mangadexLink")}
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-2.5 w-2.5"
                    >
                      <path d="M7 17 17 7M7 7h10v10" />
                    </svg>
                  </a>
                )}
              </div>

              {isCustomGenresEditable && isEditing ? (
                // 編集 · Live edit mode for custom rows. The editor only
                // mutates local `genres` state; persistence is deferred
                // to the form's "Enregistrer" button (handleSave) so
                // tag changes commit alongside name / publisher /
                // edition / volumes in one logical save action — and a
                // "Annuler" reverts everything via the
                // `liveLibraryRow.genres` useEffect re-seed.
                <TagEditor
                  genres={genres}
                  library={library}
                  onChange={setGenres}
                  t={t}
                />
              ) : (
                genres?.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {genres.map((genre) => (
                      <span
                        key={`genre-${genre}`}
                        className="rounded-full border border-border bg-ink-1/60 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-muted backdrop-blur"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )
              )}

              {/* 出版社 · Publisher / edition strip.
                  Read mode: a single quiet line "Glénat · Édition deluxe"
                  in mono micro — only rendered when at least one field is
                  set, so an unedited series stays clean.
                  Edit mode: two text inputs paired with a shared datalist
                  of common imprints so the user gets autocompletion
                  without any custom popup component. */}
              {!isEditing && (publisher || edition) && (
                <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
                  <span aria-hidden="true" className="font-jp text-xs text-hanko/70">
                    出版
                  </span>
                  {publisher && <span className="text-washi-muted">{publisher}</span>}
                  {publisher && edition && (
                    <span aria-hidden="true" className="text-washi-dim">
                      ·
                    </span>
                  )}
                  {edition && <span className="text-washi-muted italic">{edition}</span>}
                </div>
              )}
              {isEditing && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <PublisherEditionField
                    id="manga-publisher"
                    label={t("manga.publisherLabel")}
                    placeholder={t("manga.publisherPlaceholder")}
                    value={publisher}
                    onChange={setPublisher}
                    listId="mc-publisher-list"
                    maxLength={80}
                    options={PUBLISHER_PRESETS}
                  />
                  <PublisherEditionField
                    id="manga-edition"
                    label={t("manga.editionLabel")}
                    placeholder={t("manga.editionPlaceholder")}
                    value={edition}
                    onChange={setEdition}
                    listId="mc-edition-list"
                    maxLength={60}
                    options={EDITION_PRESETS.map((key) => t(`manga.editionPreset_${key}`))}
                  />
                </div>
              )}

              {/* 蔵書 · Unified collection block — combines the former
                  Collection stats (owned/total, completion %) with the
                  reading-status emaki. The 3 chips in the header (印
                  possédés / 読 lus / 積 en attente) replace the old
                  duplicated N/M big stats; the emaki strip remains the
                  interactive visual layer; the total-volumes editor is
                  hosted here during edit mode. */}
              {!volumesLoading && (
                <LibraryBlock
                  volumes={volumes}
                  volumesOwned={volumesOwned}
                  totalVolumes={totalVolumes}
                  isEditing={isEditing}
                  setTotalVolumes={setTotalVolumes}
                />
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {!isEditing ? (
                  <>
                    {/* Split-button: main pill enters edit mode; caret
                        opens the sync actions menu. The caret is rendered
                        ONLY when at least one external ref exists —
                        custom-only series don't have anything to sync
                        from, so the caret would be dead weight. */}
                    <div
                      ref={splitButtonRef}
                      data-edit-menu
                      className="inline-flex flex-1 sm:flex-none"
                    >
                      <button
                        onClick={() => setIsEditing(true)}
                        className={`inline-flex flex-1 items-center justify-center gap-1.5 bg-hanko px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi shadow-lg transition hover:bg-hanko-bright active:scale-95 sm:flex-none ${
                          manga.mal_id > 0 || liveMangadexId
                            ? "rounded-l-full"
                            : "rounded-full"
                        }`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-3.5 w-3.5"
                        >
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                        {t("common.edit")}
                      </button>
                      {(manga.mal_id > 0 || liveMangadexId) && (
                        <button
                          onClick={() => {
                            setEditMenuOpen((prev) => {
                              const next = !prev;
                              if (next && splitButtonRef.current) {
                                const r =
                                  splitButtonRef.current.getBoundingClientRect();
                                setEditMenuPos({
                                  top: r.bottom + 6,
                                  left: r.left,
                                });
                              }
                              return next;
                            });
                          }}
                          disabled={refreshing}
                          aria-label={t("manga.syncMenuLabel")}
                          aria-expanded={editMenuOpen}
                          aria-haspopup="menu"
                          className="inline-flex items-center justify-center rounded-r-full border-l border-hanko-deep/60 bg-hanko px-2.5 py-2.5 text-washi shadow-lg transition hover:bg-hanko-bright active:scale-95 disabled:opacity-60"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`h-3.5 w-3.5 transition-transform duration-200 ${editMenuOpen ? "rotate-180" : ""}`}
                            aria-hidden="true"
                          >
                            <polyline points="6 9 12 15 18 9" />
                          </svg>
                        </button>
                      )}

                    </div>
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-hanko/30 bg-transparent px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/10 active:scale-95 sm:flex-none"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                      {t("common.remove")}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleSave}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-gold px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-0 shadow-lg transition hover:brightness-110 active:scale-95"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {t("manga.saveChanges")}
                    </button>
                    <button
                      onClick={() => {
                        setIsEditing(false);
                        setSelectedImage(undefined);
                        setSelectedImagePreview(null);
                      }}
                      className="inline-flex flex-1 items-center justify-center rounded-full border border-border px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
                    >
                      {t("common.cancel")}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        <section
          className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-up"
          style={{ animationDelay: "150ms" }}
        >
          <SummaryCard
            label={t("manga.totalPaid")}
            value={formatCurrency(totalPrice, currencySetting)}
            hint={t("manga.ownedCount", { n: volumesOwned })}
            loading={volumesLoading}
            skeletonWidth="5ch"
          />
          <SummaryCard
            label={t("manga.averagePerVolume")}
            value={
              volumesOwned > 0 ? formatCurrency(avgPrice, currencySetting) : "—"
            }
            hint={t("manga.acrossOwned")}
            loading={volumesLoading}
            skeletonWidth="4ch"
          />
          <div className="sm:col-span-2 lg:col-span-1">
            {!showAddDropdown ? (
              <button
                onClick={() => setShowAddDropdown(true)}
                disabled={
                  volumesOwned >= (volumes?.length ?? 0) ||
                  (volumes?.length ?? 0) === 0
                }
                className="group relative h-full w-full overflow-hidden rounded-2xl border border-dashed border-border bg-ink-1/40 p-5 text-left backdrop-blur transition hover:border-hanko/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                  {t("manga.bulkActionLabel")}
                </p>
                <p className="mt-2 font-display text-base font-semibold text-washi">
                  {t("manga.bulkActionTitle")}
                </p>
                <p className="mt-1 text-xs text-washi-muted">
                  {t("manga.bulkActionHint")}
                </p>
                <span className="absolute bottom-4 right-4 grid h-8 w-8 place-items-center rounded-full bg-hanko/20 text-hanko transition group-hover:bg-hanko group-hover:text-washi">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
              </button>
            ) : (
              <div className="rounded-2xl border border-hanko/30 bg-ink-1/80 p-4 backdrop-blur animate-fade-up">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-hanko">
                  {t("manga.bulkAdd")}
                </p>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                      {t("manga.avgPrice", {
                        symbol: currencySetting?.symbol || "$",
                      })}
                    </label>
                    <input
                      type="number"
                      value={addAvgPrice}
                      onChange={(e) => setAddAvgPrice(e.target.value)}
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      className="w-full rounded-lg border border-border bg-ink-0 px-3 py-2 text-sm text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                      {t("manga.storeLabel")}
                    </label>
                    <StoreAutocomplete
                      value={addStore}
                      onChange={(e) => setAddStore(e.target.value)}
                      placeholder={t("manga.storePlaceholder")}
                      maxLength={50}
                      className="w-full rounded-lg border border-border bg-ink-0 px-3 py-2 text-sm text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleAddAllVolumes}
                      className="flex-1 rounded-lg bg-hanko px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi transition hover:bg-hanko-bright active:scale-95"
                    >
                      {t("common.confirm")}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddDropdown(false);
                        setAddAvgPrice("");
                        setAddStore("");
                      }}
                      className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section
          className="animate-fade-up"
          style={{ animationDelay: "300ms" }}
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="font-display text-2xl font-semibold italic text-washi">
                {t("manga.volumesTitle")}
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-wider text-washi-dim">
                {t("manga.volumesCount", { n: volumes?.length ?? 0 })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(volumes?.length ?? 0) > 0 && <VolumesViewToggle />}

              {manga.mal_id >= 0 && (volumes?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => setCoffretModalOpen(true)}
                  disabled={!online}
                  title={!online ? t("coffret.offlineHint") : undefined}
                  className="inline-flex items-center gap-1.5 rounded-full border border-washi/30 bg-washi/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-washi/60 hover:bg-washi/10 hover:text-washi active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span
                    aria-hidden="true"
                    className="font-display text-[13px] leading-none text-washi"
                    title={t("badges.coffret")}
                  >
                    盒
                  </span>
                  {t("coffret.addCta")}
                </button>
              )}
            </div>
          </div>

          {volumesLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-ink-1/30 p-4"
                >
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : volumes?.length > 0 ? (
            <div className="space-y-4">
              {volumeSequence.map((seg, idx) =>
                seg.type === "coffret" ? (
                  <CoffretGroup
                    key={`c-${seg.coffret.id}`}
                    coffret={seg.coffret}
                    currencySetting={currencySetting}
                  >
                    {seg.members.map((vol) =>
                      isShelfMode ? (
                        <VolumeShelfTile
                          key={vol.id}
                          volNum={vol.vol_num}
                          owned={vol.owned}
                          collector={vol.collector}
                          readAt={vol.read_at}
                          releaseDate={vol.release_date}
                          coverUrl={volumeCoverMap?.[vol.vol_num]}
                          blurImage={isBlurred}
                          note={vol.notes}
                          locked
                        />
                      ) : (
                        <Volume
                          key={vol.id}
                          id={vol.id}
                          mal_id={vol.mal_id}
                          volNum={vol.vol_num}
                          owned={vol.owned}
                          paid={vol.price}
                          store={vol.store}
                          collector={vol.collector}
                          readAt={vol.read_at}
                          note={vol.notes}
                          releaseDate={vol.release_date}
                          releaseIsbn={vol.release_isbn}
                          releaseUrl={vol.release_url}
                          origin={vol.origin}
                          announcedAt={vol.announced_at}
                          locked
                          onUpdate={volumeUpdateCallback}
                          onEditUpcoming={(volData) => {
                            setEditingUpcoming(volData);
                            setUpcomingModalOpen(true);
                          }}
                          currencySetting={currencySetting}
                          coverUrl={volumeCoverMap?.[vol.vol_num]}
                          blurImage={isBlurred}
                          onPreviewShow={previewCtl.show}
                          onPreviewRelease={previewCtl.release}
                        />
                      ),
                    )}
                  </CoffretGroup>
                ) : (
                  <div
                    key={`g-${idx}`}
                    className={
                      isShelfMode
                        ? "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
                        : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    }
                  >
                    {seg.vols.map((vol) =>
                      isShelfMode ? (
                        <VolumeShelfTile
                          key={vol.id}
                          volNum={vol.vol_num}
                          owned={vol.owned}
                          collector={vol.collector}
                          readAt={vol.read_at}
                          releaseDate={vol.release_date}
                          coverUrl={volumeCoverMap?.[vol.vol_num]}
                          blurImage={isBlurred}
                        />
                      ) : (
                        <Volume
                          key={vol.id}
                          id={vol.id}
                          mal_id={vol.mal_id}
                          volNum={vol.vol_num}
                          owned={vol.owned}
                          paid={vol.price}
                          store={vol.store}
                          collector={vol.collector}
                          readAt={vol.read_at}
                          note={vol.notes}
                          releaseDate={vol.release_date}
                          releaseIsbn={vol.release_isbn}
                          releaseUrl={vol.release_url}
                          origin={vol.origin}
                          announcedAt={vol.announced_at}
                          onUpdate={volumeUpdateCallback}
                          onEditUpcoming={(volData) => {
                            setEditingUpcoming(volData);
                            setUpcomingModalOpen(true);
                          }}
                          currencySetting={currencySetting}
                          coverUrl={volumeCoverMap?.[vol.vol_num]}
                          blurImage={isBlurred}
                          onPreviewShow={previewCtl.show}
                          onPreviewRelease={previewCtl.release}
                        />
                      ),
                    )}
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-ink-1/30 p-8 text-center text-sm text-washi-muted">
              {t("manga.noVolumesYet")}
            </div>
          )}
        </section>
      </div>

      {/* 盒 · Coffret builder — lazy chunk. Outer guard ensures the
          chunk fetch only fires on the first time the user opens the
          flow. */}
      {coffretModalOpen && (
        <Suspense fallback={null}>
          <AddCoffretModal
            open
            onClose={() => setCoffretModalOpen(false)}
            mal_id={manga.mal_id}
            totalVolumes={totalVolumes}
            currencySetting={currencySetting}
          />
        </Suspense>
      )}

      {/* 来 · Manual upcoming-volume modal — mounted lazily so first
          paint of MangaPage doesn't drag in 400 lines of date input
          + form chrome. The same modal handles both create (from the
          edit menu) and edit (from the volume drawer's "edit announce"
          CTA when origin === "manual"). */}
      {upcomingModalOpen && (
        <Suspense fallback={null}>
          <AddUpcomingVolumeModal
            open
            onClose={() => {
              setUpcomingModalOpen(false);
              setEditingUpcoming(null);
            }}
            manga={manga}
            highestKnownVolNum={
              volumes?.reduce((m, v) => Math.max(m, v.vol_num ?? 0), 0) ?? 0
            }
            editingVolume={editingUpcoming}
          />
        </Suspense>
      )}

      <Modal popupOpen={posterPopUp} handleClose={() => setPosterPopUp(false)}>
        <img referrerPolicy="no-referrer"
          src={poster}
          alt={name}
          className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        />
      </Modal>

      {/* 絵 · Cover picker — same lazy pattern; only fired when
          the user enters edit mode AND opens the picker. */}
      {coverPickerOpen && (
        <Suspense fallback={null}>
          <CoverPickerModal
            open
            onClose={() => setCoverPickerOpen(false)}
            mal_id={manga.mal_id}
            currentUrl={poster}
        onConfirm={async (url) => {
          // Offline-safe: enqueue via Dexie + outbox instead of a direct
          // axios call. Local state (Dexie → useLiveQuery → liveLibraryRow)
          // updates immediately, and the PATCH fires whenever the server is
          // reachable. A queryClient invalidation is no longer needed —
          // useLiveQuery on Dexie is the canonical source for the UI.
          await setPosterMutation.mutateAsync({
            mal_id: manga.mal_id,
            url,
          });
          setPoster(url);
          setCoverPickerOpen(false);
        }}
          />
        </Suspense>
      )}

      {/* Sync-actions dropdown, portaled to body so it escapes every
          ancestor stacking context (the Total-dépensé card uses
          backdrop-blur which creates one). Position is computed at open
          time from the split-button's bounding rect; scrolling dismisses
          (handled by the useEffect above). */}
      {editMenuOpen &&
        editMenuPos &&
        createPortal(
          <div
            data-edit-menu
            role="menu"
            style={{
              position: "fixed",
              top: editMenuPos.top,
              left: editMenuPos.left,
              zIndex: 2147483620,
            }}
            className="min-w-[240px] overflow-hidden rounded-xl border border-border bg-ink-1/98 shadow-2xl backdrop-blur animate-fade-up"
          >
            <p className="border-b border-border/60 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.25em] text-washi-dim">
              {t("manga.syncMenuHeading")}
            </p>
            {manga.mal_id > 0 && (
              <button
                role="menuitem"
                onClick={async () => {
                  // Await the full sync BEFORE closing the menu — the user
                  // gets persistent feedback (spinning icon on this row)
                  // for however long the request takes.
                  await updateFromMal();
                  setEditMenuOpen(false);
                }}
                disabled={refreshing || !online}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs font-semibold text-washi-muted transition hover:bg-hanko/10 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-3.5 w-3.5 shrink-0 ${refreshingSource === "mal" ? "animate-spin" : ""}`}
                  aria-hidden="true"
                >
                  <path d="M3 2v6h6" />
                  <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
                  <path d="M21 22v-6h-6" />
                  <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
                </svg>
                <span className="flex-1 truncate">{t("manga.syncFromMal")}</span>
              </button>
            )}
            {liveMangadexId && (
              <button
                role="menuitem"
                onClick={async () => {
                  await updateFromMangadex();
                  setEditMenuOpen(false);
                }}
                disabled={refreshing || !online}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs font-semibold text-washi-muted transition hover:bg-hanko/10 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`h-3.5 w-3.5 shrink-0 ${refreshingSource === "mangadex" ? "animate-spin" : ""}`}
                  aria-hidden="true"
                >
                  <path d="M3 2v6h6" />
                  <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
                  <path d="M21 22v-6h-6" />
                  <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
                </svg>
                <span className="flex-1 truncate">
                  {t("manga.syncFromMangadex")}
                </span>
              </button>
            )}
            {/* Custom-only series (mal_id < 0) have no calendar source. */}
            {manga.mal_id > 0 && (
              <button
                role="menuitem"
                onClick={async () => {
                  await refreshUpcomingVolumes();
                  setEditMenuOpen(false);
                }}
                disabled={refreshing || !online}
                title={
                  !online
                    ? t("manga.upcomingOfflineHint")
                    : t("manga.upcomingRefreshHint")
                }
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs font-semibold text-washi-muted transition hover:bg-moegi/10 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span
                  aria-hidden="true"
                  className={`font-jp text-[14px] font-bold leading-none text-moegi shrink-0 w-3.5 text-center ${
                    refreshingSource === "upcoming" ? "animate-pulse" : ""
                  }`}
                >
                  来
                </span>
                <span className="flex-1 truncate">
                  {refreshingSource === "upcoming"
                    ? t("manga.upcomingRefreshing")
                    : t("manga.upcomingRefresh")}
                </span>
              </button>
            )}
            {/* 来 · Manual sibling. Available always — the only path
                upcoming volumes have on a custom series (mal_id < 0)
                where the auto cascade above isn't allowed. */}
            <button
              role="menuitem"
              onClick={() => {
                setEditingUpcoming(null);
                setUpcomingModalOpen(true);
                setEditMenuOpen(false);
              }}
              disabled={!online}
              title={
                !online
                  ? t("manga.upcomingAddManualOfflineHint")
                  : t("manga.upcomingAddManualHint")
              }
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs font-semibold text-washi-muted transition hover:bg-moegi/10 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span
                aria-hidden="true"
                className="font-jp text-[14px] font-bold leading-none text-moegi shrink-0 w-3.5 text-center"
              >
                来
              </span>
              <span className="flex-1 truncate">
                {t("manga.upcomingAddManual")}
              </span>
              {/* Pencil glyph emphasises "manual" vs the auto-refresh's
                  cycling-arrow visual. */}
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-3 w-3 shrink-0 text-moegi/70"
              >
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            {!online && (
              <p className="border-t border-border/60 bg-hanko/5 px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-hanko-bright">
                {t("manga.refreshOffline")}
              </p>
            )}
          </div>,
          document.body,
        )}

      {/* Shared volume-cover preview — one instance, driven by the
          controller. Sticky on mobile (long-press peek + tap to zoom),
          non-sticky on desktop (hover peek). */}
      <CoverPreview
        url={previewCtl.url}
        anchorRect={previewCtl.anchorRect}
        visible={previewCtl.visible}
        sticky={previewCtl.sticky}
        blur={isBlurred}
        onClose={previewCtl.hide}
        onZoom={previewCtl.openZoom}
      />

      {/* Full-screen zoom modal triggered by tapping the preview on
          mobile. Reuses the standard Modal shell for consistency. */}
      <Modal
        popupOpen={previewCtl.zoomOpen}
        handleClose={previewCtl.hide}
      >
        {previewCtl.url && (
          <img referrerPolicy="no-referrer"
            src={previewCtl.url}
            alt=""
            className={`max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl ${
              isBlurred ? "blur-lg" : ""
            }`}
          />
        )}
      </Modal>

      <Modal
        popupOpen={confirmDelete}
        handleClose={() => setConfirmDelete(false)}
      >
        <div className="max-w-md rounded-2xl border border-border bg-ink-1 p-6 shadow-2xl">
          <div
            className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm"
            title={t("badges.deletion")}
          >
            削
          </div>
          <h3 className="text-center font-display text-xl font-semibold text-washi">
            {t("manga.removeTitle")}
          </h3>
          <p className="mt-2 text-center text-sm text-washi-muted">
            {t("manga.removeBody", { name })}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi"
            >
              {t("manga.keepIt")}
            </button>
            <button
              onClick={confirmDeleteManga}
              className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright"
            >
              {t("common.remove")}
            </button>
          </div>
        </div>
      </Modal>
    </DefaultBackground>
  );
}

/**
 * LibraryBlock — 蔵書 (zōsho, "books conserved").
 *
 * Unified collection+reading panel that replaces the two separate blocks
 * (old "Collection" stats + emaki progress) we had before. Three chips
 * (印 possédés / 読 lus / 積 en attente) express every count the user
 * cares about at a glance, and the emaki scroll below gives the per-tome
 * interactive layer. The total-volumes editor is hosted here during edit
 * mode so the whole "library size + state" concept lives in one place.
 *
 * The emaki itself is unchanged from the v1 implementation:
 *
 *   ┃▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░       ┃
 *    └──────── read ─────┘└ owned ┘└ missing ┘
 *     1          51          101
 *
 * With a "reading-head" ink-drop floating above the last-read position
 * and click-zones that scroll to the matching Volume card below.
 */
function LibraryBlock({
  volumes,
  volumesOwned,
  totalVolumes,
  isEditing,
  setTotalVolumes,
}) {
  const t = useT();
  const byNum = new Map();
  for (const v of volumes ?? []) {
    byNum.set(v.vol_num, v);
  }
  let readCount = 0;
  let tsundokuCount = 0;
  let lastReadNum = 0;
  const cells = [];
  for (let n = 1; n <= totalVolumes; n++) {
    const v = byNum.get(n);
    let state = "missing";
    if (v?.read_at) {
      state = "read";
      readCount += 1;
      if (n > lastReadNum) lastReadNum = n;
    } else if (v?.owned) {
      state = "tsundoku";
      tsundokuCount += 1;
    }
    cells.push({ num: n, state, readAt: v?.read_at });
  }
  // Division-by-zero guard: `totalVolumes = 0` produces NaN which
  // then renders as "NaN%" in LibraryChip and trashed styles via
  // width: `${NaN}%`. Happens when a series is freshly created with
  // an unknown volume total.
  const percent =
    totalVolumes > 0 ? Math.round((readCount / totalVolumes) * 100) : 0;

  // Decade ticks + labels. For short series (<=40) we draw every-10 ticks
  // + every-10 labels; for longer series we space labels every 25 or 50
  // to keep the strip uncluttered.
  const labelStep = totalVolumes <= 40 ? 10 : totalVolumes <= 100 ? 25 : 50;
  const decadeMarks = [];
  for (let n = labelStep; n < totalVolumes; n += labelStep) {
    decadeMarks.push(n);
  }
  // Minor tick marks (every 10) — drawn subtler than the labeled ones.
  const minorTicks = [];
  if (totalVolumes > 20) {
    for (let n = 10; n < totalVolumes; n += 10) {
      if (!decadeMarks.includes(n)) minorTicks.push(n);
    }
  }

  const scrollToVolume = (num) => {
    const el = document.querySelector(`[data-vol-num="${num}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const card = el.closest(".group");
    if (card) {
      card.classList.add("ring-flash");
      setTimeout(() => card.classList.remove("ring-flash"), 1600);
    }
  };

  // Helper: turn vol_num into % position on the strip. Each tome occupies
  // (1/totalVolumes) of the width, so tome N is centred at (N-0.5)/total.
  const posPercent = (num) => ((num - 0.5) / totalVolumes) * 100;

  const ownedPercent =
    totalVolumes > 0 ? Math.round((volumesOwned / totalVolumes) * 100) : 0;

  return (
    <div className="mt-8 rounded-2xl border border-border bg-ink-1/40 p-5 backdrop-blur animate-fade-up">
      {/* Eyebrow + global reading percent — the percent is the most
          "where I'm at" signal for this series. */}
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
          {t("manga.libraryLabel")}
        </p>
        {totalVolumes > 0 && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted tabular-nums">
            {percent}
            <span className="text-washi-dim">% 読破</span>
          </p>
        )}
      </div>

      {/* Three-chips header — replaces the old redundant "N / M" + "%"
          big stats. Each chip pairs a kanji sigil with its count, so the
          user can read the three dimensions of the library state in
          parallel. `/ total` in smaller ink-dim to keep the focus on the
          salient numerator. */}
      <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        <LibraryChip
          kanji="印"
          label={t("manga.ownedChip")}
          value={volumesOwned}
          total={totalVolumes}
          percent={ownedPercent}
          accent="hanko"
        />
        <LibraryChip
          kanji="読"
          label={t("manga.readChip")}
          value={readCount}
          total={totalVolumes}
          percent={percent}
          accent="moegi"
        />
        <LibraryChip
          kanji="積"
          label={t("manga.tsundokuChipShort")}
          value={tsundokuCount}
          accent="washi"
        />
      </div>

      {/* Emaki strip — only rendered when we know how many tomes the
          series has. Otherwise we just show the chips + the edit input. */}
      {totalVolumes > 0 && (
      <div className="relative mt-8 px-3" role="group" aria-label={t("manga.readingAria", { read: readCount, total: totalVolumes })}>
        {/* Reading head (pic d'encre) — floats above the strip at the
            last-read position. Hidden gracefully when no tome read yet. */}
        {lastReadNum > 0 && (
          <div
            className="emaki-head pointer-events-none absolute -top-6 -translate-x-1/2"
            style={{ left: `calc(${posPercent(lastReadNum)}% + 0px)` }}
          >
            <span
              className="font-jp text-[10px] leading-none tabular-nums"
              title={t("manga.readingHeadTitle", { n: lastReadNum })}
            >
              読 · {lastReadNum}
            </span>
            <span className="emaki-dot" aria-hidden="true" />
            <span className="emaki-halo" aria-hidden="true" />
          </div>
        )}

        {/* Left scroll-rod — the bamboo stick of the emaki */}
        <span
          aria-hidden="true"
          className="emaki-rod emaki-rod-left"
        />
        {/* Right scroll-rod */}
        <span
          aria-hidden="true"
          className="emaki-rod emaki-rod-right"
        />

        {/* The strip itself — paper surface, with state segments stacked
            on top via absolute positioning. */}
        <div className="emaki-strip relative h-4 animate-emaki-unroll">
          {/* State segments — one absolute div per tome position.
              - read: moegi gradient (horizontal, continuous across all
                read cells via matched background-size + position)
              - tsundoku: washi-dim rayé (solid pattern, no gradient)
              - missing: transparent (lets the paper surface show) */}
          {cells.map((cell) => {
            const style = {
              left: `${((cell.num - 1) / totalVolumes) * 100}%`,
              width: `${(1 / totalVolumes) * 100}%`,
            };
            if (cell.state === "read" && totalVolumes > 1) {
              // Stretch the gradient to the full strip width, then offset
              // so each cell shows only its own slice. Formula:
              //   size = totalVolumes * 100% (stretches gradient over N cells)
              //   position-x = (n-1) / (N-1) * 100%  (slides to the cell's slot)
              style.backgroundSize = `${totalVolumes * 100}% 100%`;
              style.backgroundPosition = `${
                ((cell.num - 1) * 100) / (totalVolumes - 1)
              }% center`;
            }
            return (
              <div
                key={cell.num}
                className={`emaki-cell emaki-cell-${cell.state}`}
                style={style}
                aria-hidden="true"
              />
            );
          })}

          {/* Minor decade ticks — every-10 marks, very subtle */}
          {minorTicks.map((n) => (
            <span
              key={`tick-${n}`}
              aria-hidden="true"
              className="emaki-tick emaki-tick-minor"
              style={{ left: `${(n / totalVolumes) * 100}%` }}
            />
          ))}
          {/* Major labelled marks */}
          {decadeMarks.map((n) => (
            <span
              key={`mark-${n}`}
              aria-hidden="true"
              className="emaki-tick emaki-tick-major"
              style={{ left: `${(n / totalVolumes) * 100}%` }}
            />
          ))}
        </div>

        {/* Invisible click grid — one zone per tome. Takes the full strip
            width, stacked over everything. `flex-1` gives equal zones. */}
        <div className="absolute inset-0 flex">
          {cells.map((cell) => (
            <button
              key={cell.num}
              type="button"
              onClick={() => scrollToVolume(cell.num)}
              title={
                cell.state === "read"
                  ? t("manga.readingCellRead", {
                      n: cell.num,
                      date: cell.readAt
                        ? new Date(cell.readAt).toLocaleDateString()
                        : "",
                    })
                  : cell.state === "tsundoku"
                    ? t("manga.readingCellTsundoku", { n: cell.num })
                    : t("manga.readingCellMissing", { n: cell.num })
              }
              aria-label={t(`manga.readingAriaCell.${cell.state}`, {
                n: cell.num,
              })}
              className="emaki-hit flex-1 focus:outline-none"
            />
          ))}
        </div>

        {/* Decade labels row, under the strip */}
        <div className="relative mt-2 h-4 font-mono text-[9px] font-semibold uppercase tracking-widest text-washi-dim tabular-nums">
          <span className="absolute left-0 -translate-x-1/2">1</span>
          {decadeMarks.map((n) => (
            <span
              key={`lbl-${n}`}
              className="absolute -translate-x-1/2"
              style={{ left: `${(n / totalVolumes) * 100}%` }}
            >
              {n}
            </span>
          ))}
          <span className="absolute right-0 translate-x-1/2">
            {totalVolumes}
          </span>
        </div>
      </div>
      )}

      {/* Total-volumes editor — moved here from the old Collection block
          now that the two blocks are merged. Only rendered in edit mode;
          sits below the emaki so it doesn't interrupt the visual when
          viewing. */}
      {isEditing && (
        <div className="mt-5 border-t border-border pt-4">
          <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-washi-dim">
            {t("manga.totalVolumes")}
          </label>
          <input
            type="number"
            value={totalVolumes}
            onChange={(e) => setTotalVolumes(Number(e.target.value))}
            min="0"
            className="w-full rounded-lg border border-border bg-ink-1 px-3 py-2 text-sm text-washi focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
          />
        </div>
      )}
    </div>
  );
}

/**
 * LibraryChip — one of the three stat chips (印 / 読 / 積) inside the
 * unified LibraryBlock header. Pairs a Noto Serif JP kanji with a
 * tabular count + optional "/ total" denominator and a small footnote.
 */
function LibraryChip({ kanji, label, value, total, percent, accent }) {
  const colour =
    accent === "hanko"
      ? "text-hanko-bright"
      : accent === "moegi"
        ? "text-moegi"
        : "text-washi";
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-ink-2/40 px-3 py-2.5 transition hover:border-hanko/30 sm:px-4">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden="true"
          className={`font-jp text-lg leading-none ${colour}`}
        >
          {kanji}
        </span>
        <span
          className={`font-display text-2xl font-semibold tabular-nums ${colour}`}
        >
          {value}
        </span>
        {total != null && (
          <span className="font-display text-sm italic text-washi-dim tabular-nums">
            / {total}
          </span>
        )}
      </div>
      <p className="mt-0.5 flex items-baseline gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-washi-dim">
        <span>{label}</span>
        {percent != null && total > 0 && (
          <span className="text-washi-muted tabular-nums">· {percent}%</span>
        )}
      </p>
    </div>
  );
}

/**
 * 出版社 · Datalist-backed text input used by the publisher / edition
 * fields. Keeps the markup a single shared atom so the two inputs stay
 * in lockstep on padding, focus ring, and length cap. The browser's
 * native `<datalist>` handles the autocomplete dropdown — zero JS, zero
 * custom popover, fully accessible by default, free mobile suggestions.
 */
function PublisherEditionField({
  id,
  label,
  placeholder,
  value,
  onChange,
  listId,
  maxLength,
  options,
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </label>
  );
}

/** Common imprints across markets — surfaced as suggestions in the
 *  publisher field. Trim to the most-collected names so the dropdown
 *  stays scannable; users can always type anything not on the list. */
const PUBLISHER_PRESETS = [
  // FR
  "Glénat",
  "Kana",
  "Pika",
  "Ki-oon",
  "Kurokawa",
  "Akata",
  "Soleil",
  "Doki-Doki",
  "Delcourt / Tonkam",
  "Mangetsu",
  "Vega",
  "Casterman / Sakka",
  "Noeve Grafx",
  "Black Box",
  "Crunchyroll Manga",
  "Panini Manga",
  // EN
  "Viz Media",
  "Yen Press",
  "Kodansha USA",
  "Seven Seas",
  "Square Enix Manga",
  "Dark Horse",
  "Vertical",
  "Tokyopop",
  // ES
  "Norma Editorial",
  "Panini Cómics",
  "Editorial Ivréa",
  "Planeta Cómic",
  "ECC Ediciones",
];

/** Edition variants — keys; the resolved labels live in i18n so the
 *  suggestions show in the user's current language. Free-text input
 *  remains the source of truth. */
const EDITION_PRESETS = [
  "standard",
  "kanzenban",
  "perfect",
  "deluxe",
  "ultimate",
  "original",
  "color",
  "anniversary",
  "doubleVolumes",
  "pocket",
];

function SummaryCard({ label, value, hint, loading, skeletonWidth }) {
  return (
    <div className="rounded-2xl border border-border bg-ink-1/50 p-5 backdrop-blur">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
        {label}
      </p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-washi">
        {loading ? <Skeleton.Stat width={skeletonWidth} /> : value}
      </p>
      {hint && (
        <p className="mt-1 text-xs text-washi-muted">
          {loading ? <Skeleton className="h-3 w-32 align-middle" /> : hint}
        </p>
      )}
    </div>
  );
}

/**
 * Inline tag editor for custom-only library rows.
 *
 * Activates when `isCustomGenresEditable` is true on MangaPage (mal_id <
 * 0 AND no mangadex_id). For every other row, genres render read-only
 * because a future `refresh-from-*` would clobber the edits — the
 * server enforces the same gate as a defence in depth.
 *
 * Behaviour:
 *   · Each chip carries a hover-revealed `×` to drop that tag.
 *   · A trailing "+ Ajouter" button toggles into a small input.
 *   · The input shows up to 8 autocomplete suggestions sourced from the
 *     UNION of every genre present elsewhere in the user's library
 *     (case-insensitive matching, but the suggestion preserves the
 *     existing casing so the user's earlier choice wins).
 *   · Enter / suggestion-click adds. Escape / blur cancels.
 *   · Hard cap of 30 tags per row + 40 chars per tag (mirrors the
 *     server's `sanitize_genres` so the UI doesn't promise what the
 *     server will refuse).
 *
 * `onChange` receives the new full list and is responsible for both
 * the local state update AND the server mutation (the parent passes
 * `(next) => { setGenres(next); updateMangaMeta.mutate({ genres: next }); }`).
 */
const TAG_MAX_LEN = 40;
const TAGS_MAX_COUNT = 30;
const SUGGESTION_LIMIT = 8;

function TagEditor({ genres, library, onChange, t }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  // Pool of every genre seen anywhere else in the user's library, minus
  // the ones already on this row. Built case-insensitive so adding
  // "shōnen" when the library has "Shōnen" doesn't double-suggest it.
  const allTags = useMemo(() => {
    const seen = new Map(); // lowercase → original casing (first seen wins)
    (library ?? []).forEach((m) => {
      (m.genres ?? []).forEach((g) => {
        const trimmed = (g ?? "").trim();
        if (!trimmed) return;
        const lc = trimmed.toLowerCase();
        if (!seen.has(lc)) seen.set(lc, trimmed);
      });
    });
    const currentLc = new Set(genres.map((g) => g.toLowerCase()));
    return [...seen.entries()]
      .filter(([lc]) => !currentLc.has(lc))
      .map(([, label]) => label)
      .sort((a, b) => a.localeCompare(b));
  }, [library, genres]);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return allTags.slice(0, SUGGESTION_LIMIT);
    return allTags
      .filter((tag) => tag.toLowerCase().includes(q))
      .slice(0, SUGGESTION_LIMIT);
  }, [draft, allTags]);

  const atCap = genres.length >= TAGS_MAX_COUNT;

  const remove = (g) => {
    const next = genres.filter((x) => x !== g);
    onChange(next);
  };

  const add = (raw) => {
    const trimmed = (raw ?? "").trim().slice(0, TAG_MAX_LEN);
    if (!trimmed) return;
    if (genres.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
      // Already present; close the input but keep the existing entry.
      setDraft("");
      setAdding(false);
      return;
    }
    if (atCap) return;
    onChange([...genres, trimmed]);
    setDraft("");
    setAdding(false);
  };

  const beginAdd = () => {
    if (atCap) return;
    setAdding(true);
    // Defer focus until after the input mounts.
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft("");
  };

  return (
    <div className="mt-5 flex flex-wrap items-center gap-1.5">
      {genres.map((genre) => (
        <span
          key={`genre-${genre}`}
          className="group inline-flex items-center gap-1 rounded-full border border-border bg-ink-1/60 py-0.5 pl-2.5 pr-1 font-mono text-[10px] uppercase tracking-wider text-washi-muted backdrop-blur transition hover:border-hanko/40 hover:text-washi"
        >
          <span>{genre}</span>
          <button
            type="button"
            onClick={() => remove(genre)}
            aria-label={t("manga.removeTag")}
            title={t("manga.removeTag")}
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-washi-dim transition hover:bg-hanko/25 hover:text-hanko-bright"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-2.5 w-2.5"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </span>
      ))}

      {adding ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, TAG_MAX_LEN))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(draft);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelAdd();
              }
            }}
            onBlur={() => {
              // Delay the close so a click on a suggestion lands first.
              // 120ms is enough for a fast click, short enough that an
              // accidental focus-out feels responsive.
              setTimeout(cancelAdd, 120);
            }}
            placeholder={t("manga.addTagPlaceholder")}
            maxLength={TAG_MAX_LEN}
            className="w-44 rounded-full border border-hanko/40 bg-ink-2/80 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-washi placeholder:text-washi-dim placeholder:normal-case placeholder:tracking-normal focus:border-hanko focus:outline-none focus:ring-1 focus:ring-hanko/40"
          />
          {suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-full overflow-auto rounded-md border border-border bg-ink-1/95 shadow-xl backdrop-blur animate-fade-in"
            >
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    // onMouseDown so the click fires *before* the input's
                    // onBlur cancellation. Without this, blur cancels the
                    // edit before the click handler ever runs.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(s);
                    }}
                    className="block w-full px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-washi-muted transition hover:bg-hanko/15 hover:text-washi"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={beginAdd}
          disabled={atCap}
          title={
            atCap
              ? t("manga.addTag") + " · " + TAGS_MAX_COUNT + "/" + TAGS_MAX_COUNT
              : t("manga.addTag")
          }
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-hanko/40 bg-hanko/5 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-hanko-bright transition hover:border-hanko hover:bg-hanko/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true" className="leading-none">
            +
          </span>
          {t("manga.addTag")}
        </button>
      )}
    </div>
  );
}
