const SUGGEST_LIMITS = {
  maxBytes: { min: 16 * 1024, max: 512 * 1024, default: 128 * 1024 },
  maxOutputTokens: { min: 256, max: 16384, default: 4096 },
  timeoutMs: { min: 5e3, max: 12e4, default: 15e3 }
};
const IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff"
};
function imageMimeFor(path) {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  return IMAGE_MIME[path.slice(dot + 1).toLowerCase()] ?? null;
}
export {
  IMAGE_MIME,
  SUGGEST_LIMITS,
  imageMimeFor
};
