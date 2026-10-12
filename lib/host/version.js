import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
function manifestPath() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
}
function stringField(value) {
  return typeof value === "string" && value !== "" ? value : void 0;
}
function parseRepository(repository) {
  const raw = typeof repository === "string" ? repository : typeof repository === "object" && repository !== null ? stringField(repository.url) : void 0;
  if (raw === void 0) return void 0;
  const fromHost = raw.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:$|[/#?])/i);
  if (fromHost !== null) return { owner: fromHost[1], repo: fromHost[2] };
  const shorthand = raw.match(/^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (shorthand !== null) return { owner: shorthand[1], repo: shorthand[2] };
  return void 0;
}
function compareVersions(a, b) {
  const split = (value) => {
    const trimmed = value.trim().replace(/^v/i, "");
    const [core, ...rest] = trimmed.split("-");
    const preRaw = rest.join("-");
    return {
      core: core.split(".").map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part)),
      pre: preRaw === "" ? [] : preRaw.split(".")
    };
  };
  const left = split(a);
  const right = split(b);
  const length = Math.max(left.core.length, right.core.length);
  for (let index = 0; index < length; index += 1) {
    const l = left.core[index] ?? 0;
    const r = right.core[index] ?? 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  if (left.pre.length === 0 && right.pre.length === 0) return 0;
  if (left.pre.length === 0) return 1;
  if (right.pre.length === 0) return -1;
  const preLen = Math.max(left.pre.length, right.pre.length);
  for (let i = 0; i < preLen; i += 1) {
    const lp = left.pre[i];
    const rp = right.pre[i];
    if (lp === void 0) return -1;
    if (rp === void 0) return 1;
    const ln = Number.parseInt(lp, 10);
    const rn = Number.parseInt(rp, 10);
    const lNum = Number.isFinite(ln) && String(ln) === lp;
    const rNum = Number.isFinite(rn) && String(rn) === rp;
    if (lNum && rNum) {
      if (ln !== rn) return ln > rn ? 1 : -1;
    } else if (lp !== rp) return lp > rp ? 1 : -1;
  }
  return 0;
}
let manifestCache;
async function readManifest(path) {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("package.json is not an object");
  return parsed;
}
async function loadManifest(path) {
  if (path !== void 0) return readManifest(path);
  if (manifestCache === void 0) manifestCache = await readManifest(manifestPath());
  return manifestCache;
}
async function readVersionInfo(options = {}) {
  const manifest = await loadManifest(options.manifestPath);
  const current = stringField(manifest.version) ?? "0.0.0";
  const repo = parseRepository(manifest.repository);
  const repositoryUrl = repo === void 0 ? void 0 : `https://github.com/${repo.owner}/${repo.repo}`;
  return {
    current,
    ...repositoryUrl ? { repositoryUrl } : {},
    updateAvailable: false,
    checkedRemote: false
  };
}
function safeReleaseUrl(url) {
  if (url === void 0) return void 0;
  return /^https:\/\/github\.com\//i.test(url) ? url : void 0;
}
const REMOTE_CACHE_MS = 10 * 60 * 1e3;
let remoteCache;
async function checkLatestVersion(options = {}) {
  if (options.manifestPath === void 0 && options.fetchFn === void 0 && remoteCache !== void 0 && Date.now() - remoteCache.at < REMOTE_CACHE_MS) {
    return remoteCache.info;
  }
  const base = await readVersionInfo({ manifestPath: options.manifestPath });
  const repo = parseRepository((await loadManifest(options.manifestPath)).repository);
  if (repo === void 0) {
    return { ...base, checkedRemote: false, error: "repository is not configured" };
  }
  const fetchFn = options.fetchFn ?? fetch;
  try {
    const response = await fetchFn(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "dsh-git-panel" },
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) {
      return { ...base, checkedRemote: true, error: `GitHub responded with ${response.status}` };
    }
    const body = await response.json();
    const tag = typeof body === "object" && body !== null ? stringField(body.tag_name) : void 0;
    const htmlUrl = typeof body === "object" && body !== null ? stringField(body.html_url) : void 0;
    if (tag === void 0) {
      return { ...base, checkedRemote: true, error: "GitHub response did not include a release tag" };
    }
    const latest = tag.replace(/^v/i, "");
    const info = {
      ...base,
      checkedRemote: true,
      latest,
      updateAvailable: compareVersions(latest, base.current) > 0,
      releaseUrl: safeReleaseUrl(htmlUrl) ?? (base.repositoryUrl !== void 0 ? `${base.repositoryUrl}/releases/latest` : void 0)
    };
    if (options.manifestPath === void 0 && options.fetchFn === void 0) remoteCache = { at: Date.now(), info };
    return info;
  } catch (error) {
    return { ...base, checkedRemote: true, error: error instanceof Error ? error.message : "Unable to reach GitHub" };
  }
}
export {
  checkLatestVersion,
  compareVersions,
  parseRepository,
  readVersionInfo
};
