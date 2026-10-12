function commitFromFields(parts) {
  const hash = parts[0];
  if (parts.length < 5 || hash === void 0 || hash === "") return null;
  return {
    hash,
    shortHash: parts[1] ?? "",
    subject: parts[2] ?? "",
    author: parts[3] ?? "",
    dateIso: parts[4] ?? ""
  };
}
function statusOf(code) {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}
function parseStatus(stdout) {
  const out = [];
  const records = stdout.split("\0");
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec === void 0 || rec.length < 3) continue;
    const x = rec[0];
    const y = rec[1];
    let path = rec.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      i++;
    }
    const isDirectory = path.endsWith("/");
    if (isDirectory) path = path.replace(/\/+$/, "");
    if (x === "?" && y === "?") {
      out.push({ path, status: "untracked", staged: false, isDirectory });
      continue;
    }
    if (x === "U" || y === "U" || x === "A" && y === "A" || x === "D" && y === "D") {
      out.push({ path, status: "conflicted", staged: false, isDirectory });
      continue;
    }
    if (x !== " " && x !== "?") {
      out.push({ path, status: statusOf(x), staged: true, isDirectory });
    }
    if (y !== " " && y !== "?") {
      out.push({ path, status: statusOf(y), staged: false, isDirectory });
    }
  }
  return out;
}
function parseGraphLog(stdout) {
  const out = [];
  for (const record of stdout.split("")) {
    const rec = record.replace(/^\n+/, "");
    if (rec.trim() === "") continue;
    const parts = rec.split("");
    if (parts.length < 7) continue;
    const [hash, shortHash, parentsRaw, author, dateIso, decoration] = parts;
    const subject = parts.slice(6).join("");
    const parents = (parentsRaw ?? "").trim() === "" ? [] : parentsRaw.trim().split(/\s+/);
    out.push({
      hash: hash ?? "",
      shortHash: shortHash ?? "",
      subject,
      author: author ?? "",
      dateIso: dateIso ?? "",
      parents,
      refs: parseRefs(decoration ?? "")
    });
  }
  return out;
}
function parseRefs(decoration) {
  const refs = [];
  for (const raw of decoration.split(",")) {
    let token = raw.trim();
    if (token === "") continue;
    let head = false;
    if (token.startsWith("HEAD -> ")) {
      head = true;
      token = token.slice("HEAD -> ".length).trim();
    } else if (token === "HEAD") {
      continue;
    }
    if (token.startsWith("tag: ")) {
      refs.push({ kind: "tag", name: token.slice("tag: ".length).trim().replace(/^refs\/tags\//, ""), head: false });
    } else if (token.startsWith("refs/tags/")) {
      refs.push({ kind: "tag", name: token.slice("refs/tags/".length), head: false });
    } else if (token.startsWith("refs/remotes/")) {
      refs.push({ kind: "remote", name: token.slice("refs/remotes/".length), head });
    } else if (token.startsWith("refs/heads/")) {
      refs.push({ kind: "branch", name: token.slice("refs/heads/".length), head });
    } else if (head) {
      refs.push({ kind: "branch", name: token, head });
    } else if (token.startsWith("origin/") || token.includes("/")) {
      refs.push({ kind: "remote", name: token, head });
    } else {
      refs.push({ kind: "branch", name: token, head });
    }
  }
  return refs;
}
function parseBranches(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const [name, shortHash = "", track = ""] = line.split("\0");
    if (name === void 0 || name === "") continue;
    const branch = {
      name,
      shortHash: shortHash === "" ? null : shortHash
    };
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);
    if (ahead) branch.ahead = Number(ahead[1]);
    if (behind) branch.behind = Number(behind[1]);
    out.push(branch);
  }
  return out;
}
function parseTags(stdout) {
  const out = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const [name, shortHash = ""] = line.split("\0");
    if (name) out.push({ name, shortHash: shortHash === "" ? null : shortHash });
  }
  return out;
}
function parseStashList(stdout) {
  const out = [];
  for (const record of stdout.split("\0")) {
    if (record.trim() === "") continue;
    const [selector = "", sha = "", subject = "", relTime = ""] = record.split("");
    const idxMatch = /stash@\{(\d+)\}/.exec(selector);
    if (idxMatch === null) continue;
    const index = Number(idxMatch[1]);
    let branch = null;
    let message = subject;
    const m = /^(?:WIP on|On) (.+?): (.*)$/s.exec(subject);
    if (m !== null) {
      branch = m[1] === "(no branch)" ? null : m[1] ?? null;
      message = m[2] ?? "";
    }
    out.push({ index, sha: sha.trim(), message: message.trim(), branch, relTime: relTime.trim() });
  }
  return out;
}
function parseNameStatus(stdout) {
  const out = [];
  const tokens = stdout.split("\0");
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === void 0 || tok === "") {
      i += 1;
      continue;
    }
    const code = tok[0];
    if (code === void 0 || !/[AMDRCTU]/.test(code)) break;
    if (code === "R" || code === "C") {
      const newPath = tokens[i + 2];
      if (newPath === void 0) break;
      out.push({ path: newPath, status: statusOf(code) });
      i += 3;
    } else {
      const path = tokens[i + 1];
      if (path === void 0) break;
      if (path !== "") out.push({ path, status: statusOf(code) });
      i += 2;
    }
  }
  return out;
}
function sumNumstat(stdout) {
  let insertions = 0;
  let deletions = 0;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("	");
    if (parts.length < 2) continue;
    const add = Number(parts[0]);
    const del = Number(parts[1]);
    if (Number.isFinite(add)) insertions += add;
    if (Number.isFinite(del)) deletions += del;
  }
  return { insertions, deletions };
}
export {
  commitFromFields,
  parseBranches,
  parseGraphLog,
  parseNameStatus,
  parseRefs,
  parseStashList,
  parseStatus,
  parseTags,
  sumNumstat
};
