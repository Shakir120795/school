// Icons ship as base64 text in icon-src/ (the repo channel is text-only);
// decode them into public/icons/ before every build.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });
for (const name of ["icon-192.png", "icon-512.png", "maskable-512.png", "apple-touch-icon.png"]) {
  const b64 = readFileSync(join(root, "icon-src", `${name}.b64`), "utf8").trim();
  writeFileSync(join(out, name), Buffer.from(b64, "base64"));
}
console.log("icons decoded to public/icons/");
