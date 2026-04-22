import { useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import Volume from "./Volume";
import CoffretGroup from "./CoffretGroup";
import AddCoffretModal from "./AddCoffretModal";
import CoverPickerModal from "./CoverPickerModal.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import StoreAutocomplete from "./ui/StoreAutocomplete.jsx";
import Modal from "@/components/utils/Modal.jsx";
import SettingsContext from "@/SettingsContext.js";
import {
  useDeleteManga,
  useLibrary,
  useSetPoster,
  useUpdateManga,
  useUpdateVolumesOwned,
} from "@/hooks/useLibrary.js";
import { useVolumesForManga, useUpdateVolume } from "@/hooks/useVolumes.js";
import { useCoffretsForManga } from "@/hooks/useCoffrets.js";
import { useVolumeCovers } from "@/hooks/useVolumeCovers.js";
import { useOnline } from "@/hooks/useOnline.js";
import { hasToBlurImage, updateLibFromMal } from "@/utils/library.js";
import { refreshFromMangadex } from "@/utils/user.js";
import { queryClient } from "@/lib/queryClient.js";
import { db } from "@/lib/db.js";
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
  const [refreshing, setRefreshing] = useState(false);

  const [totalVolumes, setTotalVolumes] = useState(manga.volumes ?? 0);
  // Seed from the frozen prop on first render; subsequent resyncs use the
  // live library row (see effect below).
  const [poster, setPoster] = useState(manga.image_url_jpg);
  const [genres, setGenres] = useState(manga.genres ?? []);
  const [name, setName] = useState(manga.name || t("manga.unknownTitle"));

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
  // `manga` comes frozen from React Router's location.state, so its volume
  // count never updates after navigation. Grab the live row from the Dexie-
  // backed library so edits (and background syncs) are reflected here.
  const { data: library } = useLibrary();
  const liveLibraryRow = library?.find((m) => m.mal_id === manga.mal_id);
  const liveVolumeCount = liveLibraryRow?.volumes ?? (manga.volumes ?? 0);
  const liveMangadexId = liveLibraryRow?.mangadex_id ?? manga.mangadex_id ?? null;
  const updateManga = useUpdateManga();
  const deleteManga = useDeleteManga();
  const updateVolumesOwned = useUpdateVolumesOwned();
  const setPosterMutation = useSetPoster();
  const updateVolume = useUpdateVolume();
  const [coffretModalOpen, setCoffretModalOpen] = useState(false);

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
    if (liveLibraryRow?.image_url_jpg != null && !isEditing) {
      setPoster(liveLibraryRow.image_url_jpg);
    }
  }, [liveLibraryRow?.image_url_jpg, isEditing]);

  const handleSave = async () => {
    try {
      const newTotal = parseInt(totalVolumes) || 0;
      await updateManga.mutateAsync({
        mal_id: manga.mal_id,
        volumes: newTotal,
      });

      // Poster upload is online-only (file payloads can't be queued)
      if (selectedImage && online) {
        try {
          await uploadPoster(manga.mal_id, selectedImage);
          const newPoster = `/api/user/storage/poster/${manga.mal_id}`;
          setPoster(newPoster + `?t=${Date.now()}`);
        } catch (err) {
          console.error("Poster upload failed:", err);
        }
      } else if (selectedImage === null && online) {
        try {
          setPoster(await removePoster(manga.mal_id));
        } catch (err) {
          console.error("Poster remove failed:", err);
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
      } finally {
        setShowAddDropdown(false);
        setAddAvgPrice("");
        setAddStore("");
      }
    }
  };

  const updateFromMal = async () => {
    if (!online) return;
    setRefreshing(true);
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
    } finally {
      setRefreshing(false);
    }
  };

  const updateFromMangadex = async () => {
    if (!online) return;
    setRefreshing(true);
    try {
      const { new_genres, new_name, new_image_url_jpg } =
        await refreshFromMangadex(manga.mal_id);
      if (new_genres) setGenres(new_genres);
      if (new_name) setName(new_name);
      if (new_image_url_jpg) setPoster(new_image_url_jpg);
      queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
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
              <img
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
                  <img
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
                  {!`${poster}`.startsWith("http") &&
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
                {manga.mal_id > 0 && (
                  <button
                    onClick={updateFromMal}
                    disabled={refreshing || !online}
                    aria-label={t("manga.refreshMalTitle")}
                    className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/40 hover:text-washi disabled:opacity-40"
                    title={
                      online
                        ? t("manga.refreshMalTitle")
                        : t("manga.refreshOffline")
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                    >
                      <path d="M3 2v6h6" />
                      <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
                      <path d="M21 22v-6h-6" />
                      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
                    </svg>
                    MAL
                  </button>
                )}
                {liveMangadexId && (
                  <button
                    onClick={updateFromMangadex}
                    disabled={refreshing || !online}
                    aria-label={t("manga.refreshMangadexTitle")}
                    className={`${manga.mal_id > 0 ? "" : "ml-auto"} inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-gold/40 hover:text-gold disabled:opacity-40`}
                    title={
                      online
                        ? t("manga.refreshMangadexTitle")
                        : t("manga.refreshOffline")
                    }
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
                    >
                      <path d="M3 2v6h6" />
                      <path d="M21 12A9 9 0 0 0 6 5.3L3 8" />
                      <path d="M21 22v-6h-6" />
                      <path d="M3 12a9 9 0 0 0 15 6.7l3-2.7" />
                    </svg>
                    MD
                  </button>
                )}
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

              {genres?.length > 0 && (
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
              )}

              <div className="mt-8 rounded-2xl border border-border bg-ink-1/40 p-5 backdrop-blur">
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                      {t("manga.collection")}
                    </p>
                    <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-washi">
                      {volumesLoading ? (
                        <Skeleton.Stat width="6ch" />
                      ) : (
                        <>
                          <span className="text-hanko-gradient">
                            {volumesOwned}
                          </span>
                          <span className="text-washi-dim">
                            {" "}
                            / {totalVolumes || "?"}
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                      {t("manga.progress")}
                    </p>
                    <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-moegi">
                      {volumesLoading ? (
                        <Skeleton.Stat width="4ch" />
                      ) : (
                        `${completion}%`
                      )}
                    </p>
                  </div>
                </div>

                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-washi/15">
                  {!volumesLoading && (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-hanko via-hanko-bright to-moegi transition-all duration-700"
                      style={{ width: `${completion}%` }}
                    />
                  )}
                </div>

                {isEditing && (
                  <div className="mt-4 border-t border-border pt-4">
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

              <div className="mt-4 flex flex-wrap gap-2">
                {!isEditing ? (
                  <>
                    <button
                      onClick={() => setIsEditing(true)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-hanko px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-washi shadow-lg transition hover:bg-hanko-bright active:scale-95 sm:flex-none"
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
            {/* Coffret CTA — washi/cream palette so it reads as "box / paper
                slipcase", distinct from the gold reserved for collector. */}
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
                    {seg.members.map((vol) => (
                      <Volume
                        key={vol.id}
                        id={vol.id}
                        mal_id={vol.mal_id}
                        volNum={vol.vol_num}
                        owned={vol.owned}
                        paid={vol.price}
                        store={vol.store}
                        collector={vol.collector}
                        locked
                        onUpdate={volumeUpdateCallback}
                        currencySetting={currencySetting}
                        coverUrl={volumeCoverMap?.[vol.vol_num]}
                        blurImage={isBlurred}
                      />
                    ))}
                  </CoffretGroup>
                ) : (
                  <div
                    key={`g-${idx}`}
                    className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  >
                    {seg.vols.map((vol) => (
                      <Volume
                        key={vol.id}
                        id={vol.id}
                        mal_id={vol.mal_id}
                        volNum={vol.vol_num}
                        owned={vol.owned}
                        paid={vol.price}
                        store={vol.store}
                        collector={vol.collector}
                        onUpdate={volumeUpdateCallback}
                        currencySetting={currencySetting}
                        coverUrl={volumeCoverMap?.[vol.vol_num]}
                        blurImage={isBlurred}
                      />
                    ))}
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

      <AddCoffretModal
        open={coffretModalOpen}
        onClose={() => setCoffretModalOpen(false)}
        mal_id={manga.mal_id}
        totalVolumes={totalVolumes}
        currencySetting={currencySetting}
      />

      <Modal popupOpen={posterPopUp} handleClose={() => setPosterPopUp(false)}>
        <img
          src={poster}
          alt={name}
          className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        />
      </Modal>

      <CoverPickerModal
        open={coverPickerOpen}
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
