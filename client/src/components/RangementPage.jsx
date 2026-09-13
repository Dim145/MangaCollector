import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import BarcodeScanner from "./BarcodeScanner.jsx";
import { useT } from "@/i18n/index.jsx";
import { useOnline } from "@/hooks/useOnline.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useAllVolumes, useUpdateVolume } from "@/hooks/useVolumes.js";
import { useLocationMutations, useLocations } from "@/hooks/useLocations.js";
import {
  UNFILED,
  groupByLocation,
  listPlaces,
  movePayloads,
  normalizeLocationName,
} from "@/lib/locations.js";
import { findLocalByIsbn } from "@/lib/scanLookup.js";
import { normalizeISBN } from "@/lib/isbn.js";

const KICKER =
  "font-mono text-[10px] uppercase tracking-[0.32em] text-washi-dim";
const BTN =
  "rounded-sm border border-border/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-washi-muted transition hover:border-gold/60 hover:text-washi disabled:cursor-not-allowed disabled:opacity-40";
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
  const { data: registry } = useLocations();
  const { data: volumes } = useAllVolumes();
  const { data: library } = useLibrary();
  const { create, update, remove } = useLocationMutations();
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
      try {
        navigator.vibrate?.(30);
      } catch {
        /* ignore */
      }
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
            {places.map((place, i) => (
              <PlaceRow
                key={place.id ?? `name:${place.name}`}
                place={place}
                active={selected === place.name}
                online={online}
                t={t}
                onOpen={() => open(place.name)}
                onSave={async (patch) => {
                  if (place.id == null) {
                    await create.mutateAsync({
                      name: patch.name ?? place.name,
                      note: patch.note ?? "",
                    });
                  } else {
                    await update.mutateAsync({ id: place.id, ...patch });
                  }
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
                  className="rounded px-1.5 py-1 hover:text-washi disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t("rangement.moveDown")}
                  title={t("rangement.moveDown")}
                  disabled={!online || isLast}
                  onClick={() => onShift(1)}
                  className="rounded px-1.5 py-1 hover:text-washi disabled:opacity-30"
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
              className="rounded px-1.5 py-1 font-jp text-sm hover:text-washi disabled:opacity-30"
            >
              改
            </button>
            <button
              type="button"
              aria-label={t("rangement.delete")}
              title={t("rangement.delete")}
              disabled={!online}
              onClick={() => setMode("confirm")}
              className="rounded px-1.5 py-1 font-jp text-sm hover:text-hanko-bright disabled:opacity-30"
            >
              消
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function PlaceDetail({
  t,
  name,
  isUnfiled,
  group,
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
  onOpenSeries,
}) {
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
          <button type="button" onClick={onInventory} className={BTN}>
            {t("rangement.inventory")}
          </button>
        </div>
      </header>

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
