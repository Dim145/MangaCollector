import { describe, expect, it, vi } from "vitest";
import {
  TOUR_STEPS,
  consumeTourStep,
  hasSeenTour,
  markTourSeen,
  peekTourStep,
  resetTourSeen,
  setTourStep,
} from "./tour.js";

/*
 * Two stores with deliberately different lifetimes: "seen" persists in
 * localStorage across restarts, "step" lives in sessionStorage so a
 * reload a week later doesn't replay the spotlight. Mixing them up is
 * exactly the regression this suite guards.
 */

describe("TOUR_STEPS", () => {
  it("is frozen so a caller cannot smuggle in a new id", () => {
    expect(Object.isFrozen(TOUR_STEPS)).toBe(true);
  });

  it("has unique values", () => {
    const values = Object.values(TOUR_STEPS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("seen flag", () => {
  it("starts unseen", () => {
    expect(hasSeenTour()).toBe(false);
  });

  it("round-trips", () => {
    markTourSeen();
    expect(hasSeenTour()).toBe(true);
  });

  it("resets", () => {
    markTourSeen();
    resetTourSeen();
    expect(hasSeenTour()).toBe(false);
  });

  it("lives in localStorage, not sessionStorage", () => {
    // Persisting across browser restarts is the documented contract.
    markTourSeen();
    expect(localStorage.getItem("mc:tour-seen")).toBe("1");
    expect(sessionStorage.getItem("mc:tour-seen")).toBeNull();
  });

  it("treats any value other than '1' as unseen", () => {
    localStorage.setItem("mc:tour-seen", "true");
    expect(hasSeenTour()).toBe(false);
  });

  it("reports unseen rather than throwing when storage is unreadable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(hasSeenTour()).toBe(false);
  });

  it("does not throw when storage refuses a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => markTourSeen()).not.toThrow();
  });
});

describe("step", () => {
  it("starts empty", () => {
    expect(peekTourStep()).toBeNull();
    expect(consumeTourStep()).toBeNull();
  });

  it.each(Object.values(TOUR_STEPS))("round-trips the %s step", (step) => {
    setTourStep(step);
    expect(peekTourStep()).toBe(step);
  });

  it("lives in sessionStorage, not localStorage", () => {
    setTourStep(TOUR_STEPS.SCAN);
    expect(sessionStorage.getItem("mc:tour-step")).toBe("scan");
    expect(localStorage.getItem("mc:tour-step")).toBeNull();
  });

  it.each(["profile", "", "SCAN", null, undefined, 42])(
    "ignores the invalid step %p",
    (step) => {
      setTourStep(step);
      expect(peekTourStep()).toBeNull();
    },
  );

  it("does not overwrite a valid step with an invalid one", () => {
    setTourStep(TOUR_STEPS.SCAN);
    setTourStep("bogus");
    expect(peekTourStep()).toBe("scan");
  });

  describe("peek vs consume", () => {
    it("peek is repeatable and non-destructive", () => {
      setTourStep(TOUR_STEPS.AVATAR);
      expect(peekTourStep()).toBe("avatar");
      expect(peekTourStep()).toBe("avatar");
      expect(sessionStorage.getItem("mc:tour-step")).toBe("avatar");
    });

    it("consume clears so a reload does not replay the spotlight", () => {
      setTourStep(TOUR_STEPS.AVATAR);
      expect(consumeTourStep()).toBe("avatar");
      expect(consumeTourStep()).toBeNull();
      expect(peekTourStep()).toBeNull();
    });

    it("supports the peek-then-consume pattern for late-bound refs", () => {
      // ProfilePage peeks while its avatar button is still mounting,
      // then consumes only once the target actually exists.
      setTourStep(TOUR_STEPS.SNAPSHOT);
      expect(peekTourStep()).toBe("snapshot");
      expect(peekTourStep()).toBe("snapshot");
      expect(consumeTourStep()).toBe("snapshot");
      expect(peekTourStep()).toBeNull();
    });
  });

  it("rejects a value tampered with directly in storage", () => {
    sessionStorage.setItem("mc:tour-step", "../../evil");
    expect(peekTourStep()).toBeNull();
    expect(consumeTourStep()).toBeNull();
  });

  it("clears a tampered value even though it reports null", () => {
    sessionStorage.setItem("mc:tour-step", "evil");
    consumeTourStep();
    expect(sessionStorage.getItem("mc:tour-step")).toBeNull();
  });

  it("returns null rather than throwing when storage is unreadable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(peekTourStep()).toBeNull();
    expect(consumeTourStep()).toBeNull();
  });
});
