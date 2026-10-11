import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";
import { getCachedUser } from "@/utils/auth.js";
import { PAGE_PATHS } from "@/routePages.js";

/*
 * 測 · Field measurements — the Core Web Vitals this reader's browser
 * measures, sent to this instance when the operator asks for them
 * (`RUM_ENABLED`, read from `/api/public-config` by `main.jsx`).
 *
 * A self-hosted archive has no Chrome UX Report: the lab numbers in
 * `scripts/perf` say how a page behaves on this machine, and only its
 * readers' browsers can say how it behaves on theirs. This module is
 * imported by `main.jsx` only when the switch is on, so nobody else
 * downloads it.
 *
 * What leaves the device, in one beacon when a page is hidden: the page
 * (`/author/:param`, never an id or a query), each metric and its value,
 * the phases web-vitals attributes it to, the CSS selector of the
 * element at fault, whether the pointer is coarse, and the connection's
 * effective type. Nothing names the reader, and only signed-in readers
 * report — a visitor on the landing sends nothing. The server keeps a
 * summary in memory and logs each value (`server/src/services/rum.rs`).
 */
const ENDPOINT = "/api/rum";
const MAX_PER_BEACON = 12;

const prefixes = Object.keys(PAGE_PATHS)
  .filter((key) => key.length > 1 && key.endsWith("/"))
  .sort((a, b) => b.length - a.length);

/** The page a path is, without anything that identifies what is on it. */
export function routeOf(pathname) {
  if (typeof pathname !== "string") return "/other";
  if (Object.hasOwn(PAGE_PATHS, pathname) && (pathname === "/" || !pathname.endsWith("/"))) {
    return pathname;
  }
  const prefix = prefixes.find((key) => pathname.startsWith(key) && pathname.length > key.length);
  return prefix ? `${prefix}:param` : "/other";
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : undefined);
const clip = (selector) => (typeof selector === "string" ? selector.slice(0, 120) : undefined);

/** One metric as the beacon carries it. */
export function summarise(metric, pathname) {
  const a = metric.attribution ?? {};
  const base = {
    n: metric.name,
    v: metric.name === "CLS" ? Math.round(metric.value * 1000) / 1000 : round(metric.value),
    r: metric.rating,
    nav: metric.navigationType,
    route: routeOf(pathname),
  };
  switch (metric.name) {
    case "LCP":
      return {
        ...base,
        t: clip(a.target),
        d: [a.timeToFirstByte, a.resourceLoadDelay, a.resourceLoadDuration, a.elementRenderDelay].map(round),
      };
    case "INP":
      return {
        ...base,
        t: clip(a.interactionTarget),
        k: a.interactionType,
        d: [a.inputDelay, a.processingDuration, a.presentationDelay].map(round),
      };
    case "CLS":
      return { ...base, t: clip(a.largestShiftTarget) };
    default:
      return base;
  }
}

function device() {
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return { mobile: coarse, conn: navigator.connection?.effectiveType };
}

let started = false;

/**
 * Start measuring. Values are queued as web-vitals reports them and
 * sent when the page is hidden — the last moment a browser reliably
 * lets a page speak — or when the queue is full.
 */
export function startRum({ isSignedIn = () => getCachedUser() != null } = {}) {
  if (started || typeof window === "undefined") return;
  started = true;
  const queue = [];

  const flush = () => {
    if (!queue.length) return;
    const metrics = queue.splice(0, queue.length);
    if (!isSignedIn() || typeof navigator.sendBeacon !== "function") return;
    for (let i = 0; i < metrics.length; i += MAX_PER_BEACON) {
      const body = JSON.stringify({ device: device(), metrics: metrics.slice(i, i + MAX_PER_BEACON) });
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    }
  };

  // The page loads belong to the page the reader arrived on, whenever
  // web-vitals settles them; an interaction to the page it happened on.
  const landing = window.location.pathname;
  const push = (metric) => {
    queue.push(summarise(metric, metric.name === "INP" ? window.location.pathname : landing));
    if (queue.length >= MAX_PER_BEACON) flush();
  };
  onLCP(push);
  onINP(push);
  onCLS(push);
  onFCP(push);
  onTTFB(push);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}
