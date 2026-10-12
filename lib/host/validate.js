import { isAbsolute, normalize } from "node:path";
function isSafePath(path) {
  if (path === "" || isAbsolute(path)) return false;
  const norm = normalize(path);
  if (norm === ".." || norm.startsWith("../") || norm.startsWith("..\\")) return false;
  return true;
}
const REV_META = /[\x00-\x20\x7f~^:?*[\\]/;
function isSafeRev(input) {
  if (input === "" || input.startsWith("-")) return false;
  if (REV_META.test(input)) return false;
  if (input.includes("..") || input.includes("@{")) return false;
  return true;
}
function isSafeBranchName(name) {
  return isSafeRev(name) && !name.startsWith("/");
}
function isSafeRemoteName(name) {
  return /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name) && name.length <= 128;
}
export {
  isSafeBranchName,
  isSafePath,
  isSafeRemoteName,
  isSafeRev
};
