import { useContext, useMemo, useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import DefaultBackground from "./DefaultBackground";
import { useLibrary } from "@/hooks/useLibrary.js";
import {
  useAuthorDetail,
  useDeleteAuthor,
  useDeleteAuthorPhoto,
  useRefreshAuthor,
  useUpdateAuthor,
  useUploadAuthorPhoto,
} from "@/hooks/useAuthorDetail.js";
import { useOnline } from "@/hooks/useOnline.js";
import { hasToBlurImage } from "@/utils/library.js";
import { computeLibraryStats } from "@/utils/libraryStats.js";
import CoverImage from "./ui/CoverImage.jsx";
import Modal from "./ui/Modal.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useT, useLang } from "@/i18n/index.jsx";

/**
 * 作家 Sakka · Author monograph.
 *
 * The page is a catalogue raisonné for a single mangaka: a refined
 * editorial document presenting their body of work in the user's
 * library as a coherent corpus, not just a search-result grid.
 *
 * Composition:
 *   • HERO — author name as a typographic masthead + vertical kanji
 *     watermark + headline stats (series / volumes / completion).
 *   • GENRE SIGNATURE — a horizontal segmented bar showing the top
 *     genres recurring across the author's work, weighted by the
 *     number of series each genre appears in. Becomes the author's
 *     editorial fingerprint.
 *   • PUBLICATIONS — the actual series, rendered as poster cards
 *     (cover + title + ownership ribbon). Slight per-card rotation
 *     alternating ±0.4° so the gallery reads as hand-pinned to a
 *     wall, not a spreadsheet of tiles.
 *
 * Cover sizing fix: the previous revision passed `className="h-28
 * w-20"` to `<CoverImage>` which only sized the WRAPPER span; the
 * inner `<img>` had no constraint and rendered at its natural pixel
 * size. We now pass `imgClassName="h-full w-full object-cover"` so
 * the photo inherits its slot's dimensions instead of blowing the
 * page out.
 */
export default function AuthorPage() {
  const { malId: rawMalId } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const { adult_content_level } = useContext(SettingsContext);
  // 待 · `isInitialLoad` is the cold-start gate: true while Dexie
  // hasn't answered yet AND the network refetch is still in flight.
  // Without it, a hard reload of /author/-1 renders the
  // NotFoundPanel for ~200-800ms before the library populates, which
  // looks like a permanent 404 to the user. We render the
  // skeleton-shaped hero in the meantime so the surface feels alive.
  const { data: library, isInitialLoad } = useLibrary();

  // The route parameter is the author's mal_id — positive for shared
  // MAL rows, negative for custom per-user rows. Coerce to a number
  // up-front; null when the segment isn't an integer.
  const authorMalId = useMemo(() => {
    if (rawMalId == null || rawMalId === "") return null;
    const n = parseInt(rawMalId, 10);
    return Number.isFinite(n) && n !== 0 ? n : null;
  }, [rawMalId]);

  // Filter by the embedded `author.mal_id` on each library row. The
  // FK refactor guarantees that every row with an author credit
  // carries `{ id, mal_id, name }`; rows without a credit have
  // `author = null` and are skipped.
  const matches = useMemo(() => {
    if (authorMalId == null || !library) return [];
    return library
      .filter((m) => m.author?.mal_id === authorMalId)
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
  }, [library, authorMalId]);

  // Author signature gets a 5-genre cap (vs. the default 6 used by
  // CollectionPage). Genres count at the series level — "genres this
  // author touches across their corpus", not "what genre dominates
  // by volume count".
  const stats = useMemo(
    () => computeLibraryStats(matches, { topGenresLimit: 5 }),
    [matches],
  );

  // 作家 · Lazy-fetch the detail row (photo, bio, birthday, MAL
  // link) via React Query. The detail call resolves shared MAL
  // authors via Jikan (cache-aside) and custom authors directly
  // from our authors table.
  const { data: detail, isLoading: detailLoading } = useAuthorDetail(authorMalId);

  // Display name preference: detail (canonical from Jikan or the
  // custom row) → first matched library row's author embed → empty
  // string. The fallback chain matters during cold start when only
  // Dexie has answered.
  const displayName =
    detail?.name ?? matches[0]?.author?.name ?? "";

  // CRUD modal state — drives the edit form + delete confirm. The
  // edit/delete pair only fires for custom authors; shared MAL rows
  // get a refresh button (see below) and are otherwise read-only.
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateMutation = useUpdateAuthor();
  const deleteMutation = useDeleteAuthor();
  const refreshMutation = useRefreshAuthor();
  const uploadPhoto = useUploadAuthorPhoto();
  const deletePhoto = useDeleteAuthorPhoto();

  // 連 · Connectivity gate for the Refresh button. The refresh
  // endpoint synchronously fetches Jikan; without a server it
  // can't do anything useful, and queueing a refresh in the
  // outbox doesn't make sense (the user wants the freshest
  // possible row, not "whenever the network comes back"). We
  // disable the button + surface an explanatory tooltip, mirroring
  // how the rest of the SPA treats network-bound actions.
  const online = useOnline();

  // Capability gate. Determined from the route param so it's
  // available even before the detail call resolves; `detail.is_custom`
  // is the authoritative version once data lands.
  const isCustom = authorMalId != null && authorMalId < 0;

  // Invalid slug → empty state. We show "empty" rather than
  // "not found" because the URL itself is malformed (non-numeric
  // segment) — the user probably hand-edited it.
  if (authorMalId == null) {
    return (
      <DefaultBackground>
        <NotFoundPanel
          title={t("author.empty")}
          backLabel={t("author.backToDashboard")}
        />
      </DefaultBackground>
    );
  }

  return (
    <DefaultBackground>
      <div className="relative mx-auto max-w-5xl px-4 pt-8 pb-nav md:pb-16 sm:px-6 md:pt-12">
        {/* ── Atmosphere ── gold radial top-right (the honour-corner
            for an author page) + hanko radial bottom-left.
            Pointer-events none so they don't interfere with hover. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -top-40 -z-10 h-96 w-96 rounded-full bg-gold/10 blur-3xl"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-24 -bottom-24 -z-10 h-72 w-72 rounded-full bg-hanko/12 blur-3xl"
        />
        <FloatingDust />
        <CornerOrnaments />

        <Hero
          displayName={displayName}
          stats={stats}
          detail={detail}
          detailLoading={detailLoading && Boolean(authorMalId)}
          isCustom={isCustom}
          online={online}
          onEditClick={() => setEditorOpen(true)}
          onDeleteClick={() => setConfirmDelete(true)}
          onRefreshClick={() =>
            authorMalId != null
              ? refreshMutation.mutateAsync(authorMalId)
              : Promise.reject()
          }
          refreshing={refreshMutation.isPending}
          onUploadPhoto={(file) =>
            detail?.mal_id != null
              ? uploadPhoto.mutateAsync({ mal_id: detail.mal_id, file })
              : Promise.reject()
          }
          onDeletePhoto={() =>
            detail?.mal_id != null
              ? deletePhoto.mutateAsync(detail.mal_id)
              : Promise.reject()
          }
          uploadingPhoto={uploadPhoto.isPending || deletePhoto.isPending}
          t={t}
        />

        {isInitialLoad ? (
          <LoadingPanel t={t} />
        ) : matches.length === 0 ? (
          <NotFoundPanel
            title={t("author.notFound", { name: displayName })}
            backLabel={t("author.backToDashboard")}
          />
        ) : (
          <>
            {stats.topGenres.length > 0 && (
              <GenreSignature topGenres={stats.topGenres} total={stats.seriesCount} t={t} />
            )}

            <PublicationsSection
              matches={matches}
              adult_content_level={adult_content_level}
              onOpen={(m) =>
                navigate("/mangapage", { state: { manga: m, adult_content_level } })
              }
              t={t}
            />
          </>
        )}

        <footer className="mt-12 text-center md:mt-16">
          <Link
            to="/dashboard"
            className="group inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-washi-dim transition hover:text-washi"
          >
            <span className="transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            {t("author.backToDashboard")}
          </Link>
        </footer>

        {editorOpen && detail?.is_custom && (
          <AuthorEditorModal
            initialName={detail.name}
            initialAbout={detail.about ?? ""}
            onClose={() => setEditorOpen(false)}
            onSubmit={async ({ name, about }) => {
              await updateMutation.mutateAsync({
                mal_id: detail.mal_id,
                name,
                about,
              });
              setEditorOpen(false);
            }}
            submitting={updateMutation.isPending}
            t={t}
          />
        )}

        {confirmDelete && detail?.is_custom && (
          <DeleteConfirmModal
            authorName={detail.name}
            onClose={() => setConfirmDelete(false)}
            onConfirm={async () => {
              await deleteMutation.mutateAsync(detail.mal_id);
              setConfirmDelete(false);
              navigate("/dashboard");
            }}
            submitting={deleteMutation.isPending}
            t={t}
          />
        )}
      </div>
    </DefaultBackground>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({
  displayName,
  stats,
  detail,
  detailLoading,
  isCustom,
  online,
  onEditClick,
  onDeleteClick,
  onRefreshClick,
  refreshing,
  onUploadPhoto,
  onDeletePhoto,
  uploadingPhoto,
  t,
}) {
  // Prefer MAL's canonical name when we have a detail row — it's
  // the authoritative spelling. Fall back to whatever string the
  // user has on their library row.
  const heroName = detail?.name ?? displayName;
  const photoUrl = detail?.image_url ?? null;
  return (
    <header className="relative mb-12 animate-fade-up md:mb-16">
      {/* Top kicker rule with vertical 作家 hanging off the right end —
          the editorial signature row. Action chips (MAL link, plus
          Edit/Delete for custom rows OR Refresh for shared MAL rows)
          ride on this rule when the page has them. */}
      <div className="mb-6 flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-hanko">
          {t("author.kicker")}
        </span>
        <span className="font-jp text-[11px] tracking-[0.4em] text-hanko/80">
          作家
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent" />
        {detail?.mal_url && <MalChip url={detail.mal_url} t={t} />}
        {/* Shared MAL author (positive mal_id) — refresh-only.
            Bypasses the 7-day Jikan staleness gate so the user sees
            the latest photo / bio / favorites count on demand.
            No edit/delete: the row is upstream-owned and shared
            across all users in this instance.
            ── Online gate ──
            The refresh endpoint synchronously talks to Jikan. With
            no server reachable there's nothing to do, so we
            disable the button and swap the kanji to the offline
            disconnect glyph 圏. Tooltip + aria-label both surface
            the reason via the dedicated `refreshOfflineHint` key. */}
        {!isCustom && (
          <button
            type="button"
            onClick={onRefreshClick}
            disabled={refreshing || !online}
            title={!online ? t("author.refreshOfflineHint") : undefined}
            aria-label={
              !online ? t("author.refreshOfflineHint") : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-gold/8 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-gold transition hover:border-gold/80 hover:bg-gold/15 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span aria-hidden="true" className="font-jp text-[10px] not-italic">
              {refreshing ? "…" : !online ? "圏" : "更"}
            </span>
            {refreshing
              ? t("common.saving")
              : !online
                ? t("author.refreshOffline")
                : t("author.refreshAction")}
          </button>
        )}
        {/* Custom author (negative mal_id) — full edit + delete.
            The user owns the row in their per-user namespace. */}
        {isCustom && (
          <>
            <button
              type="button"
              onClick={onEditClick}
              className="inline-flex items-center gap-1.5 rounded-full border border-hanko/40 bg-hanko/5 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/10"
            >
              <span aria-hidden="true" className="font-jp text-[10px] not-italic">
                編
              </span>
              {t("author.editAction")}
            </button>
            <button
              type="button"
              onClick={onDeleteClick}
              className="inline-flex items-center gap-1.5 rounded-full border border-hanko/40 bg-transparent px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-hanko-bright transition hover:border-hanko/70 hover:bg-hanko/10"
            >
              <span aria-hidden="true" className="font-jp text-[10px] not-italic">
                消
              </span>
              {t("author.deleteAction")}
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start md:gap-10">
        {/* LEFT — portrait. Renders a placeholder seal when no photo
            is available (custom author override or MAL row without
            an image_url). The frame is a hanko-stamped circle to
            keep the editorial feel even when the photo is missing.

            Custom authors get an upload affordance — clicking the
            portrait opens a file picker; an inline trash chip in
            the corner clears the existing photo. */}
        <Portrait
          photoUrl={photoUrl}
          fallbackInitial={heroName.trim().charAt(0)}
          loading={detailLoading}
          editable={isCustom}
          uploading={uploadingPhoto}
          onUpload={onUploadPhoto}
          onClear={onDeletePhoto}
          t={t}
        />

        {/* RIGHT — name + brushstroke + bio + stats triad */}
        <div className="min-w-0">
          <h1 className="font-display text-5xl font-light italic leading-[0.95] tracking-tight text-washi md:text-6xl lg:text-7xl">
            <span className="text-hanko-gradient font-semibold not-italic">
              {heroName}
            </span>
          </h1>

          {/* MAL secondary identity row — shows family/given when MAL
              ships them, plus birthday + favorites. Quiet, mono caps. */}
          {(detail?.given_name || detail?.family_name || detail?.birthday) && (
            <SecondaryIdentity detail={detail} t={t} />
          )}

          <Brushstroke className="mt-6 mb-6" />

          {/* About paragraph — collapsed by default to 4 lines so the
              hero stays a single screen on desktop. Click to expand. */}
          {detail?.about && <AboutBlock about={detail.about} t={t} />}

          {/* Headline stats — three numbers laid out as an editorial
              triad. Each pair is "value · label" stacked vertically so
              the values line up regardless of label length. */}
          <dl className="mt-6 grid grid-cols-3 gap-4 sm:gap-8">
            <HeadlineStat
              value={stats.seriesCount}
              label={
                stats.seriesCount === 1
                  ? t("author.singleSeries")
                  : t("author.multipleSeriesShort")
              }
              kanji="本"
            />
            <HeadlineStat
              value={stats.totalVolumes}
              label={t("author.volumesUnit")}
              kanji="冊"
            />
            <HeadlineStat
              value={`${stats.completionPct}%`}
              label={t("author.completionLabel")}
              kanji="完"
            />
          </dl>
        </div>
      </div>
    </header>
  );
}

// ─── Portrait ──────────────────────────────────────────────────────

function Portrait({
  photoUrl,
  fallbackInitial,
  loading,
  editable = false,
  uploading = false,
  onUpload,
  onClear,
  t,
}) {
  const fileRef = useRef(null);
  return (
    <div className="relative shrink-0">
      {/* Hanko-style frame: a circle with a thin gold border and a
          drop-shadow. The portrait sits inside on a tinted backdrop
          so empty photo slots still feel intentional rather than
          broken. Slight rotation -2° matches the chapter-stamp
          vocabulary used elsewhere in the app.

          When editable, the frame becomes a button that opens a
          file picker. The "click to upload" affordance is a hover
          overlay rather than a always-on chip — keeps the rest
          state clean while telegraphing the interaction. */}
      <button
        type="button"
        onClick={() => editable && fileRef.current?.click()}
        disabled={!editable || uploading}
        className={`group/portrait relative h-32 w-32 overflow-hidden rounded-full border-2 border-gold/50 bg-gradient-to-br from-ink-2 to-ink-3 shadow-[0_8px_24px_-8px_rgba(201,169,97,0.4)] sm:h-40 sm:w-40 md:h-48 md:w-48 ${
          editable ? "cursor-pointer transition hover:border-gold" : "cursor-default"
        }`}
        style={{ transform: "rotate(-2deg)" }}
        aria-label={editable ? t("author.uploadPhotoAria") : undefined}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-full w-full object-cover transition-opacity duration-300"
          />
        ) : loading || uploading ? (
          <span className="absolute inset-0 animate-pulse bg-ink-2/40" />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-display text-7xl italic text-hanko/40">
            {fallbackInitial || "?"}
          </div>
        )}

        {/* Inner ring decoration — adds depth and reinforces the
            hanko "pressed seal" aesthetic. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-full ring-1 ring-inset ring-washi/10"
        />

        {/* Hover overlay for editable portraits — a darkening with
            a "change photo" hint. Keeps the rest state clean. */}
        {editable && !uploading && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid place-items-center bg-ink-0/0 font-mono text-[10px] uppercase tracking-[0.22em] text-washi opacity-0 transition group-hover/portrait:bg-ink-0/55 group-hover/portrait:opacity-100"
          >
            <span className="rounded-full border border-gold/60 bg-ink-1/80 px-3 py-1 backdrop-blur">
              {photoUrl ? t("author.replacePhoto") : t("author.uploadPhoto")}
            </span>
          </span>
        )}
      </button>

      {/* Bottom-right corner kanji 作 — rotated, faint, integrated
          into the portrait silhouette. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-2 -right-2 grid h-9 w-9 place-items-center rounded-full border border-hanko/40 bg-ink-1/95 font-jp text-sm font-bold text-hanko-bright shadow-md sm:h-11 sm:w-11"
        style={{ transform: "rotate(-6deg)" }}
      >
        作
      </span>

      {/* Clear-photo chip — only when there's a photo to clear AND
          the user owns the row. Top-left so it doesn't compete with
          the 作 corner stamp. */}
      {editable && photoUrl && (
        <button
          type="button"
          onClick={onClear}
          disabled={uploading}
          className="absolute -top-1 -left-1 grid h-7 w-7 place-items-center rounded-full border border-hanko/50 bg-ink-1/95 font-mono text-[9px] uppercase tracking-[0.18em] text-hanko-bright shadow-md transition hover:bg-hanko/15 disabled:opacity-50"
          aria-label={t("author.clearPhotoAria")}
        >
          ×
        </button>
      )}

      {editable && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && onUpload) onUpload(file);
          }}
        />
      )}
    </div>
  );
}

// ─── Editor modal (create + edit) ──────────────────────────────────

function AuthorEditorModal({
  initialName,
  initialAbout,
  onClose,
  onSubmit,
  submitting,
  t,
}) {
  const [name, setName] = useState(initialName ?? "");
  const [about, setAbout] = useState(initialAbout ?? "");
  return (
    <Modal popupOpen={true} handleClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSubmit({ name: name.trim(), about: about.trim() });
        }}
        className="w-full max-w-lg rounded-2xl border border-border bg-ink-1 p-6 shadow-2xl"
      >
        <header className="mb-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-hanko">
            {t("author.editorKickerEdit")}
            {" · "}
            <span className="font-jp text-[11px]">編集</span>
          </p>
          <h2 className="mt-2 font-display text-xl font-light italic text-washi">
            {t("author.editorTitleEdit")}
          </h2>
        </header>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
              {t("author.editorNameLabel")}
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              autoFocus
              required
              className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
              {t("author.editorAboutLabel")}
            </span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={4000}
              rows={5}
              className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-sans text-sm leading-relaxed text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
            />
          </label>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright disabled:opacity-60"
          >
            {submitting ? t("common.saving") : t("author.editorSubmitEdit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Delete confirmation ───────────────────────────────────────────

function DeleteConfirmModal({
  authorName,
  onClose,
  onConfirm,
  submitting,
  t,
}) {
  return (
    <Modal popupOpen={true} handleClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-hanko/40 bg-ink-1 p-6 shadow-2xl">
        <div className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm">
          消
        </div>
        <h3 className="text-center font-display text-xl font-semibold text-washi">
          {t("author.deleteConfirmTitle")}
        </h3>
        <p className="mt-3 text-center text-sm text-washi-muted">
          {t("author.deleteConfirmBodyCustom", { name: authorName })}
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-washi transition hover:bg-hanko-bright disabled:opacity-60"
          >
            {submitting
              ? t("common.saving")
              : t("author.deleteConfirmAction")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Secondary identity (family/given + birthday + favorites) ──────

function SecondaryIdentity({ detail, t }) {
  const lang = useLang();
  const family = detail?.family_name?.trim();
  const given = detail?.given_name?.trim();
  const birthday = detail?.birthday;
  const favorites = detail?.favorites ?? 0;
  const formattedBirthday = useMemo(() => {
    if (!birthday) return null;
    try {
      return new Date(birthday).toLocaleDateString(lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return null;
    }
  }, [birthday, lang]);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
      {family && given && (
        <span>
          <span className="font-jp text-[11px] text-hanko/80">姓</span>{" "}
          <span className="not-italic text-washi-muted">
            {family} {given}
          </span>
        </span>
      )}
      {formattedBirthday && (
        <span>
          <span className="font-jp text-[11px] text-hanko/80">誕</span>{" "}
          <span className="text-washi-muted">{formattedBirthday}</span>
        </span>
      )}
      {favorites > 0 && (
        <span>
          <span className="font-jp text-[11px] text-hanko/80">愛</span>{" "}
          <span className="tabular-nums text-washi-muted">
            {favorites.toLocaleString()}
          </span>{" "}
          <span className="text-washi-dim">{t("author.favoritesShort")}</span>
        </span>
      )}
    </div>
  );
}

// ─── About block ───────────────────────────────────────────────────

function AboutBlock({ about, t }) {
  const [expanded, setExpanded] = useState(false);
  // MAL bios are sometimes 2-paragraph teasers, sometimes wikipedia-
  // length essays. Default-collapsed at line-clamp 4 keeps the hero
  // tight; the user can opt into the full bio.
  const trimmed = about.trim();
  const isLong = trimmed.length > 400;
  return (
    <div className="mb-2">
      <p
        className={`whitespace-pre-line font-sans text-sm leading-relaxed text-washi-muted ${
          expanded || !isLong ? "" : "line-clamp-4"
        }`}
      >
        {trimmed}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-hanko-bright transition hover:text-hanko"
        >
          {expanded ? t("author.aboutCollapse") : t("author.aboutExpand")}
          <span aria-hidden="true">{expanded ? "↑" : "↓"}</span>
        </button>
      )}
    </div>
  );
}

// ─── MAL chip ──────────────────────────────────────────────────────

function MalChip({ url, t }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gold/40 bg-gold/5 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-gold transition hover:border-gold/70 hover:bg-gold/10 hover:text-gold-muted"
    >
      <span aria-hidden="true" className="font-jp text-[10px] not-italic">
        印
      </span>
      {t("author.malLink")}
      <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
        ↗
      </span>
    </a>
  );
}

function HeadlineStat({ value, label, kanji }) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-3 -left-1 font-jp text-3xl font-bold leading-none text-hanko/15 sm:text-4xl"
      >
        {kanji}
      </span>
      <dt className="relative font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {label}
      </dt>
      <dd className="relative mt-1 font-display text-3xl font-semibold italic leading-none text-washi tabular-nums sm:text-4xl">
        {value}
      </dd>
    </div>
  );
}

// ─── Genre signature ───────────────────────────────────────────────

function GenreSignature({ topGenres, total, t }) {
  // Compute each genre's share as a fraction of the SUM of top counts.
  // We normalise across what's displayed so the bar always fills to
  // 100% — readable visual weight per genre rather than per-author
  // absolute frequency.
  const sum = topGenres.reduce((acc, g) => acc + g.count, 0);
  const palette = [
    "var(--hanko-bright)",
    "var(--gold)",
    "var(--moegi)",
    "var(--sakura)",
    "var(--ai)",
  ];
  return (
    <section
      aria-label={t("author.genreSignatureAria")}
      className="mb-12 animate-fade-up md:mb-16"
      style={{ animationDelay: "120ms" }}
    >
      <header className="mb-3 flex items-baseline gap-3">
        <span
          aria-hidden="true"
          className="font-jp text-base font-bold leading-none text-hanko-bright"
        >
          題材
        </span>
        <h2 className="font-display text-base font-semibold italic text-washi md:text-lg">
          {t("author.genreSignatureTitle")}
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
          · {t("author.genreSignatureHint", { n: total })}
        </span>
      </header>

      {/* The bar — flex of segments. Each segment width is the genre
          share. On hover the segment lifts/brightens. */}
      <div className="overflow-hidden rounded-full border border-border/60 bg-ink-2/30">
        <div className="flex h-3">
          {topGenres.map((g, i) => (
            <span
              key={g.name}
              role="presentation"
              title={`${g.name} · ${g.count}`}
              className="genre-segment relative h-full transition-all"
              style={{
                flexBasis: `${(g.count / sum) * 100}%`,
                background: palette[i % palette.length],
                opacity: 0.85,
              }}
            />
          ))}
        </div>
      </div>

      {/* Legend — wrap of pills, each labelled with the genre name
          and count. Colour swatch matches the segment in the bar. */}
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {topGenres.map((g, i) => (
          <li
            key={g.name}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-washi-muted"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ background: palette[i % palette.length] }}
            />
            <span>{g.name}</span>
            <span className="text-washi-dim">·</span>
            <span className="tabular-nums text-washi-dim">{g.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Publications section ──────────────────────────────────────────

function PublicationsSection({ matches, adult_content_level, onOpen, t }) {
  return (
    <section className="mb-8">
      <header className="mb-6 flex items-baseline gap-3 md:mb-8">
        <span
          aria-hidden="true"
          className="font-jp text-2xl font-bold leading-none text-hanko-bright"
        >
          著作
        </span>
        <h2 className="font-display text-xl font-semibold italic text-washi md:text-2xl">
          {t("author.publicationsTitle")}
        </h2>
        <span
          aria-hidden="true"
          className="h-px flex-1 bg-gradient-to-r from-hanko/40 via-border to-transparent"
        />
        <span className="font-jp text-[10px] tracking-[0.4em] text-washi-dim">
          著作一覧
        </span>
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {matches.map((m, i) => (
          <li
            key={m.mal_id ?? m.id}
            className="animate-fade-up"
            style={{ animationDelay: `${200 + i * 70}ms` }}
          >
            <PosterCard
              manga={m}
              index={i}
              adult_content_level={adult_content_level}
              onOpen={() => onOpen(m)}
              t={t}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PosterCard({ manga, index, adult_content_level, onOpen, t }) {
  // Resting tilt alternates per index so the gallery reads as hand-
  // pinned to a corkboard. Hover flattens to 0° and lifts.
  const restTilt = index % 2 === 0 ? "-0.4deg" : "0.4deg";
  const total = manga.volumes ?? 0;
  const owned = manga.volumes_owned ?? 0;
  const pct = total > 0 ? Math.round((owned / total) * 100) : 0;
  const blurred = hasToBlurImage(manga, adult_content_level);
  const isComplete = total > 0 && owned >= total;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="poster-card group relative block w-full overflow-hidden rounded-xl border border-border/80 bg-ink-1/40 text-left shadow-[0_10px_28px_-14px_rgba(0,0,0,0.7)] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-gold/40 hover:shadow-[0_18px_36px_-14px_rgba(201,169,97,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
      style={{
        transform: `rotate(${restTilt})`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "rotate(0deg) translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = `rotate(${restTilt})`;
      }}
      onFocus={(e) => {
        e.currentTarget.style.transform = "rotate(0deg) translateY(-3px)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.transform = `rotate(${restTilt})`;
      }}
      aria-label={t("author.openSeriesAria", { name: manga.name })}
    >
      {/* Cover — strict 2:3 aspect-ratio wrapper so the inner img
          can't blow out. `imgClassName` constrains the actual photo
          so it fills the slot without overflowing. */}
      <div className="relative aspect-[2/3] w-full overflow-hidden">
        {manga.image_url_jpg ? (
          <CoverImage
            src={manga.image_url_jpg}
            alt=""
            blur={blurred}
            paletteSeed={manga.mal_id}
            imgClassName="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-2 to-ink-3 font-display text-5xl italic text-hanko/30">
            巻
          </div>
        )}

        {/* Top-right corner — completion ribbon. Visible only when
            fully owned, otherwise the small progress fill at the
            bottom carries the signal. */}
        {isComplete && (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 grid h-9 w-9 place-items-center bg-gradient-to-br from-gold to-gold-muted font-jp text-sm font-bold text-ink-0 shadow-md"
            style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%)" }}
          >
            <span className="absolute right-0.5 top-0.5">完</span>
          </span>
        )}

        {/* Bottom gradient that bleeds the cover into the metadata
            strip below — softens the hard line between photograph
            and label. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-ink-1/90 to-transparent"
        />

        {/* Progress meter — sits across the bottom of the cover, fades
            in/out via the bottom gradient. Width drives the eye to
            "how much of this is yours" without a numeric label. */}
        {total > 0 && (
          <div
            aria-hidden="true"
            className="absolute inset-x-2 bottom-2 h-0.5 overflow-hidden rounded-full bg-ink-0/60"
          >
            <span
              className="block h-full bg-gradient-to-r from-hanko-deep via-hanko to-hanko-bright transition-[width]"
              style={{
                width: `${pct}%`,
                boxShadow: pct > 0 ? "0 0 6px var(--hanko-glow)" : "none",
              }}
            />
          </div>
        )}
      </div>

      {/* Metadata strip — title + numeric ratio + optional publisher */}
      <div className="px-3 pt-3 pb-3.5">
        <h3 className="line-clamp-2 font-display text-sm font-semibold italic leading-tight text-washi">
          {manga.name}
        </h3>
        <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          <span className="text-washi-dim">
            {owned}/{total || "—"} {t("author.volumesUnit")}
          </span>
          <span
            className={
              isComplete ? "text-gold" : pct > 50 ? "text-hanko-bright" : "text-washi-dim"
            }
          >
            {pct}%
          </span>
        </div>
        {manga.publisher && (
          <p className="mt-1 truncate font-display text-[11px] italic text-washi-muted">
            {manga.publisher}
          </p>
        )}
      </div>
    </button>
  );
}

// ─── Loading panel ─────────────────────────────────────────────────

/**
 * Cold-start placeholder. The cover positions are pre-counted so the
 * grid doesn't reflow once data lands. Skeleton tiles share the
 * `aspect-[2/3]` ratio of the real poster cards so the swap is
 * visually invisible — no layout shift.
 */
function LoadingPanel({ t }) {
  return (
    <section className="mb-8 animate-fade-up" aria-label={t("common.loading")}>
      <div className="mb-6 flex items-baseline gap-3 md:mb-8">
        <span aria-hidden="true" className="font-jp text-2xl font-bold leading-none text-hanko-bright/60">
          著作
        </span>
        <span className="h-4 w-32 rounded bg-ink-2/60" />
        <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-hanko/20 via-border to-transparent" />
      </div>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <li
            key={i}
            className="overflow-hidden rounded-xl border border-border/60 bg-ink-1/40 animate-fade-up"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {/* Pulsing skeleton cover slot — same aspect ratio as the
                real PosterCard cover so the layout doesn't jump when
                the data lands. */}
            <div className="relative aspect-[2/3] w-full overflow-hidden bg-gradient-to-br from-ink-2 to-ink-3">
              <span className="absolute inset-0 animate-pulse bg-ink-2/40" />
            </div>
            <div className="space-y-2 px-3 pt-3 pb-3.5">
              <span className="block h-3.5 w-3/4 rounded bg-ink-2/60" />
              <span className="block h-2.5 w-1/2 rounded bg-ink-2/40" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Not-found panel ───────────────────────────────────────────────

function NotFoundPanel({ title, backLabel }) {
  return (
    <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-ink-1/40 p-12 text-center backdrop-blur md:p-16 animate-fade-up">
      <p
        aria-hidden="true"
        className="tour-stamp-press-target font-jp text-7xl font-bold leading-none text-washi-dim md:text-9xl"
      >
        無
      </p>
      <h1 className="mt-6 font-display text-xl font-light italic leading-tight text-washi md:text-2xl">
        {title}
      </h1>
      <Link
        to="/dashboard"
        className="mt-6 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-hanko transition hover:text-hanko-bright"
      >
        ← {backLabel}
      </Link>
    </div>
  );
}

// ─── Brushstroke divider ───────────────────────────────────────────

function Brushstroke({ className = "" }) {
  return (
    <svg
      viewBox="0 0 1200 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`h-1.5 w-full max-w-md ${className}`}
    >
      <defs>
        <linearGradient id="author-brush-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--gold)" stopOpacity="0" />
          <stop offset="14%" stopColor="var(--gold)" stopOpacity="0.7" />
          <stop offset="50%" stopColor="var(--hanko-bright)" stopOpacity="1" />
          <stop offset="86%" stopColor="var(--hanko)" stopOpacity="0.7" />
          <stop offset="100%" stopColor="var(--hanko)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M2,4 Q200,1 400,4 T800,5 T1198,3"
        stroke="url(#author-brush-grad)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

// ─── Floating particles ────────────────────────────────────────────

const PARTICLES = [
  { x: 12, y: 16, size: 1.5, delay: 0, dur: 16 },
  { x: 28, y: 70, size: 2, delay: 2, dur: 14 },
  { x: 44, y: 32, size: 1, delay: 4, dur: 18 },
  { x: 58, y: 86, size: 2, delay: 1, dur: 13 },
  { x: 72, y: 22, size: 1.5, delay: 5, dur: 15 },
  { x: 88, y: 60, size: 1, delay: 3, dur: 12 },
];

function FloatingDust() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="tour-particle absolute rounded-full bg-gold/35"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Corner ornaments ──────────────────────────────────────────────

function CornerOrnaments() {
  // Two diagonal kanji 作 / 家 in opposite corners — quiet
  // ornamentation that strengthens the "monograph cover page" feel
  // without competing with the masthead. Always hidden on small
  // screens (avoid crowding the hero).
  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-2 right-3 hidden -z-10 font-jp text-9xl font-bold leading-none text-hanko/[0.04] md:block"
        style={{ transform: "rotate(8deg)" }}
      >
        作
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-6 left-2 hidden -z-10 font-jp text-9xl font-bold leading-none text-gold/[0.05] md:block"
        style={{ transform: "rotate(-8deg)" }}
      >
        家
      </span>
    </>
  );
}
