/*
 * 音 · Audio feedback for key actions.
 *
 * Tiny WebAudio synthesizer — no asset files, no shipped buffers.
 * Each cue is built from short sine envelopes so the bundle stays
 * lean and the timbre stays consistent with the project's restrained
 * Japanese-typographic aesthetic (think shōgi clock click, not
 * Material Design "ding").
 *
 * Storage: backed by the DB-stored `sound_enabled` user setting
 * (default `false`). The flag is mirrored locally via `setEnabled()`
 * so the audio path can early-out without a React subscription on
 * every call site. SettingsProvider keeps the mirror in sync.
 *
 * Autoplay: AudioContext is lazily constructed on the first cue
 * AFTER a user gesture (toggle, button click — same gesture stack
 * that fires the cue). Browser autoplay policies don't let us
 * pre-warm it on app start without an interaction.
 *
 * Volume: master gain capped at 0.18 — these are background
 * affordances, not alerts. We DON'T expose a per-user volume
 * slider yet; if the cue is too loud the right escape hatch is
 * "off", not a slider.
 */

let enabled = false;
let ctx = null;
let masterGain = null;

function ensureCtx() {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.18;
    masterGain.connect(ctx.destination);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Schedule a single sine-envelope tone. `attack` + `release` are in
 * seconds, gain follows a quick ramp-up then exponential decay so the
 * tone reads as a "pluck" rather than a square pulse (which would
 * click on the edges).
 */
function tone(freq, { delay = 0, attack = 0.005, release = 0.07, gain = 1 } = {}) {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(gain, t0 + attack);
  // exponentialRampToValueAtTime can't reach 0 — finish with a tiny
  // floor + setValueAtTime stop to keep the decay glitch-free.
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
  osc.connect(env).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + attack + release + 0.02);
}

export function setSoundEnabled(next) {
  enabled = Boolean(next);
}

export function getSoundEnabled() {
  return enabled;
}

export const sounds = {
  /** 軽 · Tap — 1.2 kHz blip for routine toggles. */
  tap: () => {
    if (!enabled) return;
    tone(1200, { release: 0.05, gain: 0.6 });
  },
  /** 中 · Bump — slightly fuller mid-range for non-trivial flips. */
  bump: () => {
    if (!enabled) return;
    tone(820, { release: 0.07, gain: 0.7 });
  },
  /** 報 · Info — single mid-low tone for neutral toasts (acknowledgement,
      "no changes", informational notice). Lower than `tap` so it doesn't
      sound like a click; shorter than `success` so it doesn't claim a
      win the action didn't earn. */
  info: () => {
    if (!enabled) return;
    tone(523.25, { release: 0.1, gain: 0.55 });
  },
  /** 成 · Success — two-tone perfect-fifth chime (C5 → G5). */
  success: () => {
    if (!enabled) return;
    tone(523.25, { release: 0.08, gain: 0.7 });
    tone(783.99, { delay: 0.06, release: 0.12, gain: 0.7 });
  },
  /** 失 · Error — descending tritone (E4 → A#3) — sour but short. */
  error: () => {
    if (!enabled) return;
    tone(329.63, { release: 0.09, gain: 0.7 });
    tone(233.08, { delay: 0.07, release: 0.14, gain: 0.7 });
  },
  /**
   * 印 · Seal ceremony — tier-aware ascending chime fired alongside
   * the spotlight + stamp animation when a freshly-earned seal is
   * being celebrated. Longer release (~0.5s) so the cue "rings"
   * rather than clicks; tone count and bass register grow with the
   * tier so a tier-5 shikkoku feels meaningfully heavier than a
   * tier-1 sumi without a separate audio asset per tier.
   *
   * Harmony: D-major arpeggio (D5, F#5, A5, D6) — open and reverent
   * rather than triumphal-march bombastic, in keeping with the
   * project's restrained brush-and-ink aesthetic. Tier 5 lays a
   * D3 bass underneath the arpeggio for legendary weight.
   */
  seal: (tier = 1) => {
    if (!enabled) return;
    const stagger = 0.16;
    const release = 0.5;
    const gain = 0.7;
    if (tier >= 5) {
      // Bass tail starts first and rings under the whole arpeggio.
      tone(146.83, { release: 1.1, gain: 0.5 });
    }
    // Ascending arpeggio — note count grows with tier so a tier-1
    // sumi reads as a single chime, a tier-3 moegi as a full D-major
    // triad, a tier-4+ kin/shikkoku as a triad capped with the octave.
    tone(587.33, { release, gain });                                   // D5
    if (tier >= 2) tone(739.99, { delay: stagger, release, gain });    // F#5
    if (tier >= 3) tone(880.0, { delay: stagger * 2, release, gain }); // A5
    if (tier >= 4) tone(1174.66, { delay: stagger * 3, release: release + 0.2, gain }); // D6
  },
};

export default sounds;
