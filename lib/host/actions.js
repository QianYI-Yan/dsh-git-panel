import { join, sep } from "node:path";
import { mapWorkspaceFailure, resolveWorkspace, runCommand, snapshotForSession } from "./core.js";
import { isSafeBranchName, isSafePath, isSafeRemoteName, isSafeRev } from "./validate.js";
function withPaths(prefixes, paths) {
  if (paths.length === 0) return { error: "invalid-path", message: "no paths given" };
  for (const path of paths) {
    if (!isSafePath(path)) return { error: "invalid-path", message: `unsafe path: ${path}` };
  }
  return { argv: prefixes.map((prefix) => [...prefix, ...paths]) };
}
function planAction(action, unborn) {
  switch (action.kind) {
    case "stage":
      return withPaths([["git", "add", "--"]], action.paths);
    case "stage-all":
      return { argv: [["git", "add", "-A"]] };
    case "unstage":
      return unborn ? withPaths([["git", "rm", "--cached", "-r", "--"]], action.paths) : withPaths([["git", "restore", "--staged", "--"]], action.paths);
    case "unstage-all":
      return unborn ? { argv: [["git", "rm", "--cached", "-r", "--", "."]] } : { argv: [["git", "restore", "--staged", "--", "."]] };
    case "discard":
      return withPaths([["git", "restore", "--"]], action.paths);
    case "commit": {
      const message = action.message.trim();
      const amend = action.amend === true;
      if (message === "" && !amend) return { error: "empty-message" };
      const amendFlag = amend ? ["--amend"] : [];
      const msgArgs = message === "" ? ["--no-edit"] : ["-m", message];
      if (action.paths === void 0 || action.paths.length === 0) {
        return { argv: [["git", "commit", ...amendFlag, ...msgArgs]] };
      }
      const staged = withPaths([["git", "add", "--"]], action.paths);
      if ("error" in staged) return staged;
      const commitCmd = ["git", "commit", ...amendFlag, ...msgArgs, "--", ...action.paths];
      return { argv: [...staged.argv, commitCmd] };
    }
    case "branch-checkout": {
      if (!isSafeBranchName(action.name)) return { error: "invalid-name", message: `unsafe branch name: ${action.name}` };
      let checkout = ["git", "checkout", action.name];
      if (action.createFrom !== void 0) {
        if (!isSafeBranchName(action.createFrom)) return { error: "invalid-name", message: `unsafe tracking ref: ${action.createFrom}` };
        checkout = ["git", "checkout", "-b", action.name, "--track", action.createFrom];
      }
      const msg = action.stashMessage?.trim() ?? "";
      return { argv: msg === "" ? [checkout] : [["git", "stash", "push", "-u", "-m", msg], checkout] };
    }
    case "fetch":
      return { argv: [["git", "fetch", "--all", "--prune"]] };
    case "pull-ff":
      return { argv: [["git", "pull", "--ff-only"]] };
    case "push":
      return { argv: [["git", "push"]] };
    case "publish":
      if (!isSafeRemoteName(action.remote)) return { error: "invalid-name", message: `unsafe remote name: ${action.remote}` };
      return { argv: [["git", "push", "-u", action.remote, "HEAD"]] };
    case "tag-create": {
      if (!isSafeBranchName(action.name)) return { error: "invalid-name", message: `unsafe tag name: ${action.name}` };
      if (!isSafeRev(action.commit)) return { error: "invalid-name", message: `unsafe commit: ${action.commit}` };
      const msg = action.message?.trim() ?? "";
      const flags = msg === "" ? [] : ["-a", "-m", msg];
      return { argv: [["git", "tag", ...flags, "--end-of-options", action.name, action.commit]] };
    }
    case "tag-delete":
      if (!isSafeBranchName(action.name)) return { error: "invalid-name", message: `unsafe tag name: ${action.name}` };
      return { argv: [["git", "tag", "-d", "--end-of-options", action.name]] };
    case "stash-push": {
      const msg = action.message?.trim() ?? "";
      return { argv: [msg === "" ? ["git", "stash", "push"] : ["git", "stash", "push", "-m", msg]] };
    }
    case "stash-apply":
    case "stash-pop":
    case "stash-drop": {
      if (!Number.isInteger(action.index) || action.index < 0) {
        return { error: "invalid-index", message: `invalid stash index: ${action.index}` };
      }
      const verb = action.kind === "stash-apply" ? "apply" : action.kind === "stash-pop" ? "pop" : "drop";
      return { argv: [["git", "stash", verb, "--end-of-options", `stash@{${action.index}}`]] };
    }
    case "revert": {
      if (!isSafeRev(action.commit)) return { error: "invalid-name", message: `unsafe commit: ${action.commit}` };
      return { argv: [["git", "revert", "--no-edit", "--end-of-options", action.commit]] };
    }
    case "reset": {
      if (!isSafeRev(action.commit)) return { error: "invalid-name", message: `unsafe commit: ${action.commit}` };
      if (action.mode !== "soft" && action.mode !== "mixed" && action.mode !== "hard") {
        return { error: "invalid-name", message: `invalid reset mode: ${String(action.mode)}` };
      }
      return { argv: [["git", "reset", `--${action.mode}`, action.commit]] };
    }
  }
}
function isIndexBusy(outcome) {
  if (!("run" in outcome) || outcome.run.exitCode === 0) return false;
  return /index\.lock|Unable to create.*index|another git process/i.test(outcome.run.stderr + outcome.run.stdout);
}
function scrubCredentials(text) {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, "$1");
}
function classifyActionFailure(stdout, stderr, exitCode) {
  const combined = stderr + stdout;
  const err = scrubCredentials(stderr.trim());
  if (/CONFLICT|Merge conflict|needs merge|could not restore untracked/i.test(combined)) {
    return { code: "conflict", message: err || "merge conflict" };
  }
  if (/index\.lock|Unable to create.*index|another git process/i.test(combined)) {
    return { code: "index-busy", message: err };
  }
  if (/nothing to commit|no changes added/i.test(combined)) {
    return { code: "git-error", message: err || "nothing to commit" };
  }
  if (/No such ref|not a valid reference|is not a stash|no tag|tag .* not found|unknown revision|bad revision|Could not parse object|ambiguous argument|did not match any file\(s\) known to git/i.test(combined)) {
    return { code: "not-found", message: err || "not found" };
  }
  if (/is already used by worktree|already checked out at/i.test(combined)) {
    return { code: "branch-in-use", message: err || "branch is checked out in another worktree" };
  }
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey\)|Could not read from remote repository/i.test(combined)) {
    return { code: "auth-failed", message: err || "authentication failed" };
  }
  if (/\[rejected\]|Updates were rejected|failed to push some refs|fetch first|tip of your current branch is behind/i.test(combined)) {
    return { code: "push-rejected", message: err || "push rejected (remote has new commits; fetch first)" };
  }
  if (/Not possible to fast-forward|cannot fast-forward|not a fast-forward|Need to specify how to reconcile divergent branches/i.test(combined)) {
    return { code: "not-ff", message: err || "cannot fast-forward (branches diverged)" };
  }
  if (/would be overwritten by (checkout|merge)|local changes|overwritten by merge|Your local changes/i.test(stderr)) {
    return { code: "local-changes-block", message: err };
  }
  if (/is a merge but no -m|mainline parent/i.test(combined)) {
    return { code: "revert-merge", message: err || "cannot revert a merge commit from the panel" };
  }
  return { code: "git-error", message: err || `git exited ${exitCode}` };
}
async function runAction(deps, config, request) {
  const workspace = await resolveWorkspace(deps, request.sessionId);
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) };
  const root = workspace.root;
  const headProbe = await runCommand(deps.run, ["git", "rev-parse", "--verify", "HEAD"], root, "head-probe", deps.signal);
  const unborn = !("run" in headProbe) || headProbe.run.exitCode !== 0;
  const act = request.action;
  if (act.kind === "stash-apply" || act.kind === "stash-pop" || act.kind === "stash-drop") {
    if (!Number.isInteger(act.index) || act.index < 0) {
      return { ok: false, error: { code: "invalid-index", message: `invalid stash index: ${act.index}` } };
    }
    const probe = await runCommand(deps.run, ["git", "rev-parse", "--verify", "--quiet", "--end-of-options", `stash@{${act.index}}`], root, "stash-verify", deps.signal);
    const sha = "run" in probe && probe.run.exitCode === 0 ? probe.run.stdout.trim() : "";
    if (sha === "" || sha !== act.sha) {
      return { ok: false, error: { code: "not-found", message: "stash entry changed; refresh and retry" } };
    }
  }
  if (request.action.kind === "discard") {
    const removed = await discardUntracked(deps, config, root, request.sessionId, request.action.paths);
    if (removed !== null) {
      if (!removed.ok) return removed.result;
      if (removed.remainingTracked.length === 0) {
        const snapshot2 = await snapshotForSession(deps, config, request.sessionId);
        if (!snapshot2.ok) return { ok: false, error: { code: "git-error", message: "snapshot after action failed" } };
        return { ok: true, snapshot: snapshot2.value, output: "" };
      }
      request = { ...request, action: { kind: "discard", paths: removed.remainingTracked } };
    }
  }
  const plan = planAction(request.action, unborn);
  if ("error" in plan) return { ok: false, error: { code: plan.error, ...plan.message ? { message: plan.message } : {} } };
  const stashing = request.action.kind === "branch-checkout" && (request.action.stashMessage?.trim() ?? "") !== "";
  let lastOutput = "";
  for (let step = 0; step < plan.argv.length; step += 1) {
    const argv = plan.argv[step];
    let outcome = await runCommand(deps.run, argv, root, "action", deps.signal);
    if (isIndexBusy(outcome)) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      outcome = await runCommand(deps.run, argv, root, "action-retry", deps.signal);
    }
    const where = plan.argv.length > 1 ? ` (step ${step + 1}/${plan.argv.length}: ${argv.join(" ")})` : "";
    const stashChangedWorkTree = stashing && step > 0;
    if ("failure" in outcome) {
      const message = outcome.failure instanceof Error ? outcome.failure.message : String(outcome.failure);
      return { ok: false, error: { code: stashChangedWorkTree ? "stash-switch-failed" : "git-unavailable", message: message + where } };
    }
    if (outcome.run.cancelled) {
      return { ok: false, error: stashChangedWorkTree ? { code: "stash-switch-failed", message: "cancelled" + where } : { code: "cancelled" } };
    }
    if (outcome.run.timedOut) {
      return { ok: false, error: stashChangedWorkTree ? { code: "stash-switch-failed", message: "timed out" + where } : { code: "timeout" } };
    }
    lastOutput = outcome.run.stdout || outcome.run.stderr;
    if (outcome.run.exitCode !== 0) {
      const failure = classifyActionFailure(outcome.run.stdout, outcome.run.stderr, outcome.run.exitCode ?? -1);
      if (stashChangedWorkTree) {
        return { ok: false, error: { code: "stash-switch-failed", message: failure.message + where } };
      }
      if (request.action.kind === "revert" && failure.code === "conflict") {
        let abort = await runCommand(deps.run, ["git", "revert", "--abort"], root, "revert-abort", deps.signal);
        if (isIndexBusy(abort)) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          abort = await runCommand(deps.run, ["git", "revert", "--abort"], root, "revert-abort-retry", deps.signal);
        }
        const aborted = "run" in abort && abort.run.exitCode === 0;
        return aborted ? { ok: false, error: { code: "revert-conflict", message: failure.message + where } } : { ok: false, error: { code: "revert-stuck", message: failure.message + where } };
      }
      return { ok: false, error: { code: failure.code, message: failure.message + where } };
    }
    if ((request.action.kind === "stash-push" || stashing) && /No local changes to save/i.test(outcome.run.stdout + outcome.run.stderr)) {
      const message = (outcome.run.stdout.trim() || "No local changes to save") + where;
      return { ok: false, error: { code: stashing ? "local-changes-block" : "git-error", message } };
    }
  }
  const snapshot = await snapshotForSession(deps, config, request.sessionId);
  if (!snapshot.ok) {
    return { ok: false, error: { code: "git-error", message: "snapshot after action failed" } };
  }
  return { ok: true, snapshot: snapshot.value, output: lastOutput.trim() };
}
async function looksLikeRepository(deps, target) {
  try {
    await deps.fs.stat(join(target, ".git"));
    return true;
  } catch {
  }
  const head = await pathKind(deps, join(target, "HEAD"));
  const refs = await pathKind(deps, join(target, "refs"));
  const objects = await pathKind(deps, join(target, "objects"));
  if (!head.present || head.directory === true) return false;
  const directoryLike = (kind) => kind.present && kind.directory !== false;
  return directoryLike(refs) && directoryLike(objects);
}
async function pathKind(deps, path) {
  try {
    return { present: true, directory: (await deps.fs.stat(path)).isDirectory() };
  } catch {
    return { present: await deps.fs.symlinkTarget(path) !== null, directory: null };
  }
}
async function discardUntracked(deps, config, root, sessionId, paths) {
  const snap = await snapshotForSession(deps, config, sessionId);
  if (!snap.ok) return null;
  const untrackedSet = new Set(snap.value.changes.filter((c) => c.status === "untracked").map((c) => c.path));
  const untracked = paths.filter((p) => untrackedSet.has(p));
  if (untracked.length === 0) return null;
  const tracked = paths.filter((p) => !untrackedSet.has(p));
  const directoryEntries = new Set(snap.value.changes.filter((c) => c.isDirectory === true).map((c) => c.path));
  for (const path of untracked) {
    if (!directoryEntries.has(path)) continue;
    if (!await looksLikeRepository(deps, join(root, path))) continue;
    return { ok: false, result: { ok: false, error: { code: "nested-repo", message: `repository directory: ${path}` } } };
  }
  let rootReal;
  try {
    rootReal = await deps.fs.realpath(root);
  } catch {
    return { ok: false, result: { ok: false, error: { code: "git-error", message: "repository root unavailable" } } };
  }
  const failures = [];
  let removedCount = 0;
  for (const path of untracked) {
    if (!isSafePath(path)) return { ok: false, result: { ok: false, error: { code: "invalid-path", message: `unsafe path: ${path}` } } };
    const target = join(root, path);
    let targetReal;
    try {
      targetReal = await deps.fs.realpath(target);
    } catch {
      continue;
    }
    if (targetReal !== rootReal && !targetReal.startsWith(rootReal + sep)) {
      return { ok: false, result: { ok: false, error: { code: "invalid-path", message: `path escapes repository: ${path}` } } };
    }
    if (await looksLikeRepository(deps, target)) {
      const code = removedCount === 0 ? "nested-repo" : "nested-repo-partial";
      const detail = removedCount === 0 ? "" : `; ${removedCount} path(s) already removed`;
      return { ok: false, result: { ok: false, error: { code, message: `repository directory: ${path}${detail}` } } };
    }
    try {
      await deps.fs.remove(target);
      removedCount += 1;
    } catch (e) {
      failures.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (failures.length > 0) {
    const skipped = tracked.length > 0 ? `; ${tracked.length} tracked path(s) not restored` : "";
    return {
      ok: false,
      result: { ok: false, error: { code: "git-error", message: `could not discard ${failures.length} path(s): ${failures.join("; ")}${skipped}` } }
    };
  }
  return { ok: true, remainingTracked: tracked };
}
export {
  classifyActionFailure,
  isSafePath,
  planAction,
  runAction,
  scrubCredentials
};
