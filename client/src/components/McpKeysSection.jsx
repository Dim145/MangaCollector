import { useMemo, useState } from "react";
import Modal from "./ui/Modal.jsx";
import { useMcpAudit, useMcpKeys } from "@/hooks/useMcpKeys.js";
import { useT } from "@/i18n/index.jsx";

/**
 * Settings section — 鍵 API access (MCP).
 *
 * Mint, list and revoke the per-user keys that open `/mcp`, the Model
 * Context Protocol endpoint an AI client connects to.
 *
 * Two things drive the shape of this panel:
 *
 * ① **The secret exists once.** The server stores a digest and cannot
 *    show it again. So the reveal dialog is a hard stop — it carries the
 *    key, the ready-made `claude mcp add` command, and a warning — and
 *    the value lives in component state that goes when the dialog does.
 *    It is never written to the query cache (see `useMcpKeys`).
 *
 * ② **A key is a grant, not a login.** The mint dialog opens on the
 *    read-only preset and makes widening an explicit act, because the
 *    failure mode people regret is a key that could write when it only
 *    ever needed to read.
 */
export default function McpKeysSection() {
  const t = useT();
  const {
    keys,
    isLoading,
    enabled,
    allScopes,
    readOnlyScopes,
    catalogueReady,
    mint,
    isMinting,
    revoke,
    isRevoking,
  } = useMcpKeys();

  const [mintOpen, setMintOpen] = useState(false);
  const [minted, setMinted] = useState(null);
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <section
      className="rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur animate-fade-up"
      style={{ animationDelay: "300ms" }}
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-5 w-5 place-items-center rounded-full bg-gold/15 font-jp text-[10px] font-bold text-gold"
        >
          鍵
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-washi">
            {t("settings.mcpTitle")}
          </h2>
          <p className="mt-1 text-xs text-washi-muted">{t("settings.mcpBody")}</p>
        </div>
      </div>

      {catalogueReady && !enabled && (
        <p className="mb-4 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-gold">
          {t("settings.mcpDisabled")}
        </p>
      )}

      {isLoading ? (
        <p className="text-xs text-washi-muted">{t("settings.mcpLoading")}</p>
      ) : keys.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-ink-0/30 px-4 py-6 text-center text-xs text-washi-muted">
          {t("settings.mcpEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {keys.map((key) => (
            <KeyRow
              key={key.id}
              entry={key}
              busy={isRevoking}
              onRevoke={() => revoke(key.id)}
              t={t}
            />
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setMintOpen(true)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gold transition hover:bg-gold/20 active:scale-95 disabled:opacity-40"
        >
          {t("settings.mcpNewKey")}
        </button>
        <button
          type="button"
          onClick={() => setAuditOpen((v) => !v)}
          aria-expanded={auditOpen}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-ink-2/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:border-gold/40 hover:text-washi active:scale-95"
        >
          {t("settings.mcpAuditToggle")}
        </button>
      </div>

      {auditOpen && <AuditList t={t} />}

      <MintDialog
        open={mintOpen}
        onClose={() => setMintOpen(false)}
        allScopes={allScopes}
        readOnlyScopes={readOnlyScopes}
        busy={isMinting}
        onMint={async (payload) => {
          const result = await mint(payload);
          setMintOpen(false);
          setMinted(result);
        }}
        t={t}
      />

      <RevealDialog minted={minted} onClose={() => setMinted(null)} t={t} />
    </section>
  );
}

/** One stored key. Shows what it can do and when it last did it. */
function KeyRow({ entry, busy, onRevoke, t }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-ink-0/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-washi">
            {entry.label}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-washi-muted">
            {entry.prefix}…
          </p>
        </div>
        {entry.expired && (
          <span className="rounded-full border border-hanko/40 bg-hanko/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-hanko-bright">
            {t("settings.mcpExpired")}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {entry.scopes.map((scope) => (
          <span
            key={scope}
            className="rounded border border-border bg-ink-2/60 px-1.5 py-0.5 font-mono text-[10px] text-washi-muted"
          >
            {scope}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-washi-muted">
        {entry.last_used_at
          ? t("settings.mcpLastUsed", {
              when: new Date(entry.last_used_at).toLocaleString(),
            })
          : t("settings.mcpNeverUsed")}
      </p>

      {confirming ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onRevoke}
            className="flex-1 rounded-lg border border-hanko/40 bg-hanko/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 active:scale-95 disabled:opacity-40"
          >
            {t("settings.mcpRevokeConfirm")}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex-1 rounded-lg border border-border bg-ink-2/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi active:scale-95"
          >
            {t("settings.mcpCancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 w-full rounded-lg border border-border bg-ink-2/30 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-washi-muted transition hover:border-hanko/40 hover:text-washi active:scale-95"
        >
          {t("settings.mcpRevoke")}
        </button>
      )}
    </li>
  );
}

/**
 * Mint dialog. Opens on the read-only preset — see the section header
 * for why the default matters more than the choice.
 */
function MintDialog({ open, onClose, allScopes, readOnlyScopes, busy, onMint, t }) {
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  // The preset is the initial value, not a permanent floor: once the
  // user has touched a checkbox, `selected` holds their choice.
  const scopes = selected ?? readOnlyScopes;

  const grouped = useMemo(() => {
    const out = new Map();
    for (const scope of allScopes) {
      const [area] = scope.split(":");
      if (!out.has(area)) out.set(area, []);
      out.get(area).push(scope);
    }
    return [...out.entries()];
  }, [allScopes]);

  const toggle = (scope) =>
    setSelected(
      scopes.includes(scope)
        ? scopes.filter((s) => s !== scope)
        : [...scopes, scope],
    );

  const submit = async () => {
    setError(null);
    try {
      await onMint({ label: label.trim(), scopes });
      setLabel("");
      setSelected(null);
    } catch (e) {
      setError(e?.response?.data?.error ?? t("settings.mcpMintFailed"));
    }
  };

  return (
    <Modal popupOpen={open} handleClose={onClose} additionalClasses="max-w-lg">
      <h3 className="font-display text-lg font-semibold text-washi">
        {t("settings.mcpNewKey")}
      </h3>

      <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wider text-washi-muted">
        {t("settings.mcpLabel")}
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          placeholder={t("settings.mcpLabelPlaceholder")}
          className="mt-1 w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 text-sm font-normal normal-case tracking-normal text-washi outline-none focus:border-gold/50"
        />
      </label>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-washi-muted">
            {t("settings.mcpScopes")}
          </p>
          <button
            type="button"
            onClick={() => setSelected(readOnlyScopes)}
            className="text-[11px] text-gold underline-offset-2 hover:underline"
          >
            {t("settings.mcpPresetReadOnly")}
          </button>
        </div>
        <div className="mt-2 space-y-3">
          {grouped.map(([area, list]) => (
            <div key={area}>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-muted">
                {area}
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {list.map((scope) => {
                  const on = scopes.includes(scope);
                  return (
                    <label
                      key={scope}
                      className={`cursor-pointer rounded border px-2 py-1 font-mono text-[11px] transition ${
                        on
                          ? "border-gold/50 bg-gold/10 text-gold"
                          : "border-border bg-ink-2/40 text-washi-muted hover:text-washi"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => toggle(scope)}
                      />
                      {scope}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-hanko/40 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          disabled={busy || !label.trim() || scopes.length === 0}
          onClick={submit}
          className="flex-1 rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gold transition hover:bg-gold/20 active:scale-95 disabled:opacity-40"
        >
          {t("settings.mcpMint")}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-border bg-ink-2/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-washi-muted transition hover:text-washi active:scale-95"
        >
          {t("settings.mcpCancel")}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The one and only sight of the secret.
 *
 * Carries the ready-made `claude mcp add` line because the alternative
 * — the user assembling a header by hand from three places — is how a
 * key ends up pasted into a file that gets committed.
 */
function RevealDialog({ minted, onClose, t }) {
  const secret = minted?.secret;
  const command = secret
    ? `claude mcp add --transport http mangacollector ${window.location.origin}/mcp --header "Authorization: Bearer ${secret}"`
    : "";

  return (
    <Modal popupOpen={Boolean(minted)} handleClose={onClose} additionalClasses="max-w-xl">
      <h3 className="font-display text-lg font-semibold text-washi">
        {t("settings.mcpRevealTitle")}
      </h3>
      <p className="mt-2 rounded-lg border border-hanko/40 bg-hanko/10 px-3 py-2 text-xs text-hanko-bright">
        {t("settings.mcpRevealWarning")}
      </p>

      <CopyBlock label={t("settings.mcpTheKey")} value={secret ?? ""} t={t} />
      <CopyBlock label={t("settings.mcpTheCommand")} value={command} t={t} />

      <p className="mt-3 text-[11px] text-washi-muted">
        {t("settings.mcpRevealEnvHint")}
      </p>

      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full rounded-lg border border-gold/40 bg-gold/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gold transition hover:bg-gold/20 active:scale-95"
      >
        {t("settings.mcpRevealDone")}
      </button>
    </Modal>
  );
}

function CopyBlock({ label, value, t }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded webviews. The value is selectable on screen either
      // way, so this is a convenience that may quietly not happen.
      setCopied(false);
    }
  };
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-washi-muted">
          {label}
        </p>
        <button
          type="button"
          onClick={copy}
          className="text-[11px] text-gold underline-offset-2 hover:underline"
        >
          {copied ? t("settings.mcpCopied") : t("settings.mcpCopy")}
        </button>
      </div>
      <pre className="mt-1 overflow-x-auto rounded-lg border border-border bg-ink-0/60 px-3 py-2 font-mono text-[11px] text-washi">
        {value}
      </pre>
    </div>
  );
}

/** 記 · What agents did, newest first. */
function AuditList({ t }) {
  const { data, isLoading } = useMcpAudit(true);
  const rows = data ?? [];

  if (isLoading) {
    return (
      <p className="mt-3 text-xs text-washi-muted">{t("settings.mcpLoading")}</p>
    );
  }
  if (rows.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border bg-ink-0/30 px-3 py-4 text-center text-xs text-washi-muted">
        {t("settings.mcpAuditEmpty")}
      </p>
    );
  }
  return (
    <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
      {rows.map((row, i) => (
        <li
          key={`${row.at}-${i}`}
          className="flex items-baseline gap-2 rounded border border-border bg-ink-0/30 px-2 py-1 text-[11px]"
        >
          <span
            className={`font-mono uppercase ${
              row.outcome === "ok"
                ? "text-moegi"
                : row.outcome === "denied"
                  ? "text-gold"
                  : "text-hanko-bright"
            }`}
          >
            {row.outcome}
          </span>
          <span className="font-mono text-washi">{row.tool}</span>
          <span className="ml-auto shrink-0 text-washi-muted">
            {new Date(row.at).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
