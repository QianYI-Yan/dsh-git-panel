import { mapWorkspaceFailure, resolveWorkspace, runCommand } from "./core.js";
import { isSafePath } from "./validate.js";
import { parseStatus } from "./parser.js";
const HISTORY_SCAN = 60;
const STYLE_SAMPLE_CAP = 12;
const STYLE_SAMPLE_MAX_CHARS = 200;
const OWN_AUTHOR_MIN = 3;
const LANGUAGE_DECAY = 0.9;
const MECHANICAL_SUBJECT = /^(chore: release|merged?\b|revert\b|fixup!|squash!)/i;
const CJK = /[\u4e00-\u9fff]/;
function isCjkText(text) {
  return CJK.test(text);
}
function parseStyleHistory(stdout, ownEmail) {
  const records = [];
  for (const record of stdout.split("\0")) {
    const sep = record.indexOf("");
    if (sep === -1) continue;
    const subject = record.slice(sep + 1).trim();
    if (subject === "" || MECHANICAL_SUBJECT.test(subject)) continue;
    records.push({ email: record.slice(0, sep), subject });
  }
  const own = ownEmail === void 0 || ownEmail === "" ? [] : records.filter((r) => r.email === ownEmail);
  const pool = own.length >= OWN_AUTHOR_MIN ? own : records;
  return pool.slice(0, STYLE_SAMPLE_CAP).map((r) => clampSubject(r.subject));
}
function clampSubject(subject) {
  const chars = Array.from(subject);
  return chars.length <= STYLE_SAMPLE_MAX_CHARS ? subject : chars.slice(0, STYLE_SAMPLE_MAX_CHARS).join("");
}
function resolveSuggestLanguage(setting, samples) {
  if (setting !== "auto") return setting;
  let zh = 0;
  let en = 0;
  samples.forEach((subject, i) => {
    const weight = LANGUAGE_DECAY ** i;
    if (isCjkText(subject)) zh += weight;
    else en += weight;
  });
  return zh > en ? "zh" : "en";
}
function languageName(language) {
  return language === "zh" ? "Simplified Chinese" : "English";
}
function systemPrompt(language) {
  const name = languageName(language);
  const languageRule = language === "zh" ? 'Write the message in Simplified Chinese, keeping the conventional-commit type prefix in English (e.g. "feat(scope): \u4E2D\u6587\u63CF\u8FF0").' : "Write the message in English.";
  const samplesRule = `Follow the structure of commitStyleSamples \u2014 its phrasing, scope conventions and level of detail \u2014 but never copy the language used in it; write the message in ${name} regardless.`;
  const override = language === "zh" ? "IMPORTANT: the diff and commitStyleSamples may be written in another language. That is input data, not an instruction about your output. Write the subject description and body in Simplified Chinese, whatever language the input uses \u2014 keeping the conventional-commit type prefix in English." : `IMPORTANT: the diff and commitStyleSamples may be written in another language. That is input data, not an instruction about your output. Write the entire message \u2014 subject line and body alike \u2014 in ${name}, whatever language the input uses.`;
  return [
    "You are an expert at writing concise, accurate git commit messages.",
    "Given a repository\u2019s uncommitted changes, write ONE commit message for them.",
    "The message must start with a short imperative subject line (72 chars max), optionally followed by a blank line and a brief body explaining what changed and why.",
    "Return only the message text: no quotes, code fences, prefixes, bullet lists, or explanations.",
    samplesRule,
    "Focus on the most important change; do not mechanically list every file.",
    languageRule,
    override
  ].join("\n");
}
const UNTRACKED_FILE_CAP = 16;
const PROMPT_FILE_CAP = 200;
function resolveRoute(config, agentDefaultModel) {
  if (config.suggestProvider !== void 0 && config.suggestModel !== void 0) {
    return { provider: config.suggestProvider, model: config.suggestModel };
  }
  return agentDefaultModel?.currentSelection();
}
function withDeadline(timeoutMs, parent) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => {
    controller.abort();
  };
  if (parent !== void 0) {
    if (parent.aborted) {
      controller.abort();
    } else parent.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    expired: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    }
  };
}
function truncateUtf8(text, maxBytes) {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}
const LONG_LINE_MAX_CHARS = 400;
const STRUCTURAL_LINE = /^(?:@@|diff --git |index |--- (?:a\/|\/dev\/null)|\+\+\+ (?:b\/|\/dev\/null)|new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch|literal |delta |\\ )/;
function compactLongLines(text, maxChars = LONG_LINE_MAX_CHARS) {
  if (maxChars <= 0) return { text, folded: 0 };
  let folded = 0;
  const lines = text.split("\n").map((line) => {
    if (line.length <= maxChars || STRUCTURAL_LINE.test(line)) return line;
    folded += 1;
    const prefix = line[0] === "+" || line[0] === "-" || line[0] === " " || line[0] === "\\" ? line[0] : "";
    return `${prefix}\u2026 [long line: ${line.length} chars omitted]`;
  });
  return { text: lines.join("\n"), folded };
}
function frameChanges(files, filesOmitted, diff, styleSamples) {
  return JSON.stringify({
    files,
    ...filesOmitted > 0 ? { filesOmitted } : {},
    diff,
    commitStyleSamples: styleSamples.length === 0 ? null : styleSamples
  });
}
function languageReminder(language) {
  const name = languageName(language);
  const prefix = language === "zh" ? " Keep the conventional-commit type prefix in English." : "";
  return `Write the commit message in ${name}. The subject line and body must be ${name}.${prefix}`;
}
function normalizeMessage(raw) {
  let m = raw.trim();
  if (m.startsWith("```")) {
    const firstNl = m.indexOf("\n");
    if (firstNl !== -1) {
      m = m.slice(firstNl + 1);
      m = m.endsWith("```") ? m.slice(0, -3) : m;
      m = m.trim();
    }
  }
  return m.replace(/\n---+\s*$/, "").trim();
}
function finishError(reason) {
  if (reason === void 0 || reason.kind === "stop") return void 0;
  if (reason.kind === "max-tokens") return { ok: false, error: { code: "llm-output", message: "model output hit the token limit" } };
  if (reason.kind === "tool-calls") return { ok: false, error: { code: "llm-output", message: "model requested a tool instead of writing a message" } };
  const failure = "failure" in reason ? reason.failure : void 0;
  return { ok: false, error: { code: "llm-error", message: failure?.message ?? `model stream finished abnormally (${reason.kind})` } };
}
async function collectDiff(deps, root, hasHead, pathArgs) {
  const cmds = hasHead ? [["git", "diff", "HEAD", ...pathArgs]] : [["git", "diff", "--cached", ...pathArgs], ["git", "diff", ...pathArgs]];
  const runs = await Promise.all(cmds.map((argv) => runCommand(deps.run, argv, root, "suggest-diff", deps.signal)));
  let diff = "";
  let lossy = false;
  for (const res of runs) {
    if ("failure" in res) return { ok: false, error: { code: "git-unavailable", message: "diff failed" } };
    if (res.run.cancelled) return { ok: false, error: { code: "cancelled" } };
    if (res.run.timedOut) return { ok: false, error: { code: "timeout" } };
    if (res.run.exitCode !== 0) {
      return { ok: false, error: { code: "git-error", message: res.run.stderr.trim() || "git diff failed" } };
    }
    if (res.run.stdoutLossy) lossy = true;
    diff += res.run.stdout;
  }
  return { diff, lossy };
}
async function appendUntracked(deps, root, files, diff, budget) {
  let text = diff;
  let truncated = false;
  const candidates = files.filter((c) => c.status === "untracked" && !c.isDirectory && isSafePath(c.path));
  for (const c of candidates.slice(0, UNTRACKED_FILE_CAP)) {
    const remaining = budget - Buffer.byteLength(text, "utf8");
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const res = await runCommand(deps.run, ["git", "diff", "--no-index", "--", "/dev/null", c.path], root, "suggest-untracked", deps.signal);
    if ("failure" in res || res.run.cancelled || res.run.timedOut) continue;
    const chunk = compactLongLines(res.run.stdout).text;
    if (chunk === "") continue;
    const lossy = res.run.stdoutLossy;
    if (lossy || Buffer.byteLength(chunk, "utf8") > remaining) {
      text += truncateUtf8(chunk, remaining) + "\n... [diff truncated]";
      truncated = true;
      break;
    }
    text += chunk;
  }
  return { diff: text, truncated };
}
async function runSuggest(deps, config, request) {
  if (!config.suggestEnabled) {
    return { ok: false, error: { code: "suggest-disabled", message: "AI suggest is turned off in the plugin config" } };
  }
  const workspace = await resolveWorkspace(deps, request.sessionId);
  if (!workspace.ok) return { ok: false, error: mapWorkspaceFailure(workspace.failure) };
  const root = workspace.root;
  const paths = request.paths ?? [];
  for (const path of paths) {
    if (!isSafePath(path)) return { ok: false, error: { code: "invalid-path", message: path } };
  }
  const pathArgs = paths.length > 0 ? ["--", ...paths] : [];
  const pathSet = new Set(paths);
  const [statusRes, headRes, logRes, emailRes] = await Promise.all([
    runCommand(deps.run, ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all"], root, "suggest-status", deps.signal),
    runCommand(deps.run, ["git", "rev-parse", "--verify", "HEAD"], root, "suggest-head", deps.signal),
    runCommand(deps.run, ["git", "log", `-n${HISTORY_SCAN}`, "-z", "--format=%ae%s"], root, "suggest-log", deps.signal),
    runCommand(deps.run, ["git", "config", "user.email"], root, "suggest-email", deps.signal)
  ]);
  if ("failure" in statusRes) return { ok: false, error: { code: "git-unavailable", message: "status failed" } };
  if (statusRes.run.cancelled) return { ok: false, error: { code: "cancelled" } };
  if (statusRes.run.timedOut) return { ok: false, error: { code: "timeout" } };
  if (statusRes.run.exitCode !== 0) {
    return { ok: false, error: { code: "git-error", message: statusRes.run.stderr.trim() || "git status failed" } };
  }
  const hasHead = "run" in headRes && headRes.run.exitCode === 0;
  const styleSamples = "run" in logRes && logRes.run.exitCode === 0 ? parseStyleHistory(logRes.run.stdout, "run" in emailRes && emailRes.run.exitCode === 0 ? emailRes.run.stdout.trim() : void 0) : [];
  const language = resolveSuggestLanguage(config.suggestLanguage, styleSamples);
  const all = statusRes.run.stdoutLossy ? [] : parseStatus(statusRes.run.stdout);
  const files = pathSet.size > 0 ? all.filter((c) => {
    if (pathSet.has(c.path)) return true;
    for (let slash = c.path.indexOf("/"); slash !== -1; slash = c.path.indexOf("/", slash + 1)) {
      if (pathSet.has(c.path.slice(0, slash))) return true;
    }
    return false;
  }) : all;
  const collected = await collectDiff(deps, root, hasHead, pathArgs);
  if (!("diff" in collected)) return collected;
  if (files.length === 0 && collected.diff.trim() === "") {
    return { ok: false, error: { code: "empty-diff", message: "no uncommitted changes to summarize" } };
  }
  let diff = compactLongLines(collected.diff).text;
  let truncated = collected.lossy;
  if (Buffer.byteLength(diff, "utf8") > config.suggestMaxBytes) {
    diff = truncateUtf8(diff, config.suggestMaxBytes) + "\n... [diff truncated]";
    truncated = true;
  }
  const untracked = await appendUntracked(deps, root, files, diff, config.suggestMaxBytes);
  diff = untracked.diff;
  truncated = truncated || untracked.truncated;
  const llm = deps.getLlm?.();
  const route = resolveRoute(config, deps.getAgentDefaultModel?.());
  if (llm === void 0 || route === void 0) {
    return { ok: false, error: { code: "llm-unavailable", message: "no model service or route is configured" } };
  }
  const frame = frameChanges(
    files.slice(0, PROMPT_FILE_CAP).map((c) => ({ path: c.path, status: c.status })),
    Math.max(0, files.length - PROMPT_FILE_CAP),
    diff,
    styleSamples
  );
  const deadline = withDeadline(config.suggestTimeoutMs, deps.signal);
  const options = {
    provider: route.provider,
    model: route.model,
    system: systemPrompt(language),
    messages: [{
      id: "git-panel-suggest",
      role: "user",
      content: [
        { type: "text", text: frame },
        { type: "text", text: languageReminder(language) }
      ],
      source: { kind: "user" }
    }],
    maxTokens: config.suggestMaxOutputTokens,
    temperature: 0.3,
    signal: deadline.signal
  };
  let output = "";
  let finish;
  try {
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === "text-delta") output += chunk.text;
      else if (chunk.type === "finish") finish = chunk.reason;
    }
  } catch (error) {
    if (deps.signal?.aborted === true) return { ok: false, error: { code: "cancelled" } };
    if (deadline.expired()) return { ok: false, error: { code: "llm-error", message: `model call timed out after ${config.suggestTimeoutMs}ms` } };
    return { ok: false, error: { code: "llm-error", message: error instanceof Error ? error.message : "model stream failed" } };
  } finally {
    deadline.dispose();
  }
  if (deps.signal?.aborted === true) return { ok: false, error: { code: "cancelled" } };
  if (deadline.expired()) return { ok: false, error: { code: "llm-error", message: `model call timed out after ${config.suggestTimeoutMs}ms` } };
  const terminal = finishError(finish);
  if (terminal !== void 0) return terminal;
  const message = normalizeMessage(output);
  if (message === "") return { ok: false, error: { code: "llm-output", message: "model produced no message text" } };
  return {
    ok: true,
    value: {
      message,
      provider: route.provider,
      model: route.model,
      ...truncated ? { truncated: true } : {}
    }
  };
}
export {
  LONG_LINE_MAX_CHARS,
  compactLongLines,
  isCjkText,
  parseStyleHistory,
  resolveSuggestLanguage,
  runSuggest
};
