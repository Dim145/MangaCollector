import { buildLabelPdf } from "./labels.js";

/*
 * 札 · The label sheet as a PDF, built in a worker when the browser can.
 *
 * Painting a sticker, encoding it as PNG and placing it in the PDF is a
 * few tens of milliseconds each; a series of a hundred tomes was seconds
 * of the page not answering, broken only by the progress repaints
 * `buildLabelPdf` yields for. In a worker the page stays live and the
 * progress bar moves on its own.
 *
 * A worker needs `OffscreenCanvas` to paint (Safari 16.4, Firefox 105,
 * Chromium 69). Without it — or if the worker fails for any reason,
 * jsPDF included — the sheet is built on the page as it always was, so
 * a worker is never the reason a sheet cannot be printed.
 */
export function buildLabelPdfOffThread(labels, opts = {}) {
  const { onProgress, ...rest } = opts;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return buildLabelPdf(labels, opts);
  }
  let worker;
  try {
    worker = new Worker(new URL("./labels.worker.js", import.meta.url), { type: "module" });
  } catch {
    return buildLabelPdf(labels, opts);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onPage = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      buildLabelPdf(labels, opts).then(resolve, reject);
    };
    worker.onmessage = ({ data }) => {
      if (settled) return;
      if (data?.progress) {
        onProgress?.(...data.progress);
      } else if (data?.blob) {
        settled = true;
        worker.terminate();
        resolve(data.blob);
      } else {
        // The worker could not build it (`data.error`): the page can.
        onPage();
      }
    };
    worker.onerror = (event) => {
      event?.preventDefault?.();
      onPage();
    };
    worker.postMessage({ labels, opts: rest });
  });
}
