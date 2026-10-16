#!/usr/bin/env node
// Checks prompt packs. Usage: node scripts/validate.cjs [data/pack-x.js ...]
// With no arguments it checks every data/pack-*.js.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const M = require("../js/match.js");

const dataDir = path.join(__dirname, "..", "data");
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(dataDir).filter(f => /^pack-.*\.js$/.test(f)).map(f => path.join(dataDir, f));

let errors = 0, warnings = 0, total = 0;
const seenIds = new Map();
const err = (where, msg) => { errors++; console.log(`ERROR ${where}: ${msg}`); };
const warn = (where, msg) => { warnings++; console.log(`warn  ${where}: ${msg}`); };

for (const file of files) {
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
  } catch (e) {
    err(file, "does not run: " + e.message);
    continue;
  }
  const packs = sandbox.window.FATHOM_PACKS || [];
  if (!packs.length) err(file, "pushes nothing to window.FATHOM_PACKS");
  for (const pack of packs) {
    if (!pack.pack || !pack.title || !Array.isArray(pack.prompts)) {
      err(file, "pack needs pack, title, prompts");
      continue;
    }
    for (const p of pack.prompts) {
      total++;
      const where = `${path.basename(file)} ${p.id || "(no id)"}`;
      if (!p.id || !/^[a-z]+-\d{3}$/.test(p.id)) err(where, "id must look like geo-001");
      if (seenIds.has(p.id)) err(where, "duplicate id (also in " + seenIds.get(p.id) + ")");
      seenIds.set(p.id, path.basename(file));
      if (!p.q || typeof p.q !== "string") err(where, "missing q");
      if (!Array.isArray(p.a)) { err(where, "missing a"); continue; }
      if (p.a.length < 20) err(where, `only ${p.a.length} answers (need 20+)`);

      const tiers = [0, 0, 0, 0, 0, 0];
      const owner = new Map();
      p.a.forEach((e, i) => {
        if (!Array.isArray(e) || typeof e[0] !== "string" || !Number.isInteger(e[1]) || e[1] < 1 || e[1] > 5) {
          err(where, `bad entry ${JSON.stringify(e)}`);
          return;
        }
        if (e.slice(2).some(x => typeof x !== "string")) err(where, `non-string alias in ${e[0]}`);
        tiers[e[1]]++;
        for (const label of [e[0], ...e.slice(2)]) {
          const k = M.norm(label);
          if (!k) { err(where, `empty label in ${e[0]}`); continue; }
          if (owner.has(k) && owner.get(k) !== i) {
            err(where, `"${label}" collides with "${p.a[owner.get(k)][0]}"`);
          }
          owner.set(k, i);
        }
      });
      if (tiers[1] < 1 || tiers[1] > 4) err(where, `tier 1 should have 1-4 answers, has ${tiers[1]}`);
      if (tiers[2] < 2) warn(where, `tier 2 has only ${tiers[2]}`);
      if (tiers[4] + tiers[5] < 8) err(where, `needs 8+ answers in tiers 4-5, has ${tiers[4] + tiers[5]}`);

      // Typo matching is ambiguous when two different answers are a typo apart.
      const labels = [...owner.entries()];
      for (let x = 0; x < labels.length; x++) {
        for (let y = x + 1; y < labels.length; y++) {
          const [a, ia] = labels[x], [b, ib] = labels[y];
          if (ia === ib) continue;
          if (M.typoCost(a, b) < Infinity || M.typoCost(b, a) < Infinity) {
            warn(where, `"${a}" and "${b}" are within typo distance; a misspelling may match neither`);
          }
        }
      }
    }
  }
}

console.log(`\n${files.length} file(s), ${total} prompts, ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
