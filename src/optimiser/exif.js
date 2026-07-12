/* ============================================================================
 * optimiser/exif.js — EXIF GPS extraction (100% client-side via exifr)
 * Turns a dropped photo File into a stop record { name, lat, lng, hasGps }.
 * Raw photo bytes never leave the browser — only name/coordinates are kept.
 * ==========================================================================*/

import exifr from "exifr";

const IMAGE_EXT = /\.(jpe?g|png|tiff?|heic|heif|webp|avif|dng)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

export function stopNameFromFilename(filename) {
  const noExt = filename.replace(/\.[^.]+$/, "");
  const cleaned = noExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || filename;
}

export function isImageFile(file) {
  if (file.type && file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name || "");
}

export async function parsePhoto(file) {
  const name = stopNameFromFilename(file.name);
  const base = { name, lat: null, lng: null, hasGps: false, reason: "", file };
  try {
    const gps = await exifr.gps(file);
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      return { ...base, lat: gps.latitude, lng: gps.longitude, hasGps: true };
    }
    return {
      ...base,
      reason: HEIC_EXT.test(file.name)
        ? "HEIC had no GPS (or GPS unsupported in this browser)"
        : "No GPS in photo (location off, or a messaging app stripped EXIF)",
    };
  } catch {
    return {
      ...base,
      reason: HEIC_EXT.test(file.name) ? "Could not read HEIC EXIF — pin manually" : "Could not read EXIF — pin manually",
    };
  }
}

export async function parsePhotos(files, onProgress) {
  const arr = Array.from(files);
  const images = arr.filter(isImageFile);
  const skipped = arr.filter((f) => !isImageFile(f)).map((f) => f.name);
  const stops = [];
  let done = 0;
  for (const file of images) {
    stops.push(await parsePhoto(file));
    done++;
    if (onProgress) onProgress(done, images.length);
    if (done % 5 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { stops, skipped };
}
