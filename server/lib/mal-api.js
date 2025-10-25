/**
 * @param mal_id
 * @return {Promise<{
 * "mal_id": number,
 * "url": string,
 * "images": {
 *   "jpg": {
 *     "image_url": string,
 *     "small_image_url": string,
 *     "large_image_url": string
 *   },
 *   "webp": {
 *     "image_url": string,
 *     "small_image_url": string,
 *     "large_image_url": string
 *   }
 * },
 * "approved": boolean,
 * "titles": Array<{
 *   "type": string,
 *   "title": string
 * }>,
 * "title": string,
 * "title_english": string,
 * "title_japanese": string,
 * "title_synonyms": Array<string>,
 * "type": "Manga" | "Novel" | "One Shot" | "Doujinshi" | "Manhwa" | "Manhua",
 * "chapters": number,
 * "volumes": number,
 * "status": "Finished" | "Publishing" | "Not yet published" | "On Hiatus" | "Discontinued",
 * "publishing": boolean,
 * "score": number,
 * "scored_by": number,
 * "rank": number,
 * "popularity": number,
 * "members": number,
 * "favorites": number,
 * "synopsis": string,
 * "background": string,
 * "authors": Array<{
 *  "mal_id": number,
 *  "url": string,
 *  "name": string,
 *  "type": string
 * }>,
 * "genres": Array<{
 *  "mal_id": number,
 *  "type": string,
 *  "url": string,
 *  "name": string
 * }>,
 * "explicit_genres": Array<{
 *  "mal_id": number,
 *  "type": string,
 *  "url": string,
 *  "name": string
 * }>,
 * "themes": Array<{
 *  "mal_id": number,
 *  "type": string,
 *  "url": string,
 *  "name": string
 * }>,
 * "demographics": Array<{
 *  "mal_id": number,
 *  "type": string,
 *  "url": string,
 *  "name": string
 * }>,
 * "external": Array<{
 *  "name": string,
 *  "url": string
 *  }>,
 * }>}
 */
async function getMangaFromMal(mal_id) {
  const malInfoResponse = await fetch(`https://api.jikan.moe/v4/manga/${mal_id}/full`);
  const malInfoData = await malInfoResponse.json();

  return malInfoData.data;
}

module.exports = {
  getMangaFromMal,
}
