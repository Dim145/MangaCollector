import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitSyncError,
  emitSyncEvent,
  notifyPendingChanged,
  notifySyncError,
  notifySyncInfo,
  onPendingChanged,
  onSyncError,
  onSyncEvent,
  onSyncInfo,
} from "./events.js";

/*
 * A thin CustomEvent bus over `window`. Two properties carry the
 * weight: every `on*` returns a working unsubscribe (a leak here means
 * a toast firing from an unmounted component), and the four channels
 * stay separate so the error toaster never renders a success report.
 */

const cleanups = [];
const sub = (fn, handler) => {
  const off = fn(handler);
  cleanups.push(off);
  return off;
};

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

describe("pending-changed channel", () => {
  it("delivers to a subscriber", () => {
    const handler = vi.fn();
    sub(onPendingChanged, handler);
    notifyPendingChanged();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers to every subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    sub(onPendingChanged, a);
    sub(onPendingChanged, b);
    notifyPendingChanged();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe", () => {
    const handler = vi.fn();
    const off = onPendingChanged(handler);
    off();
    notifyPendingChanged();
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribing one leaves the other subscribed", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onPendingChanged(a);
    sub(onPendingChanged, b);
    offA();
    notifyPendingChanged();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("notifySyncError", () => {
  const detailOf = (handler) => handler.mock.calls[0][0].detail;

  it("passes a plain string through as the message", () => {
    const handler = vi.fn();
    sub(onSyncError, handler);
    notifySyncError("boom");
    expect(detailOf(handler)).toEqual({ op: "direct", message: "boom" });
  });

  it("prefers the server's error field on an axios error", () => {
    const handler = vi.fn();
    sub(onSyncError, handler);
    notifySyncError({
      response: { data: { error: "Series already in library" } },
      message: "Request failed with status code 409",
    });
    expect(detailOf(handler).message).toBe("Series already in library");
  });

  it("falls back to the Error message when there is no server payload", () => {
    const handler = vi.fn();
    sub(onSyncError, handler);
    notifySyncError(new Error("Network Error"));
    expect(detailOf(handler).message).toBe("Network Error");
  });

  it.each([[null], [undefined], [{}], [42]])(
    "falls back to a generic message for %p",
    (input) => {
      const handler = vi.fn();
      sub(onSyncError, handler);
      notifySyncError(input);
      expect(detailOf(handler).message).toBe("Request failed");
    },
  );

  it("defaults the op context to 'direct'", () => {
    const handler = vi.fn();
    sub(onSyncError, handler);
    notifySyncError("boom");
    expect(detailOf(handler).op).toBe("direct");
  });

  it("carries an explicit op context", () => {
    const handler = vi.fn();
    sub(onSyncError, handler);
    notifySyncError("boom", "outbox-flush");
    expect(detailOf(handler).op).toBe("outbox-flush");
  });
});

describe("emitSyncError", () => {
  it("emits the detail verbatim, without the message normalisation", () => {
    const handler = vi.fn();
    sub(onSyncError, handler);
    emitSyncError({ op: "custom", message: "verbatim", extra: 1 });
    expect(handler.mock.calls[0][0].detail).toEqual({
      op: "custom",
      message: "verbatim",
      extra: 1,
    });
  });
});

describe("info channel", () => {
  it("delivers a payload", () => {
    const handler = vi.fn();
    sub(onSyncInfo, handler);
    notifySyncInfo({ added: 3 });
    expect(handler.mock.calls[0][0].detail).toEqual({ added: 3 });
  });

  it.each([[null], [undefined]])("substitutes an empty object for %p", (input) => {
    const handler = vi.fn();
    sub(onSyncInfo, handler);
    notifySyncInfo(input);
    expect(handler.mock.calls[0][0].detail).toEqual({});
  });
});

describe("realtime relay", () => {
  it("delivers the server SyncEvent shape", () => {
    const handler = vi.fn();
    sub(onSyncEvent, handler);
    emitSyncEvent({ user_id: 7, kind: "library", payload: { mal_id: 2 } });
    expect(handler.mock.calls[0][0].detail).toEqual({
      user_id: 7,
      kind: "library",
      payload: { mal_id: 2 },
    });
  });

  it.each([[null], [undefined]])("substitutes an empty object for %p", (input) => {
    const handler = vi.fn();
    sub(onSyncEvent, handler);
    emitSyncEvent(input);
    expect(handler.mock.calls[0][0].detail).toEqual({});
  });
});

describe("channel isolation", () => {
  it("keeps the four channels independent", () => {
    // An error must never reach the success toaster, and vice versa.
    const pending = vi.fn();
    const error = vi.fn();
    const info = vi.fn();
    const event = vi.fn();
    sub(onPendingChanged, pending);
    sub(onSyncError, error);
    sub(onSyncInfo, info);
    sub(onSyncEvent, event);

    notifySyncError("boom");
    expect(error).toHaveBeenCalledTimes(1);
    expect(pending).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();

    notifySyncInfo({ ok: true });
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);

    notifyPendingChanged();
    expect(pending).toHaveBeenCalledTimes(1);

    emitSyncEvent({ kind: "x" });
    expect(event).toHaveBeenCalledTimes(1);
  });
});
