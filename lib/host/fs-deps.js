import { lstat, readdir, readFile, readlink, realpath, rm, stat } from "node:fs/promises";
function createFsDeps() {
  return {
    realpath,
    stat: async (p) => stat(p),
    readFile,
    symlinkTarget: async (p) => {
      try {
        return (await lstat(p)).isSymbolicLink() ? await readlink(p) : null;
      } catch {
        return null;
      }
    },
    readdir: async (p) => (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory() })),
    // Untracked entries include whole directories (porcelain collapses `?? dir/`
    // into one entry) and a plain `rm` fails EISDIR on them; the caller
    // realpath-contains every target inside the repo root before removing.
    remove: async (p) => {
      await rm(p, { recursive: true, force: true });
    }
  };
}
export {
  createFsDeps
};
