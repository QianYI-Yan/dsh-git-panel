import { runCommand } from "./core.js";
const HISTORY_TOPOLOGY_LIMIT = 1e4;
const HISTORY_TOPOLOGY_MAX_BYTES = 2 * 1024 * 1024;
const FULL_HASH = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
function parseGraphNodes(stdout) {
  if (stdout === "") return [];
  if (Buffer.byteLength(stdout, "utf8") > HISTORY_TOPOLOGY_MAX_BYTES) return null;
  if (!stdout.endsWith("\n")) return null;
  const lines = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line !== "") lines.push(line);
  }
  if (lines.length > HISTORY_TOPOLOGY_LIMIT) return null;
  const nodes = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of lines) {
    const fields = line.split(" ");
    const hash = fields[0];
    if (hash === void 0 || !FULL_HASH.test(hash)) return null;
    const parents = [];
    for (const parent of fields.slice(1)) {
      if (!FULL_HASH.test(parent)) return null;
      parents.push(parent);
    }
    if (seen.has(hash)) continue;
    seen.add(hash);
    nodes.push({ hash, parents });
  }
  return nodes;
}
async function walkHistoryTopology(runner, root, seeds, signal) {
  const safeSeeds = seeds.filter((seed) => FULL_HASH.test(seed));
  if (safeSeeds.length === 0) return [];
  const argv = [
    "git",
    "rev-list",
    "--parents",
    `--max-count=${HISTORY_TOPOLOGY_LIMIT}`,
    "--end-of-options",
    ...safeSeeds
  ];
  const res = await runCommand(runner, argv, root, "history-topology", signal);
  if (!("run" in res)) return [];
  const { run } = res;
  if (run.cancelled || run.timedOut || run.exitCode !== 0 || run.stdoutLossy) return [];
  if (Buffer.byteLength(run.stdout, "utf8") > HISTORY_TOPOLOGY_MAX_BYTES) return [];
  return parseGraphNodes(run.stdout) ?? [];
}
export {
  HISTORY_TOPOLOGY_LIMIT,
  HISTORY_TOPOLOGY_MAX_BYTES,
  parseGraphNodes,
  walkHistoryTopology
};
