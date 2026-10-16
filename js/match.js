// Answer matching. Shared by the game (browser) and the scripts (Node).
(function (root) {
  // "Toy Story II", "Toy Story Two" and "Toy Story 2" all normalise to the same thing.
  const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13,
    xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20 };
  const ORD_WORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20 };
  const ORDINAL = /^(\d+)(st|nd|rd|th)$/;
  function numerals(n) {
    // Roman numerals only count after another word ("Rocky IV"), so a bare "I" or "Xi" stays a word.
    return n.split(" ")
      .map((w, k) => NUM_WORDS[w] || (k > 0 && ROMAN[w]) || ORD_WORDS[w] || (ORDINAL.test(w) ? w.replace(ORDINAL, "$1") : w))
      .join(" ")
      .replace(/ the (\d+)\b/g, " $1"); // "Henry the Eighth" = "Henry VIII"
  }

  function norm(s) {
    return numerals(normText(s));
  }

  function normText(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/['\u2018\u2019`]/g, "") // "Lay's" = "Lays"
      .replace(/&/g, " and ")
      .replace(/\+\+/g, " plus plus ")
      .replace(/#/g, " sharp ")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^(the|a|an) /, "");
  }

  // Loose plural handling: "apples" and "apple" share a key.
  function keys(s) {
    const n = norm(s);
    const out = [n];
    if (n.length > 3 && n.endsWith("es")) out.push(n.slice(0, -2));
    if (n.length > 3 && n.endsWith("s")) out.push(n.slice(0, -1));
    return out;
  }

  // QWERTY positions, so a slipped finger costs less than a different word.
  const POS = {};
  ["qwertyuiop", "asdfghjkl", "zxcvbnm"].forEach((row, y) =>
    [...row].forEach((c, x) => { POS[c] = [x + [0, 0.25, 0.75][y], y]; }));
  function nearKeys(a, b) {
    const p = POS[a], q = POS[b];
    return !!(p && q) && Math.abs(p[0] - q[0]) <= 1 && Math.abs(p[1] - q[1]) <= 1;
  }

  // Edit distance where insert, delete, swap of neighbours and a neighbouring-key
  // substitution cost 1, and any other substitution costs 2.
  function editCost(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 99;
    const d = [];
    for (let i = 0; i <= a.length; i++) d.push([i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const sub = a[i - 1] === b[j - 1] ? 0 : nearKeys(a[i - 1], b[j - 1]) ? 1 : 2;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        }
      }
    }
    return d[a.length][b.length];
  }

  // Strict on purpose: a rejected guess can be retyped while the clock runs,
  // but a wrong answer that sneaks through ("Bulls" for "Bills") can't be undone.
  function typoAllowance(len) {
    if (len <= 5) return 0;
    if (len <= 9) return 1;
    return 2;
  }

  // Numbers must agree exactly: "Shrek 5" is not "Shrek 2". (norm already turned
  // roman numerals and number words into digits.)
  const numbers = x => x.replace(/[^0-9 ]/g, "").replace(/\s+/g, " ").trim();

  // How far a normalised guess is from a normalised label, or Infinity if it's
  // too far to be a typo. Each word must keep its first letter, short words must
  // be exact, and each word gets its own allowance.
  function typoCost(g, label) {
    if (g === label) return 0;
    if (numbers(g) !== numbers(label)) return Infinity;
    const gw = g.split(" "), lw = label.split(" ");
    if (gw.length !== lw.length) {
      // Allow a missing or extra space ("icecream"), judged on the whole thing.
      const a = gw.join(""), b = lw.join("");
      if (a[0] !== b[0]) return Infinity;
      const c = a === b ? 1 : editCost(a, b) + 1;
      return c <= typoAllowance(Math.min(a.length, b.length)) ? c : Infinity;
    }
    let total = 0;
    for (let k = 0; k < gw.length; k++) {
      const a = gw[k], b = lw[k];
      if (a === b) continue;
      if (a[0] !== b[0]) return Infinity;
      const c = editCost(a, b);
      // Two swapped letters ("balck") is the classic typo; allow it from 5 letters.
      const swap = c === 1 && a.length === b.length && a.length >= 5 && [...a].sort().join("") === [...b].sort().join("");
      if (c > typoAllowance(Math.min(a.length, b.length)) && !swap) return Infinity;
      total += c;
    }
    return total <= typoAllowance(Math.min(g.length, label.length)) ? total : Infinity;
  }

  // Build a lookup for one prompt. Entry format: [canonical, tier, ...aliases]
  function index(prompt) {
    const exact = new Map();
    const all = [];
    prompt.a.forEach((entry, i) => {
      const [name, , ...aliases] = entry;
      for (const label of [name, ...aliases]) {
        for (const k of keys(label)) {
          if (!exact.has(k)) exact.set(k, i);
        }
        all.push([norm(label), i]);
      }
    });
    return { exact, all };
  }

  // Returns the index of the matched answer, or -1.
  function match(prompt, guess, idx) {
    idx = idx || index(prompt);
    const ks = keys(guess);
    for (const k of ks) if (idx.exact.has(k)) return idx.exact.get(k);
    const g = ks[0];
    if (!g) return -1;
    let best = Infinity, hit = -1, tie = false;
    for (const [label, i] of idx.all) {
      if (label[0] !== g[0]) continue;
      const c = typoCost(g, label);
      if (c < best) { best = c; hit = i; tie = false; }
      else if (c === best && i !== hit) tie = true;
    }
    return best < Infinity && !tie ? hit : -1;
  }

  const api = { norm, keys, editCost, typoAllowance, typoCost, index, match };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FathomMatch = api;
})(this);
