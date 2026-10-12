function classifyHost(host) {
  const h = host.toLowerCase();
  if (h === "github.com" || h.endsWith(".github.com")) return "github";
  if (h === "gitlab.com" || h.endsWith(".gitlab.com")) return "gitlab";
  if (h === "gitee.com" || h.endsWith(".gitee.com")) return "gitee";
  if (h === "bitbucket.org" || h.endsWith(".bitbucket.org")) return "bitbucket";
  return "other";
}
function normalizePath(path) {
  return path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
}
function splitHostPath(raw) {
  const url = raw.trim();
  if (url === "") return null;
  const scp = url.match(/^(?:[^@/]+@)?([^/:]+):(.+)$/);
  if (scp !== null && !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    const host = scp[1];
    const path = normalizePath(scp[2]);
    return host !== "" && path !== "" ? { host, path } : null;
  }
  const scheme = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/]+)\/(.+)$/i);
  if (scheme !== null) {
    let authority = scheme[1];
    const at = authority.lastIndexOf("@");
    if (at >= 0) authority = authority.slice(at + 1);
    const host = authority.replace(/:\d+$/, "");
    const path = normalizePath(scheme[2]);
    return host !== "" && path !== "" ? { host, path } : null;
  }
  return null;
}
function parseRemote(name, url) {
  const parsed = splitHostPath(url);
  if (parsed === null) {
    return { name, url, webUrl: null, host: null, hostKind: "other" };
  }
  return {
    name,
    url,
    webUrl: `https://${parsed.host}/${parsed.path}`,
    host: parsed.host,
    hostKind: classifyHost(parsed.host)
  };
}
export {
  classifyHost,
  parseRemote
};
