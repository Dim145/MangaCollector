import axios from "./axios";

async function getAllVolumes() {
  const response = await axios.get("/api/user/volume");
  return response.data;
}

async function getAllVolumesByID(mal_id) {
  const response = await axios.get(`/api/user/volume/${mal_id}`);
  return response.data;
}

async function updateVolumeByID(id, owned, price, store) {
  await axios.patch(`/api/user/volume`, { id, owned, price, store });
}

/**
 * Format a list of volume numbers as a human-readable range string.
 *
 * Example: [1, 2, 3, 5, 6, 8] → "1–3, 5–6, 8"
 *
 * Used by the dashboard's GapSuggestions card and the AddPage's
 * "missing volumes" summary; both surfaces previously carried their
 * own byte-identical copy of this function.
 *
 * Empty input → empty string. Non-numeric / NaN entries are left in
 * place — sort treats them as falling back; callers are expected to
 * pass clean integer arrays.
 */
function summarizeRange(nums) {
  if (!nums.length) return "";
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return ranges.join(", ");
}

/**
 * Locale-aware short date formatter for volume metadata —
 * "Jan 5, 2024" / "5 janv. 2024" depending on the user's locale.
 *
 * Used wherever a release date or a read-on date needs to be
 * displayed: the volume tile, the volume detail drawer, etc.
 * Replaces two byte-identical helpers (`formatReadDate` /
 * `formatReleaseDate`) that lived in those two components.
 *
 * Returns the empty string for nullish, empty-string, or
 * unparseable inputs — callers can interpolate the result
 * directly into a label without an extra guard.
 */
function formatShortDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export {
  getAllVolumes,
  getAllVolumesByID,
  updateVolumeByID,
  summarizeRange,
  formatShortDate,
};
