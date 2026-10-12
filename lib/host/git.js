import { readFile } from "node:fs/promises";
function createGitRunner(subprocess, timeoutMs, maxBytes) {
  const spillMaxBytes = maxBytes * 16;
  return {
    async run(argv, opts) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const signal = opts.signal === void 0 ? controller.signal : AbortSignal.any([controller.signal, opts.signal]);
        const handle = subprocess.spawn({
          argv,
          cwd: opts.cwd,
          // Never let a network command (fetch/pull) block on an interactive
          // credential or host-key prompt: with stdin ignored git would hang
          // until the timeout. GIT_TERMINAL_PROMPT=0 makes it fail fast instead,
          // and is harmless for the non-network commands that share this runner.
          env: { GIT_TERMINAL_PROMPT: "0" },
          stdio: {
            stdin: opts.stdinData === void 0 ? "ignore" : { data: opts.stdinData },
            stdout: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } },
            stderr: { collect: { maxBytes, spill: { maxBytes: spillMaxBytes } } }
          },
          graceMs: 200,
          signal
        });
        let outcome;
        try {
          outcome = await handle.done;
        } catch (error) {
          const cancelled2 = opts.signal?.aborted === true && !controller.signal.aborted;
          if (controller.signal.aborted || opts.signal?.aborted === true) {
            return { exitCode: null, stdout: "", stderr: "", timedOut: !cancelled2, cancelled: cancelled2, stdoutLossy: false };
          }
          throw error;
        }
        const stdout = handle.collected.stdout?.readFrom(0);
        const stderr = handle.collected.stderr?.readFrom(0);
        const resolved = await resolveStdout(stdout);
        const cancelled = opts.signal?.aborted === true && !controller.signal.aborted;
        return {
          exitCode: outcome.exitCode,
          stdout: resolved.text,
          stderr: stderr?.text ?? "",
          timedOut: controller.signal.aborted,
          cancelled,
          stdoutLossy: resolved.lossy
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
async function resolveStdout(read) {
  if (read === void 0) return { text: "", lossy: false };
  if (!read.lossy || read.spillPath === void 0) return { text: read.text, lossy: read.lossy };
  try {
    return { text: await readFile(read.spillPath, "utf8"), lossy: false };
  } catch {
    return { text: read.text, lossy: true };
  }
}
export {
  createGitRunner
};
