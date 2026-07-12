/* ============================================================================
 * stops/exif.js  —  EXIF GPS extraction (100% client-side)
 * ----------------------------------------------------------------------------
 * Single responsibility: turn a dropped File into a plain stop record:
 *     { name, lat, lng, hasGps, reason }
 *
 * PRIVACY: parsing happens entirely in the browser via `exifr`. The raw photo
 * bytes never leave the machine — only the extracted name/coordinates are kept.
 *
 * To extend (e.g. also pull capture timestamp or camera heading) add fields to
 * the `pick` list below and to the returned object; nothing else needs to know.
 * ==========================================================================*/

import exifr from "exifr";

/** File extensions we treat as images worth parsing. */
const IMAGE_EXT = /\.(jpe?g|png|tiff?|heic|heif|webp|avif|dng)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

/**
 * Derive a human stop name from a filename.
 *   "Avadi.jpg"            -> "Avadi"
 *   "north_gate-2.HEIC"    -> "north gate 2"
 *   "IMG 0423.jpeg"        -> "IMG 0423"
 * Strips the extension, turns _ and - into spaces, collapses whitespace.
 */
export function stopNameFromFilename(filename) {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const cleaned = noExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || filename; // never return empty
}

/** True if the dropped File looks like an image (by MIME or extension). */
export function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name || "");
}

/**
 * Parse one image File into a stop record.
 * Always resolves (never throws) so a bad photo can't abort a bulk import.
 *
 * @returns {Promise<{name,lat,lng,hasGps,reason,file}>}
 *   hasGps=false rows still carry a name so the user can pin them manually.
 *   `reason` explains *why* GPS is missing (helps the UI message).
 */
export async function parsePhoto(file) {
  const name = stopNameFromFilename(file.name);
  const base = { name, lat: null, lng: null, hasGps: false, reason: "", file };

  try {
    // Ask exifr only for GPS — fastest path, smallest read.
    const gps = await exifr.gps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      return { ...base, lat: gps.latitude, lng: gps.longitude, hasGps: true };
    }
    // Parsed fine, but there simply was no GPS block in the EXIF.
    return {
      ...base,
      reason: HEIC_EXT.test(file.name)
        ? "HEIC had no GPS (or GPS unsupported in this browser)"
        : "No GPS in photo (location was off, or a messaging app stripped EXIF)",
    };
  } catch (err) {
    // exifr couldn't read the format (some HEIC/HEIF variants, corrupt files).
    return {
      ...base,
      reason: HEIC_EXT.test(file.name)
        ? "Could not read HEIC EXIF in this browser — pin manually"
        : "Could not read EXIF — pin manually",
    };
  }
}

/**
 * Parse a batch of Files without freezing the UI.
 * Non-image files are filtered out and reported separately.
 *
 * @param files        FileList | File[]
 * @param onProgress   (done:number, total:number) => void   (optional)
 * @returns {Promise<{stops:Array, skipped:string[]}>}
 *   stops   = parsed records (with/without GPS)
 *   skipped = filenames that were ignored (not images)
 */
export async function parsePhotos(files, onProgress) {
  const arr = Array.from(files);
  const images = arr.filter(isImageFile);
  const skipped = arr.filter((f) => !isImageFile(f)).map((f) => f.name);

  const stops = [];
  let done = 0;
  // Sequential keeps memory flat and progress honest for 50+ photos.
  // Yield to the event loop every few files so the browser stays responsive.
  for (const file of images) {
    stops.push(await parsePhoto(file));
    done++;
    if (onProgress) onProgress(done, images.length);
    if (done % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { stops, skipped };
}
