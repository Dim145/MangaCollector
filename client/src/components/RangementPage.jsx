import { Suspense, lazy, useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BarcodeScanner from "./BarcodeScanner.jsx";
import Skeleton from "./ui/Skeleton.jsx";
import { useT } from "@/i18n/index.jsx";
import { useOnline } from "@/hooks/useOnline.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes, useUpdateVolume } from "@/hooks/useVolumes.js";
import {
  useLocationMutations,
  useLocationPhoto,
  useLocations,
} from "@/hooks/useLocations.js";
import {
  UNFILED,
  groupByLocation,
  listPlaces,
  movePayloads,
  normalizeLocationName,
} from "@/lib/locations.js";
import { findLocalByIsbn } from "@/lib/scanLookup.js";
import { normalizeISBN } from "@/lib/isbn.js";
import { boxLabel, tomeLabels } from "@/lib/labels.js";
import haptics from "@/lib/haptics.js";

// 札 · jsPDF + JsBarcode ride in only when a sheet is asked for.
const LabelSheetModal = lazy(() => import("./LabelSheetModal.jsx"));

const KICKER =
  "font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim";
const BTN =
  "rounded-sm border border-border/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:border-gold/60 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40";
// 写 · Small enough to sit on the photo, opaque enough to be read on
// whatever the shelf happens to look like. Always visible: a control
// that only appears on hover does not exist on a phone.
const PHOTO_CHIP =
  "rounded-sm border border-washi/30 bg-ink-0/80 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-washi backdrop-blur-sm transition pointer-coarse:min-h-11 hover:border-gold/60 disabled:opacity-40";
const BTN_PRIMARY =
  "rounded-sm bg-hanko px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-on-hanko shadow-[0_0_24px_var(--hanko-glow)] transition hover:bg-hanko-deep disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 棚 · Rangement — where things live. Places (shelves, boxes, rooms)
 * with what sits in each, moved by selection or by scanning spines.
 * Reads entirely from the cached rows; moves go through the outbox, so
 * a box can be re-filed in a basement with no signal. Only the registry
 * itself (names, notes, order) needs the server.
 */
export default function RangementPage() {
  const t = useT();
  const navigate = useNavigate();
  const online = useOnline();
  const { data: registry, isInitialLoad: registryLoading } = useLocations();
  const { data: volumes } = useAllVolumes();
  const { data: library } = useLibrary();
  const { create, update, remove } = useLocationMutations();
  const { upload: uploadPhoto, remove: removePhoto } = useLocationPhoto();
  const updateVolume = useUpdateVolume();

  const groups = useMemo(
    () => groupByLocation(volumes ?? [], library ?? []),
    [volumes, library],
  );
  const places = useMemo(
    () => listPlaces(registry ?? [], groups),
    [registry, groups],
  );
  const filedCount = useMemo(
    () => places.reduce((n, p) => n + p.count, 0),
    [places],
  );

  const [selected, setSelected] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [notice, setNotice] = useState(null);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [sheet, setSheet] = useState(null);

  const current =
    selected === UNFILED
      ? groups.unfiled
      : selected
        ? (groups.places.get(selected) ?? {
            name: selected,
            count: 0,
            series: [],
          })
        : null;

  // 写 · The registry row behind the open place — a place that exists
  // only on its tomes has no row, so nothing to hang a photo on.
  const currentPlace =
    selected && selected !== UNFILED
      ? (places.find((p) => p.name === selected) ?? null)
      : null;

  const open = (name) => {
    setSelected(name);
    setPicked(new Set());
    setMoveTarget("");
    setNotice(null);
  };

  const moveIds = useCallback(
    async (ids, target) => {
      const payloads = movePayloads(
        volumes ?? [],
        ids,
        target === UNFILED ? null : target,
      );
      for (const p of payloads) await updateVolume.mutateAsync(p);
      return payloads.length;
    },
    [volumes, updateVolume],
  );

  const onMove = async () => {
    if (!picked.size || !moveTarget) return;
    const n = await moveIds(picked, moveTarget);
    setPicked(new Set());
    setNotice({
      tone: "ok",
      text: t("rangement.moved", {
        n,
        place: moveTarget === UNFILED ? t("rangement.unfiled") : moveTarget,
      }),
    });
  };

  const onAdd = async (e) => {
    e.preventDefault();
    const name = normalizeLocationName(newName);
    if (!name) return;
    await create.mutateAsync({ name, note: newNote.trim() });
    setNewName("");
    setNewNote("");
    open(name);
  };

  // 番 · Scanning into a place: each recognised spine is filed here.
  const busyRef = useRef(false);
  const onDetect = useCallback(
    async (raw) => {
      if (busyRef.current || !selected || selected === UNFILED) return;
      const isbn = normalizeISBN(raw);
      if (!isbn) return;
      busyRef.current = true;
      haptics.bump();
      try {
        const hit = findLocalByIsbn(volumes ?? [], library ?? [], isbn);
        if (!hit) {
          setNotice({
            tone: "warn",
            text: t("rangement.scanUnknown", { isbn }),
          });
          return;
        }
        const tome = `${hit.series?.name ?? ""} #${hit.volume.vol_num}`;
        if (normalizeLocationName(hit.volume.location) === selected) {
          setNotice({ tone: "ok", text: t("rangement.scanAlready", { tome }) });
          return;
        }
        await moveIds([hit.volume.id], selected);
        setScanCount((n) => n + 1);
        setNotice({
          tone: "ok",
          text: t("rangement.scanMoved", { tome, place: selected }),
        });
      } finally {
        setTimeout(() => {
          busyRef.current = false;
        }, 900);
      }
    },
    [selected, volumes, library, moveIds, t],
  );

  const openSeries = (mal_id) => {
    const manga = (library ?? []).find((s) => s.mal_id === mal_id);
    if (manga) navigate("/mangapage", { state: { manga } });
  };

  // 札 · One label per tome (with the place as third line), or one label
  // for the box itself listing what is inside.
  const openTomeLabels = () => {
    if (!current) return;
    const placeName = selected === UNFILED ? "" : selected;
    const labels = current.series.flatMap((s) =>
      tomeLabels({ name: s.name }, s.tomes, {
        tomeWord: t("labels.tomeWord"),
        line3: () => placeName,
      }),
    );
    setSheet({ labels, subtitle: placeName || t("rangement.unfiled") });
  };
  const openBoxLabel = () => {
    if (!current || selected === UNFILED) return;
    const lines = current.series.map((s) => {
      const nums = s.tomes.map((v) => v.vol_num);
      const span =
        nums.length > 1
          ? `${nums[0]}–${nums[nums.length - 1]}`
          : `${nums[0] ?? ""}`;
      return `${s.name} · ${t("labels.tomeWord")}${span} (${nums.length})`;
    });
    setSheet({
      labels: [boxLabel(selected, lines, { moreLabel: t("labels.more") })],
      subtitle: selected,
    });
  };

  const targets = [
    ...places
      .filter((p) => p.name !== selected)
      .map((p) => ({ value: p.name, label: p.name })),
    ...(selected === UNFILED
      ? []
      : [{ value: UNFILED, label: t("rangement.unfiled") }]),
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-32 md:pb-16">
      <header className="mb-8">
        <p className={KICKER}>{t("rangement.kicker")}</p>
        <h1 className="mt-2 font-display text-4xl font-light italic leading-tight text-washi md:text-5xl">
          {t("rangement.title")}
        </h1>
        <p className="mt-3 max-w-xl font-display text-lg font-light italic text-washi-muted">
          {t("rangement.subtitle")}
        </p>
        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim">
          <div>
            <dt className="sr-only">
              {t("rangement.placesCount", { n: places.length })}
            </dt>
            <dd>
              <span className="text-washi tabular-nums">{places.length}</span>{" "}
              {t("rangement.placesWord", { n: places.length })}
            </dd>
          </div>
          <div>
            <dd>
              <span className="text-washi tabular-nums">{filedCount}</span>{" "}
              {t("rangement.filedWord")}
            </dd>
          </div>
          <div>
            <dd>
              <span
                className={
                  groups.unfiled.count
                    ? "text-gold tabular-nums"
                    : "text-washi tabular-nums"
                }
              >
                {groups.unfiled.count}
              </span>{" "}
              {t("rangement.unfiledWord")}
            </dd>
          </div>
        </dl>
        {!online && (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-gold-muted">
            {t("rangement.offline")}
          </p>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* ── the places ─────────────────────────────────────── */}
        <section aria-labelledby="places-heading">
          <h2 id="places-heading" className={KICKER}>
            {t("rangement.listHeading")}
          </h2>
          <ul role="list" className="mt-3 space-y-2">
            <li>
              <button
                type="button"
                onClick={() => open(UNFILED)}
                aria-pressed={selected === UNFILED}
                className={`flex w-full items-baseline justify-between gap-3 rounded-md border px-4 py-3 text-left transition ${
                  selected === UNFILED
                    ? "border-gold/60 bg-ink-2/60"
                    : "border-border/60 bg-ink-1/30 hover:border-border"
                }`}
              >
                <span className="font-display text-base italic text-washi-muted">
                  {t("rangement.unfiled")}
                </span>
                <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.2em] text-washi-dim">
                  {groups.unfiled.count}
                </span>
              </button>
            </li>
            {/* 骨 · Two rows' worth of space until the registry answers.
                The form below used to sit directly under the unfiled
                row and drop 150px when the places arrived. */}
            {registryLoading &&
              [0, 1].map((i) => (
                <li key={`skeleton-${i}`}>
                  <Skeleton className="h-[4.25rem] rounded-md" />
                </li>
              ))}
            {places.map((place, i) => (
              <PlaceRow
                key={place.id ?? `name:${place.name}`}
                place={place}
                active={selected === place.name}
                online={online}
                t={t}
                onOpen={() => open(place.name)}
                onSave={async (patch) => {
                  // A place that lives only on the tomes has no row to
                  // rename: register it under the name the tomes carry
                  // first, then rename that row so they follow.
                  const id =
                    place.id ??
                    (await create.mutateAsync({ name: place.name, note: "" }))
                      .id;
                  await update.mutateAsync({ id, ...patch });
                  if (patch.name && selected === place.name)
                    setSelected(patch.name);
                }}
                onDelete={async () => {
                  if (place.id != null) await remove.mutateAsync(place.id);
                  else
                    await moveIds(
                      (groups.places.get(place.name)?.series ?? []).flatMap(
                        (s) => s.tomes.map((v) => v.id),
                      ),
                      UNFILED,
                    );
                  if (selected === place.name) open(null);
                }}
                onShift={
                  place.id == null
                    ? null
                    : async (dir) => {
                        const other = places[i + dir];
                        if (!other || other.id == null) return;
                        await update.mutateAsync({
                          id: place.id,
                          position: other.position,
                        });
                        await update.mutateAsync({
                          id: other.id,
                          position: place.position,
                        });
                      }
                }
                isFirst={i === 0}
                isLast={i === places.length - 1}
              />
            ))}
          </ul>

          <form
            onSubmit={onAdd}
            className="mt-6 rounded-md border border-dashed border-border/70 p-4"
          >
            <p className={KICKER}>{t("rangement.newPlace")}</p>
            <label className="mt-3 block">
              <span className="sr-only">{t("rangement.newPlaceName")}</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("rangement.newPlaceName")}
                maxLength={80}
                disabled={!online}
                className="w-full rounded-sm border border-border bg-ink-0/60 px-3 py-2 font-display text-base text-washi placeholder:text-washi-dim focus:border-gold/60 focus:outline-none"
              />
            </label>
            <label className="mt-2 block">
              <span className="sr-only">{t("rangement.newPlaceNote")}</span>
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={t("rangement.newPlaceNote")}
                maxLength={500}
                disabled={!online}
                className="w-full rounded-sm border border-border bg-ink-0/60 px-3 py-2 text-sm text-washi placeholder:text-washi-dim focus:border-gold/60 focus:outline-none"
              />
            </label>
            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                disabled={
                  !online || !normalizeLocationName(newName) || create.isPending
                }
                className={BTN_PRIMARY}
              >
                {t("rangement.add")}
              </button>
            </div>
          </form>
        </section>

        {/* ── what sits there ─────────────────────────────────── */}
        <section aria-live="polite" className="min-w-0">
          {!current ? (
            <div className="flex h-full min-h-48 items-center justify-center rounded-md border border-dashed border-border/60 p-8 text-center">
              <p className="font-display text-lg font-light italic text-washi-dim">
                {t("rangement.pickHint")}
              </p>
            </div>
          ) : (
            <PlaceDetail
              t={t}
              name={selected === UNFILED ? t("rangement.unfiled") : selected}
              isUnfiled={selected === UNFILED}
              group={current}
              picked={picked}
              setPicked={setPicked}
              targets={targets}
              moveTarget={moveTarget}
              setMoveTarget={setMoveTarget}
              onMove={onMove}
              moving={updateVolume.isPending}
              notice={notice}
              onScan={() => {
                setScanCount(0);
                setNotice(null);
                setScanOpen(true);
              }}
              photoUrl={currentPlace?.photo_url ?? null}
              canPhoto={Boolean(currentPlace?.id) && online}
              photoBusy={uploadPhoto.isPending || removePhoto.isPending}
              onPhoto={async (file) => {
                if (!currentPlace?.id || !file) return;
                setNotice(null);
                try {
                  await uploadPhoto.mutateAsync({ id: currentPlace.id, file });
                } catch {
                  setNotice({ tone: "warn", text: t("rangement.photoFailed") });
                }
              }}
              onPhotoRemove={async () => {
                if (!currentPlace?.id) return;
                await removePhoto.mutateAsync(currentPlace.id).catch(() => {
                  setNotice({ tone: "warn", text: t("rangement.photoFailed") });
                });
              }}
              onLabels={openTomeLabels}
              onBoxLabel={selected === UNFILED ? null : openBoxLabel}
              onInventory={() =>
                navigate("/inventaire", {
                  state: {
                    scope:
                      selected === UNFILED
                        ? { kind: "all" }
                        : { kind: "place", name: selected },
                  },
                })
              }
              onOpenSeries={openSeries}
            />
          )}
        </section>
      </div>

      {sheet && (
        <Suspense fallback={null}>
          <LabelSheetModal
            open
            onClose={() => setSheet(null)}
            labels={sheet.labels}
            title={t("labels.title")}
            subtitle={sheet.subtitle}
          />
        </Suspense>
      )}
      {scanOpen && selected && selected !== UNFILED && (
        <BarcodeScanner
          onDetect={onDetect}
          onClose={() => setScanOpen(false)}
          statusMessage={
            notice?.text ?? t("rangement.scanning", { place: selected })
          }
          recentCount={scanCount}
        />
      )}
      <p className="sr-only">
        <Link to="/inventaire">{t("rangement.inventory")}</Link>
      </p>
    </div>
  );
}

function PlaceRow({
  place,
  active,
  online,
  t,
  onOpen,
  onSave,
  onDelete,
  onShift,
  isFirst,
  isLast,
}) {
  const [mode, setMode] = useState("view"); // view | edit | confirm
  const [name, setName] = useState(place.name);
  const [note, setNote] = useState(place.note ?? "");
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const clean = normalizeLocationName(name);
    if (!clean) return;
    setBusy(true);
    try {
      const patch = {};
      if (clean !== place.name) patch.name = clean;
      if ((note ?? "").trim() !== (place.note ?? "")) patch.note = note.trim();
      if (Object.keys(patch).length) await onSave(patch);
      setMode("view");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-md border transition ${
        active
          ? "border-gold/60 bg-ink-2/60"
          : "border-border/60 bg-ink-1/30 hover:border-border"
      }`}
    >
      {mode === "edit" ? (
        <form onSubmit={save} className="space-y-2 p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            aria-label={t("rangement.rename")}
            className="w-full rounded-sm border border-border bg-ink-0/60 px-3 py-1.5 font-display text-base text-washi focus:border-gold/60 focus:outline-none"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t("rangement.newPlaceNote")}
            aria-label={t("rangement.note")}
            className="w-full rounded-sm border border-border bg-ink-0/60 px-3 py-1.5 text-sm text-washi placeholder:text-washi-dim focus:border-gold/60 focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("view")}
              className={BTN}
            >
              {t("rangement.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy || !normalizeLocationName(name)}
              className={BTN_PRIMARY}
            >
              {t("rangement.save")}
            </button>
          </div>
        </form>
      ) : mode === "confirm" ? (
        <div className="space-y-3 p-3">
          <p className="font-display text-sm italic text-washi-muted">
            {t("rangement.confirmDelete", { name: place.name })}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("view")}
              className={BTN}
            >
              {t("rangement.no")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                } finally {
                  setBusy(false);
                  setMode("view");
                }
              }}
              className={`${BTN} border-hanko/60 text-hanko-bright hover:border-hanko`}
            >
              {t("rangement.yes")}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2.5">
          <button
            type="button"
            onClick={onOpen}
            aria-pressed={active}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex items-baseline gap-3">
              <span className="truncate font-display text-base italic text-washi">
                {place.name}
              </span>
              <span className="font-mono text-[11px] tabular-nums uppercase tracking-[0.2em] text-washi-dim">
                {place.count}
              </span>
            </span>
            {place.note && (
              <span className="mt-0.5 block truncate text-xs text-washi-dim">
                {place.note}
              </span>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-washi-dim">
            {onShift && (
              <>
                <button
                  type="button"
                  aria-label={t("rangement.moveUp")}
                  title={t("rangement.moveUp")}
                  disabled={!online || isFirst}
                  onClick={() => onShift(-1)}
                  className="grid h-9 min-w-9 place-items-center rounded px-1.5 pointer-coarse:h-11 pointer-coarse:min-w-11 hover:text-washi disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t("rangement.moveDown")}
                  title={t("rangement.moveDown")}
                  disabled={!online || isLast}
                  onClick={() => onShift(1)}
                  className="grid h-9 min-w-9 place-items-center rounded px-1.5 pointer-coarse:h-11 pointer-coarse:min-w-11 hover:text-washi disabled:opacity-30"
                >
                  ↓
                </button>
              </>
            )}
            <button
              type="button"
              aria-label={t("rangement.rename")}
              title={t("rangement.rename")}
              disabled={!online}
              onClick={() => {
                setName(place.name);
                setNote(place.note ?? "");
                setMode("edit");
              }}
              className="grid h-9 min-w-9 place-items-center rounded px-1.5 pointer-coarse:h-11 pointer-coarse:min-w-11 font-jp text-sm hover:text-washi disabled:opacity-30"
            >
              改
            </button>
            <button
              type="button"
              aria-label={t("rangement.delete")}
              title={t("rangement.delete")}
              disabled={!online}
              onClick={() => setMode("confirm")}
              className="grid h-9 min-w-9 place-items-center rounded px-1.5 pointer-coarse:h-11 pointer-coarse:min-w-11 font-jp text-sm hover:text-hanko-bright disabled:opacity-30"
            >
              消
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * 写 · The shelf itself. A place is a name until you have seen it; the
 * photo is what makes "Étagère B" the one behind the door. Shown only
 * once there is one — an empty frame on every place would cost a band
 * of the page to say nothing.
 */
function ShelfPhoto({ t, name, url, busy, onPick, onRemove }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return null;
  return (
    <figure className="relative border-b border-border/60">
      {/* The ratio is on the frame, not the image: the space is held
          before the bytes arrive, so the list below does not jump. The
          cap keeps a wide pane from turning the shelf into a poster
          that pushes the tomes themselves off the screen. */}
      <div className="aspect-[16/7] max-h-72 w-full overflow-hidden bg-ink-0/60">
        <img
          src={url}
          alt={t("rangement.photoAlt", { name })}
          decoding="async"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      </div>
      {(onPick || onRemove) && (
        <figcaption
          /* Under a finger the chips grow to 44 px and, floating, they
             cover the shelf they sit on. On a phone they become a
             caption bar under the photo; from `sm` up they float. */
          className="flex justify-end gap-1.5 border-t border-border/60 bg-ink-1/40 p-2 sm:absolute sm:bottom-2 sm:right-2 sm:border-0 sm:bg-transparent sm:p-0"
        >
          {onPick && (
            <button
              type="button"
              disabled={busy}
              onClick={onPick}
              className={PHOTO_CHIP}
            >
              {t("rangement.photoReplace")}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              disabled={busy}
              onClick={onRemove}
              className={`${PHOTO_CHIP} hover:border-hanko/60 hover:text-hanko-bright`}
            >
              {t("rangement.photoRemove")}
            </button>
          )}
        </figcaption>
      )}
    </figure>
  );
}

function PlaceDetail({
  t,
  name,
  isUnfiled,
  group,
  photoUrl,
  canPhoto,
  photoBusy,
  onPhoto,
  onPhotoRemove,
  picked,
  setPicked,
  targets,
  moveTarget,
  setMoveTarget,
  onMove,
  moving,
  notice,
  onScan,
  onInventory,
  onLabels,
  onBoxLabel,
  onOpenSeries,
}) {
  const photoInput = useRef(null);
  const pickPhoto = () => photoInput.current?.click();
  const allIds = group.series.flatMap((s) => s.tomes.map((v) => v.id));
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleSeries = (s) =>
    setPicked((prev) => {
      const next = new Set(prev);
      const ids = s.tomes.map((v) => v.id);
      const every = ids.every((id) => next.has(id));
      for (const id of ids)
        if (every) next.delete(id);
        else next.add(id);
      return next;
    });

  return (
    <div className="rounded-md border border-border/70 bg-ink-1/30">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-border/60 px-5 py-4">
        <span
          aria-hidden="true"
          className="font-jp text-2xl font-bold leading-none text-washi-dim"
        >
          棚
        </span>
        <h2 className="font-display text-2xl italic text-washi">{name}</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-washi-dim">
          {t("rangement.tomes", { n: group.count })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {!isUnfiled && (
            <button type="button" onClick={onScan} className={BTN}>
              {t("rangement.scanHere")}
            </button>
          )}
          {canPhoto && !photoUrl && (
            <button
              type="button"
              onClick={pickPhoto}
              disabled={photoBusy}
              className={BTN}
            >
              {t("rangement.addPhoto")}
            </button>
          )}
          <button type="button" onClick={onInventory} className={BTN}>
            {t("rangement.inventory")}
          </button>
          {group.count > 0 && (
            <button type="button" onClick={onLabels} className={BTN}>
              {t("rangement.labels")}
            </button>
          )}
          {onBoxLabel && group.count > 0 && (
            <button type="button" onClick={onBoxLabel} className={BTN}>
              {t("rangement.boxLabel")}
            </button>
          )}
        </div>
      </header>

      {canPhoto && (
        /* One input for both the first photo and every replacement.
           `capture` is deliberately absent: it would force the camera
           and take away the gallery, and most shelves are photographed
           once, then chosen again from the roll. */
        <input
          ref={photoInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPhoto(file);
          }}
        />
      )}

      <ShelfPhoto
        // 鍵 · Keyed on the URL: `broken` is per photo, and without a
        // key React keeps the same instance across places — one 404
        // would hide every other shelf's photo, and the "add" button
        // hides whenever a photo exists, so the reader would have
        // neither.
        key={photoUrl ?? "none"}
        t={t}
        name={name}
        url={photoUrl}
        busy={photoBusy}
        onPick={canPhoto ? pickPhoto : null}
        onRemove={canPhoto ? onPhotoRemove : null}
      />

      {notice && (
        <p
          role="status"
          className={`border-b border-border/60 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.16em] ${
            notice.tone === "warn" ? "text-gold-muted" : "text-moegi"
          }`}
        >
          {notice.text}
        </p>
      )}

      {group.series.length === 0 ? (
        <p className="px-5 py-8 text-center font-display text-lg font-light italic text-washi-dim">
          {t("rangement.emptyPlace")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <button
              type="button"
              onClick={() => setPicked(new Set(allIds))}
              className={BTN}
              disabled={picked.size === allIds.length}
            >
              {t("rangement.pickAll")}
            </button>
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className={BTN}
              disabled={picked.size === 0}
            >
              {t("rangement.clearPick")}
            </button>
            {picked.size > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-dim">
                  {t("rangement.moveTo", { n: picked.size })}
                  <select
                    value={moveTarget}
                    onChange={(e) => setMoveTarget(e.target.value)}
                    className="rounded-sm border border-border bg-ink-0/60 px-2 py-1.5 font-display text-sm normal-case tracking-normal text-washi focus:border-gold/60 focus:outline-none"
                  >
                    <option value="">…</option>
                    {targets.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={onMove}
                  disabled={!moveTarget || moving}
                  className={BTN_PRIMARY}
                >
                  {t("rangement.move")}
                </button>
              </div>
            )}
          </div>
          <ul
            role="list"
            className="divide-y divide-border/60 border-t border-border/60"
          >
            {group.series.map((s) => {
              const ids = s.tomes.map((v) => v.id);
              const every = ids.every((id) => picked.has(id));
              return (
                <li key={s.mal_id} className="px-5 py-3">
                  <div className="flex items-baseline gap-3">
                    <button
                      type="button"
                      onClick={() => onOpenSeries(s.mal_id)}
                      className="min-w-0 truncate text-left font-display text-base italic text-washi underline-offset-4 hover:underline"
                      title={t("rangement.openSeries")}
                    >
                      {s.name || `#${s.mal_id}`}
                    </button>
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
                      {t("rangement.tomes", { n: s.tomes.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleSeries(s)}
                      aria-pressed={every}
                      className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-washi-dim hover:text-washi"
                    >
                      {every
                        ? t("rangement.clearPick")
                        : t("rangement.pickAll")}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.tomes.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => toggle(v.id)}
                        aria-pressed={picked.has(v.id)}
                        title={
                          v.loaned_to
                            ? t("rangement.lentTo", { name: v.loaned_to })
                            : undefined
                        }
                        className={`min-w-9 rounded-sm border px-2 py-1 font-mono text-[11px] tabular-nums transition ${
                          picked.has(v.id)
                            ? "border-gold bg-gold/15 text-gold"
                            : "border-border/70 text-washi-muted hover:border-border hover:text-washi"
                        } ${v.loaned_to ? "italic opacity-70" : ""}`}
                      >
                        {v.vol_num}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
