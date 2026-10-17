const DIFF_CONTEXT_DEFAULT = 3;
const DIFF_CONTEXT_MAX = 1e5;
const DIFF_EXPAND_CONTEXT = 2e3;
const DIFF_COUNT_READ_MAX = 8 * 1024 * 1024;
function isHistoryHashSearch(search) {
  return /^[0-9a-fA-F]{7,40}$/.test(search.trim());
}
function isHistoryFiltered(query) {
  const search = query.search?.trim() ?? "";
  return !isHistoryHashSearch(search) && (search !== "" || (query.author ?? "") !== "" || (query.since ?? "") !== "");
}
const SUGGEST_LIMITS = {
  maxBytes: { min: 16 * 1024, max: 512 * 1024, default: 128 * 1024 },
  maxOutputTokens: { min: 256, max: 16384, default: 4096 },
  timeoutMs: { min: 5e3, max: 12e4, default: 15e3 }
};
const SUGGEST_LANGUAGES = ["auto", "zh", "en"];
const SUGGEST_LANGUAGE_DEFAULT = "auto";
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
  DIFF_CONTEXT_DEFAULT,
  DIFF_CONTEXT_MAX,
  DIFF_COUNT_READ_MAX,
  DIFF_EXPAND_CONTEXT,
  IMAGE_MIME,
  SUGGEST_LANGUAGES,
  SUGGEST_LANGUAGE_DEFAULT,
  SUGGEST_LIMITS,
  imageMimeFor,
  isHistoryFiltered,
  isHistoryHashSearch
};
