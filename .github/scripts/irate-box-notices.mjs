// Third-party notices for an Irate-Box bundle: every package installed under node_modules
// (npm, yarn or pnpm's .pnpm store), each once, with its license and its license file's text.
// Bundlers also take from devDependencies, so this lists a superset of what the bundle holds.
//   node notices.mjs [node_modules dir] > THIRD-PARTY-NOTICES.txt
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "node_modules");
const seen = new Map();

function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function licenseText(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return "";
  }
  const file = names.find((n) => /^(licen[cs]e|copying)(\.|$|-)/i.test(n));
  return file ? fs.readFileSync(path.join(dir, file), "utf8").trim() : "";
}

function visit(dir, depth) {
  if (depth > 12) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!(e.isDirectory() || e.isSymbolicLink()) || e.name === ".bin" || e.name === ".cache") continue;
    const full = path.join(dir, e.name);
    if (e.name.startsWith("@") || e.name === ".pnpm") {
      visit(full, depth + 1);
      continue;
    }
    if (dir.endsWith(`${path.sep}.pnpm`)) {
      visit(path.join(full, "node_modules"), depth + 1); // .pnpm/<name>@<ver>/node_modules/<name>
      continue;
    }
    let real;
    try {
      real = fs.realpathSync(full);
    } catch {
      continue;
    }
    const pkg = readPkg(real);
    if (pkg && pkg.name && pkg.version && !pkg.private) {
      const key = `${pkg.name}@${pkg.version}`;
      if (!seen.has(key)) {
        const lic = typeof pkg.license === "string" ? pkg.license
          : pkg.license?.type || (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type || l).join(" OR ") : "UNKNOWN");
        seen.set(key, { lic, repo: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url || "", text: licenseText(real) });
      }
    }
    visit(path.join(real, "node_modules"), depth + 1);
  }
}

visit(root, 0);
const keys = [...seen.keys()].sort();
const counts = {};
for (const k of keys) counts[seen.get(k).lic] = (counts[seen.get(k).lic] || 0) + 1;
console.log(`${keys.length} packages. Licenses: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(", ")}\n`);
for (const k of keys) {
  const { lic, repo, text } = seen.get(k);
  console.log(`=== ${k}  (${lic})${repo ? `  ${repo}` : ""}`);
  console.log(text ? `${text}\n` : "(no license file in the package; its package.json declares the license above)\n");
}
