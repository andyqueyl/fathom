#!/usr/bin/env node
// Typo-tolerance audit: feeds every answer from every OTHER prompt into each prompt
// and lists the ones that fuzzy-match (not exact-match) something. Each hit is either
// a fair alternate spelling or a wrong answer that would score. Usage: node scripts/false-matches.cjs
const fs = require("fs"), path = require("path"), vm = require("vm");
const M = require("../js/match.js");
const dir = path.join(__dirname, "..", "data");
const w = { window: {} };
for (const f of fs.readdirSync(dir).filter(f => /^pack-.*\.js$/.test(f))) vm.runInNewContext(fs.readFileSync(path.join(dir, f), "utf8"), w);
const prompts = w.window.FATHOM_PACKS.flatMap(p => p.prompts);
const labels = new Set();
for (const p of prompts) for (const e of p.a) for (const l of [e[0], ...e.slice(2)]) labels.add(l);
let hits = 0;
for (const p of prompts) {
  const idx = M.index(p);
  for (const l of labels) {
    if (M.keys(l).some(k => idx.exact.has(k))) continue;
    const i = M.match(p, l, idx);
    if (i >= 0) { hits++; console.log(`${p.id}\t"${l}" -> "${p.a[i][0]}"`); }
  }
}
console.log(`\n${hits} fuzzy hits`);
