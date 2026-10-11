import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const root = new URL("../vendor/", import.meta.url);
const provenance = JSON.parse(
  await readFile(new URL("provenance.json", root), "utf8"),
);
const actual = createHash("sha256")
  .update(await readFile(new URL(provenance.filename, root)))
  .digest("hex");
if (actual !== provenance.sha256)
  throw new Error("Vendored Vane tarball does not match its reviewed SHA-256.");
console.log(`${provenance.package}@${provenance.version}: ${actual}`);
