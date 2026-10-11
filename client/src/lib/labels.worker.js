/*
 * 札 · The label sheet, built off the page (`labelsPdf.js`).
 *
 * One request per worker: `{ labels, opts }` in, then progress messages
 * `{ progress: [done, total] }` and a last `{ blob }` — or `{ error }`.
 */
import { buildLabelPdf } from "./labels.js";

self.onmessage = async ({ data }) => {
  try {
    const blob = await buildLabelPdf(data.labels, {
      ...data.opts,
      onProgress: (done, total) => self.postMessage({ progress: [done, total] }),
    });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: String(error?.message ?? error) });
  }
};
