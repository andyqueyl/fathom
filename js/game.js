(function () {
  "use strict";

  // ---------- constants ----------
  const ROUNDS = 7;
  const SECONDS = 25;
  const POINTS = [0, 10, 30, 50, 75, 100];
  const TIER = ["Missed", "Common", "Popular", "Decent", "Rare", "Abyssal"];
  // Estimates, not measurements (see README). Labelled "est." wherever shown.
  const SHARE_EST = ["", "over 15%", "5-15%", "2-5%", "0.5-2%", "under 0.5%"];
  const SHARE_SQ = ["⬛", "🟦", "🟩", "🟨", "🟧", "🟥"];
  const METRES_PER_POINT = 10;
  const MAX_DEPTH = ROUNDS * 100 * METRES_PER_POINT; // 7000 m
  const EPOCH = Date.UTC(2026, 9, 15); // Dive #1 = 15 Oct 2026
  const STORE = "fathom:v1";

  // Depth markers shown on the gauge and as you sink. Real figures, rounded.
  // The third field marks the ones drawn on the gauge (the rest would overlap).
  const MARKS = [
    [40, "recreational scuba limit"],
    [200, "TWILIGHT ZONE · sunlight fades out", 1],
    [332, "deepest scuba dive on record"],
    [560, "emperor penguins have dived this far"],
    [1000, "MIDNIGHT ZONE · no sunlight at all", 1],
    [2250, "sperm whales hunt squid down here", 1],
    [2992, "deepest dive by any mammal (a beaked whale)", 1],
    [3688, "the ocean's average depth"],
    [3800, "the Titanic lies here"],
    [4000, "ABYSSAL ZONE · near-freezing and pitch black", 1],
    [5000, "most of the seafloor is this deep or less", 1],
    [6000, "HADAL ZONE · trenches only", 1],
    [7000, "the trench floor · a perfect dive", 1],
  ];
  const ZONES = [
    [0, "Sunlight zone"], [200, "Twilight zone"], [1000, "Midnight zone"],
    [4000, "Abyssal zone"], [6000, "Hadal zone"],
  ];
  const PACK_BLURB = {
    geo: "Countries, capitals, rivers, landmarks",
    sci: "Animals, elements, the body, space",
    pop: "Characters, franchises, books",
    life: "Food, drink, clothes, around the house",
    mix: "Sports, history, myths",
    music: "Songs, bands, artists",
    screen: "Movies, shows, actors",
    games: "Video games and board games",
    brand: "Brands, stores, menus, mascots",
    word: "Words, anagrams, language",
    people: "Artists, inventors, leaders",
  };

  // ---------- data ----------
  const PACKS = (window.FATHOM_PACKS || []).slice().sort((a, b) => a.title.localeCompare(b.title));
  const PROMPTS = new Map();
  for (const pack of PACKS) {
    for (const p of pack.prompts) PROMPTS.set(p.id, Object.assign({ pack: pack.pack, packTitle: pack.title }, p));
  }
  const IDS = [...PROMPTS.keys()].sort();
  const ANSWERS = [...PROMPTS.values()].reduce((n, p) => n + p.a.length, 0);
  const indexCache = new Map();
  const idx = p => {
    if (!indexCache.has(p.id)) indexCache.set(p.id, FathomMatch.index(p));
    return indexCache.get(p.id);
  };

  // ---------- storage (best effort; the game works without it) ----------
  const blank = () => ({ daily: {}, practice: [], seen: {}, flags: [], intro: false });
  function load() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(STORE)) || {}); }
    catch (e) { return blank(); }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }
  const state = load();

  // ---------- seeded randomness ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- daily schedule ----------
  function todayNumber() {
    const d = new Date();
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000) + 1;
  }
  function diveDate(n) {
    return new Date(EPOCH + (n - 1) * 86400000).toLocaleDateString(undefined, { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  }
  // Walk through a shuffled deck of every prompt, 7 per day; reshuffle each cycle.
  function diveIds(n) {
    const perCycle = Math.max(1, Math.floor(IDS.length / ROUNDS));
    const cycle = Math.floor((n - 1) / perCycle);
    const pos = (n - 1) % perCycle;
    const deck = shuffle(IDS, mulberry32(7919 + cycle * 104729));
    return deck.slice(pos * ROUNDS, pos * ROUNDS + ROUNDS);
  }
  // Practice modes skip this week's dailies so they stay fresh, and prefer unseen prompts.
  function practiceIds(pool) {
    const today = todayNumber();
    const reserved = new Set();
    for (let n = today; n < today + 7; n++) diveIds(n).forEach(id => reserved.add(id));
    let ids = pool.filter(id => !reserved.has(id));
    if (ids.length < ROUNDS) ids = pool.slice();
    const unseen = ids.filter(id => !state.seen[id]);
    const pick = shuffle(unseen, Math.random).slice(0, ROUNDS);
    if (pick.length < ROUNDS) {
      const rest = shuffle(ids.filter(id => !pick.includes(id)), Math.random);
      pick.push(...rest.slice(0, ROUNDS - pick.length));
    }
    return pick;
  }
  function streak() {
    const today = todayNumber();
    let s = 0;
    for (let n = today; n >= 1; n--) {
      if (state.daily[n] && state.daily[n].done) s++;
      else if (n !== today) break;
    }
    return s;
  }
  function untilMidnight() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(1, Math.ceil((next - now) / 60000));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  // ---------- DOM helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $("#app");
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtM = m => m.toLocaleString() + " m";
  function zoneAt(m) {
    let z = ZONES[0][1];
    for (const [d, name] of ZONES) if (m >= d) z = name;
    return z;
  }

  // ---------- motion ----------
  const calm = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fx = {
    // The old screen zooms past you while the new one rises in.
    ghost() {
      const old = app.querySelector(".screen");
      if (!old || calm()) return;
      const r = old.getBoundingClientRect();
      old.querySelectorAll("[id]").forEach(e => e.removeAttribute("id"));
      old.classList.add("ghost-out");
      Object.assign(old.style, { position: "fixed", top: r.top + "px", left: r.left + "px", width: r.width + "px", margin: 0 });
      document.body.appendChild(old);
      setTimeout(() => old.remove(), 450);
    },
    words(el) {
      el.innerHTML = el.textContent.split(" ").map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(" ");
    },
    letters(el) {
      el.innerHTML = [...el.textContent].map((c, i) => `<span class="l" style="--i:${i}">${esc(c)}</span>`).join("");
    },
    // "+75" flies from the verdict up into the score counter.
    fly(from, text, tier) {
      const to = $("#hud-score");
      if (!from || !to || calm()) return;
      const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
      const n = document.createElement("div");
      n.className = `flyer t${tier}`;
      n.textContent = text;
      n.style.left = a.left + "px"; n.style.top = a.top + "px";
      document.body.appendChild(n);
      n.animate([
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${(b.left - a.left) * 0.5}px, ${(b.top - a.top) * 0.5 - 40}px) scale(1.6)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(0.5)`, opacity: 0.2 },
      ], { duration: 950, easing: "cubic-bezier(.5,0,.3,1)" }).onfinish = () => {
        n.remove();
        to.classList.remove("bump"); void to.offsetWidth; to.classList.add("bump");
      };
    },
    // Rare answers burst into glowing bubbles.
    burst(el, tier) {
      if (!el || tier < 4 || calm()) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const count = tier === 5 ? 26 : 14;
      for (let k = 0; k < count; k++) {
        const d = document.createElement("i");
        d.className = `spark t${tier}`;
        const size = 4 + Math.random() * 9;
        Object.assign(d.style, { left: cx + "px", top: cy + "px", width: size + "px", height: size + "px" });
        document.body.appendChild(d);
        const ang = Math.random() * Math.PI * 2, dist = 80 + Math.random() * (tier === 5 ? 260 : 160);
        d.animate([
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0.2)`, opacity: 0 },
        ], { duration: 700 + Math.random() * 600, easing: "cubic-bezier(.1,.7,.3,1)" }).onfinish = () => d.remove();
      }
      if (tier === 5) {
        const f = document.createElement("div");
        f.className = "flash";
        document.body.appendChild(f);
        setTimeout(() => f.remove(), 900);
        document.body.classList.remove("quake"); void document.body.offsetWidth; document.body.classList.add("quake");
      }
    },
    // Crossing into a new zone gets a title card.
    zone(name, note) {
      if (calm()) return;
      const z = document.createElement("div");
      z.className = "zone-banner";
      z.innerHTML = `<b>${esc(name)}</b><small>${esc(note)}</small>`;
      document.body.appendChild(z);
      setTimeout(() => z.remove(), 2600);
    },
  };

  // Every screen starts by tearing down the last one's timers and listeners.
  let cleanups = [];
  let leaveGuard = null; // returns true if it handled the click itself
  function screen() {
    fx.ghost();
    cleanups.forEach(f => f());
    cleanups = [];
    leaveGuard = null;
    window.scrollTo(0, 0);
  }
  function onKey(fn) {
    document.addEventListener("keydown", fn);
    cleanups.push(() => document.removeEventListener("keydown", fn));
  }
  function every(ms, fn) {
    const t = setInterval(fn, ms);
    cleanups.push(() => clearInterval(t));
  }

  function setDepth(points) {
    const m = points * METRES_PER_POINT;
    const f = Math.min(1, m / MAX_DEPTH);
    const root = document.documentElement.style;
    // Light dies off fast near the surface, so darken on a square-root curve.
    root.setProperty("--d", Math.sqrt(f).toFixed(4));
    root.setProperty("--depth", f.toFixed(4));
    $("#gauge-fill").style.height = (f * 100) + "%";
    $("#gauge-diver").style.top = (f * 100) + "%";
    $("#hud-depth").textContent = fmtM(m);
    $("#hud-score").textContent = points;
    document.querySelectorAll("#life [data-from]").forEach(el => {
      el.classList.toggle("on", m >= +el.dataset.from && m < +el.dataset.to);
    });
  }

  function countUp(el, from, to, fmt) {
    const start = performance.now(), dur = 900;
    let raf;
    const step = now => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (to - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    cleanups.push(() => cancelAnimationFrame(raf));
  }

  function buildGauge() {
    $("#gauge-zones").innerHTML = MARKS.filter(x => x[2]).map(([m, note]) =>
      `<li style="top:${(m / MAX_DEPTH) * 100}%" class="${/ZONE|trench/.test(note) ? "zone" : ""}">
        <span class="m">${fmtM(m)}</span><span class="n">${esc(note.split(" · ")[0])}</span></li>`).join("");
  }

  function bubbles() {
    const box = $("#bubbles");
    let html = "";
    for (let i = 0; i < 18; i++) {
      const size = 3 + Math.random() * 9;
      html += `<span style="left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${8 + Math.random() * 12}s;animation-delay:-${Math.random() * 20}s"></span>`;
    }
    const snow = $("#snow");
    let s = "";
    for (let i = 0; i < 40; i++) {
      s += `<span style="left:${Math.random() * 100}%;animation-duration:${14 + Math.random() * 16}s;animation-delay:-${Math.random() * 30}s"></span>`;
    }
    box.innerHTML = html;
    snow.innerHTML = s;
  }

  // ---------- screens ----------
  function home() {
    screen();
    setDepth(0);
    const n = todayNumber();
    const rec = state.daily[n];
    const done = rec && rec.done;
    const going = rec && !rec.done && rec.rounds.length > 0;
    const st = streak();
    if (!IDS.length) {
      app.innerHTML = `<section class="screen home"><h1 class="title">FATHOM</h1>
        <p class="warn">No prompt packs loaded. Check the data folder.</p></section>`;
      return;
    }
    const firstVisit = !state.intro;
    app.innerHTML = `
      <section class="screen home">
        <h1 class="title">FATHOM</h1>
        <p class="kicker">the daily dive</p>
        <p class="tagline">7 prompts · ${SECONDS} seconds each · rare answers sink deeper</p>

        <div class="today">
          <div class="today-head">
            <span class="today-n">Dive #${n}</span>
            <span class="today-d">${diveDate(n)}</span>
            ${st ? `<span class="streak" title="days in a row">${st} day streak</span>` : ""}
          </div>
          ${done ? `
            <div class="today-done">
              <span class="today-m">${fmtM(rec.score * METRES_PER_POINT)}</span>
              <span class="today-z">${zoneAt(rec.score * METRES_PER_POINT)} · ${rec.score} pts</span>
              <span class="squares">${rec.rounds.map(r => `<i class="sq t${r.tier}"></i>`).join("")}</span>
            </div>
            <button class="primary" id="go-daily" type="button">See today's dive</button>
            <p class="next">Next dive in <b id="countdown">${untilMidnight()}</b></p>`
          : `<button class="primary" id="go-daily" type="button">${going ? `Resume dive · round ${rec.rounds.length + 1} of ${ROUNDS}` : "▼ Begin descent ▼"}</button>`}
        </div>

        <nav class="modes">
          <button type="button" data-go="archive"><b>Archive</b><span>past dives</span></button>
          <button type="button" data-go="packs"><b>Packs</b><span>pick a theme</span></button>
          <button type="button" data-go="unlimited"><b>Unlimited</b><span>play forever</span></button>
          <button type="button" data-go="stats"><b>Stats</b><span>your record</span></button>
          <button type="button" data-go="friends" class="wide"><b>Play with friends</b><span>a live lobby, same prompts for everyone</span></button>
        </nav>

        <details class="rules" ${firstVisit ? "open" : ""}>
          <summary>How to play</summary>
          <ol>
            <li>Same 7 prompts for everyone, every day.</li>
            <li>Name one thing that fits. You have ${SECONDS} seconds.</li>
            <li>Obvious answers float. Rare ones sink you deep: 10 to 100 points.</li>
            <li>Each point is 10 metres. 700 points reaches the trench.</li>
            <li>Answers we don't recognise don't count. Keep trying until the clock runs out, or pass.</li>
          </ol>
          <div class="legend">${[1, 2, 3, 4, 5].map(t => `<span class="t${t}"><i class="sq"></i>${TIER[t]} ${POINTS[t]}</span>`).join("")}</div>
        </details>
        <p class="count">${IDS.length} prompts · ${ANSWERS.toLocaleString()} answers · ${PACKS.length} packs</p>
      </section>`;
    fx.letters($(".title"));
    state.intro = true;
    save();
    $("#go-daily").onclick = () => done ? results(rec, dailyMeta(n)) : startDaily(n);
    app.querySelectorAll("[data-go]").forEach(b => b.onclick = () => ({ archive, packs, unlimited, stats, friends })[b.dataset.go]());
    if (done) every(30000, () => { const c = $("#countdown"); if (c) c.textContent = untilMidnight(); if (todayNumber() !== n) home(); });
  }

  function dailyMeta(n) {
    return { kind: "daily", n, title: `Dive #${n}`, sub: diveDate(n) };
  }
  const freshRec = () => ({ done: false, score: 0, rounds: [], started: 0 });

  function startDaily(n) {
    const rec = state.daily[n];
    const ids = diveIds(n);
    if (rec && !rec.done) {
      // Reloaded or left mid-round: the round that was on screen counts as missed.
      if (rec.rounds.length < rec.started) rec.rounds.push({ id: ids[rec.rounds.length], guess: "", hit: -1, tier: 0 });
      save();
      play(ids, dailyMeta(n), rec);
      return;
    }
    state.daily[n] = freshRec();
    save();
    play(ids, dailyMeta(n), state.daily[n]);
  }

  function unlimited() {
    play(practiceIds(IDS), { kind: "practice", title: "Unlimited", sub: "random prompts, any pack", again: unlimited }, freshRec());
  }

  function playPack(key) {
    const pack = PACKS.find(p => p.pack === key);
    play(practiceIds(pack.prompts.map(p => p.id)),
      { kind: "practice", title: pack.title, sub: "themed pack", again: () => playPack(key) }, freshRec());
  }

  function packs() {
    screen();
    setDepth(0);
    app.innerHTML = `
      <section class="screen list">
        <h2>Themed packs</h2>
        <p class="sub">Seven random prompts from one category, unseen ones first. This week's daily prompts are held back.</p>
        <div class="grid">
          ${PACKS.map(p => {
            const seen = p.prompts.filter(q => state.seen[q.id]).length;
            return `<button type="button" class="card" data-pack="${esc(p.pack)}">
              <span class="card-t">${esc(p.title)}</span>
              <span class="card-b">${esc(PACK_BLURB[p.pack] || "")}</span>
              <span class="card-s"><span class="prog"><span style="width:${(seen / p.prompts.length) * 100}%"></span></span>${seen} / ${p.prompts.length} seen</span>
            </button>`;
          }).join("")}
        </div>
        <button type="button" class="ghost back">← Back</button>
      </section>`;
    app.querySelectorAll("[data-pack]").forEach(b => b.onclick = () => playPack(b.dataset.pack));
    $(".back").onclick = home;
  }

  function archive() {
    screen();
    setDepth(0);
    const today = todayNumber();
    const rows = [];
    for (let n = today - 1; n >= 1; n--) {
      const r = state.daily[n];
      const status = r && r.done ? fmtM(r.score * METRES_PER_POINT) : r && r.rounds.length ? "unfinished" : "not played";
      rows.push(`<button type="button" class="row ${r && r.done ? "played" : ""}" data-n="${n}">
        <span>Dive #${n}</span><span class="muted">${diveDate(n)}</span>
        <span class="r">${r && r.done ? `<span class="squares">${r.rounds.map(x => `<i class="sq t${x.tier}"></i>`).join("")}</span>` : ""}${status}</span></button>`);
    }
    app.innerHTML = `
      <section class="screen list">
        <h2>Archive</h2>
        <p class="sub">Every past dive, free. Each one plays once, like the daily.</p>
        ${rows.length ? `<div class="rows">${rows.join("")}</div>` : `<p class="empty">Nothing here yet. Dive #1 was the first, so past dives show up as the days go by.</p>`}
        <button type="button" class="ghost back">← Back</button>
      </section>`;
    app.querySelectorAll("[data-n]").forEach(b => b.onclick = () => {
      const n = +b.dataset.n;
      const r = state.daily[n];
      if (r && r.done) results(r, dailyMeta(n)); else startDaily(n);
    });
    $(".back").onclick = home;
  }

  function stats() {
    screen();
    setDepth(0);
    const played = Object.entries(state.daily).filter(([, r]) => r.done).map(([n, r]) => [+n, r]);
    const scores = played.map(([, r]) => r.score);
    const tiers = [0, 0, 0, 0, 0, 0];
    played.forEach(([, r]) => r.rounds.forEach(x => tiers[x.tier]++));
    const maxT = Math.max(1, ...tiers);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const best = scores.length ? Math.max(...scores) : 0;
    const recent = played.sort((a, b) => b[0] - a[0]).slice(0, 14).reverse();
    const flags = state.flags || [];
    app.innerHTML = `
      <section class="screen list">
        <h2>Your dives</h2>
        <div class="tiles">
          <div class="tile"><span class="v">${played.length}</span><span class="l">dives</span></div>
          <div class="tile"><span class="v">${avg}</span><span class="l">avg score</span></div>
          <div class="tile"><span class="v">${fmtM(best * METRES_PER_POINT)}</span><span class="l">deepest</span></div>
          <div class="tile"><span class="v">${streak()}</span><span class="l">day streak</span></div>
        </div>
        ${recent.length ? `<h3>Recent dives</h3>
        <div class="spark">${recent.map(([n, r]) => `<span title="Dive #${n}: ${r.score} pts" style="height:${Math.max(3, r.score / 7)}%"><em>${r.score}</em></span>`).join("")}</div>` : ""}
        <h3>Your answers by rarity</h3>
        <div class="bars">
          ${[5, 4, 3, 2, 1, 0].map(t => `<div class="bar"><span class="bl t${t}">${TIER[t]}</span>
            <span class="bt"><span class="bf t${t}" style="width:${(tiers[t] / maxT) * 100}%"></span></span>
            <span class="bn">${tiers[t]}</span></div>`).join("")}
        </div>
        <p class="sub">Daily and archive dives only. Saved in this browser.</p>
        <h3>Flagged answers (${flags.length})</h3>
        ${flags.length ? `
          <p class="sub">Answers you think should count. Copy the list and send it over to get them added.</p>
          <ul class="flags">${flags.map(f => `<li><span class="muted">${esc(f.id)}</span> ${esc(f.q)} → <b>${esc(f.guess)}</b></li>`).join("")}</ul>
          <div class="actions"><button type="button" class="small" id="copy-flags">Copy list</button>
          <button type="button" class="ghost small" id="clear-flags">Clear</button></div>`
        : `<p class="sub">None yet. If a correct answer gets rejected, tap "flag it" under the box.</p>`}
        <button type="button" class="ghost back">← Back</button>
      </section>`;
    $(".back").onclick = home;
    if ($("#copy-flags")) {
      $("#copy-flags").onclick = () => copy(flags.map(f => `${f.id}\t${f.q}\t${f.guess}`).join("\n"), $("#copy-flags"), "Copy list");
      $("#clear-flags").onclick = () => { state.flags = []; save(); stats(); };
    }
  }

  // ---------- gameplay ----------
  function play(ids, meta, rec) {
    const prompts = ids.map(id => PROMPTS.get(id)).filter(Boolean);
    setDepth(rec.score);
    if (rec.rounds.length >= prompts.length) return finish(prompts, meta, rec);
    round(prompts, meta, rec);
  }

  function round(prompts, meta, rec) {
    screen();
    const i = rec.rounds.length;
    const p = prompts[i];
    rec.started = i + 1;
    state.seen[p.id] = 1;
    save();

    app.innerHTML = `
      <section class="screen round">
        <div class="round-top">
          <span class="pill">${esc(meta.title)}</span>
          <span class="pips">${prompts.map((_, k) => `<i class="${k < i ? "sq t" + rec.rounds[k].tier : k === i ? "now" : ""}"></i>`).join("")}</span>
          <span class="pill muted">${esc(p.packTitle)}</span>
        </div>
        <h2 class="prompt">${esc(p.q)}</h2>
        <form class="answer" autocomplete="off">
          <input id="guess" type="text" inputmode="text" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="type one answer" aria-label="Your answer" maxlength="60" enterkeyhint="go">
          <button type="submit" class="primary small">Dive</button>
        </form>
        <div class="clock"><div class="clock-fill" id="clock-fill"></div><span id="clock-n">${SECONDS}</span></div>
        <p class="feedback" id="feedback" aria-live="polite"></p>
        <div class="tried" id="tried"></div>
        <div class="round-foot">
          <button type="button" class="ghost small" id="pass">Pass</button>
          <span class="hint">Enter to dive · rejected guesses are free</span>
        </div>
      </section>`;
    fx.words($(".round .prompt"));
    const input = $("#guess");
    input.focus();
    const fb = $("#feedback");
    const start = performance.now();
    const tried = [];
    let over = false;
    let raf;

    const end = (guess, hit, why) => {
      if (over) return;
      over = true;
      cancelAnimationFrame(raf);
      const tier = hit >= 0 ? p.a[hit][1] : 0;
      rec.rounds.push(why ? { id: p.id, guess, hit, tier, why } : { id: p.id, guess, hit, tier });
      rec.score += POINTS[tier];
      save();
      reveal(prompts, meta, rec, tried);
    };

    $(".answer").onsubmit = e => {
      e.preventDefault();
      const g = input.value.trim();
      if (!g) return;
      const hit = FathomMatch.match(p, g, idx(p));
      if (hit < 0) {
        tried.push(g);
        fb.innerHTML = `<span>"${esc(g)}" isn't on the list.</span> <button type="button" class="link" id="flag">Think it's right? Flag it</button>`;
        $("#flag").onclick = () => {
          state.flags = (state.flags || []).filter(f => !(f.id === p.id && f.guess === g));
          state.flags.push({ id: p.id, q: p.q, guess: g, t: Date.now() });
          save();
          fb.innerHTML = `<span class="ok">Flagged "${esc(g)}". It's listed under Stats.</span>`;
          input.focus();
        };
        $("#tried").innerHTML = tried.map(t => `<span class="chip">${esc(t)}</span>`).join("");
        input.value = "";
        input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
        return;
      }
      end(g, hit);
    };

    let passArmed = false;
    $("#pass").onclick = () => {
      if (!passArmed) { passArmed = true; $("#pass").textContent = "Pass for 0?"; input.focus(); return; }
      end("", -1, "pass");
    };

    // Leaving a daily mid-round costs that round, so ask with a second click.
    if (meta.kind === "daily") {
      let armed = false;
      leaveGuard = () => {
        if (armed) return false;
        armed = true;
        fb.innerHTML = `<span>Leaving now counts this round as missed. Click FATHOM again to leave.</span>`;
        return true;
      };
    }

    const clockFill = $("#clock-fill"), clockN = $("#clock-n"), clock = $(".clock"), promptEl = $(".round .prompt");
    const tick = now => {
      const left = Math.max(0, SECONDS - (now - start) / 1000);
      clockFill.style.transform = `scaleX(${left / SECONDS})`;
      clockN.textContent = Math.ceil(left);
      clock.classList.toggle("low", left <= 5);
      promptEl.classList.toggle("tense", left <= 5);
      if (left <= 0) return end(input.value.trim(), -1, "time");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanups.push(() => cancelAnimationFrame(raf));
  }

  function reveal(prompts, meta, rec, tried) {
    screen();
    const r = rec.rounds[rec.rounds.length - 1];
    const p = PROMPTS.get(r.id);
    const gained = POINTS[r.tier];
    const before = rec.score - gained;
    const common = p.a.filter(e => e[1] === 1).map(e => e[0]);
    const deep = shuffle(p.a.filter(e => e[1] === 5), mulberry32(r.id.length * 31 + p.a.length)).slice(0, 4).map(e => e[0]);
    const m = rec.score * METRES_PER_POINT;
    const passed = MARKS.filter(([d]) => d <= m && d > before * METRES_PER_POINT);
    const last = rec.rounds.length >= prompts.length;
    const byTier = [5, 4, 3, 2, 1].map(t => [t, p.a.filter(e => e[1] === t).map(e => e[0]).sort((a, b) => a.localeCompare(b))]);
    const typed = r.hit >= 0 && FathomMatch.norm(r.guess) !== FathomMatch.norm(p.a[r.hit][0]);
    app.innerHTML = `
      <section class="screen reveal">
        <div class="round-top">
          <span class="pill">${esc(meta.title)}</span>
          <span class="pips">${prompts.map((_, k) => `<i class="${k < rec.rounds.length ? "sq t" + rec.rounds[k].tier : ""}"></i>`).join("")}</span>
        </div>
        <h2 class="prompt small">${esc(p.q)}</h2>
        ${r.hit >= 0
          ? `<div class="verdict t${r.tier}">
              <div><span class="ans">${esc(p.a[r.hit][0])}</span>${typed ? `<span class="typed">you typed "${esc(r.guess)}"</span>` : ""}</div>
              <div class="right"><span class="gain">+<b id="gain">0</b></span><span class="tier">${TIER[r.tier]}</span></div>
            </div>
            <div class="meter" aria-label="Rarity">${[1, 2, 3, 4, 5].map(t => `<span class="t${t} ${t === r.tier ? "me" : ""}">${TIER[t]}</span>`).join("")}</div>
            <p class="est">Estimated ${SHARE_EST[r.tier]} of divers say this.</p>`
          : `<div class="verdict t0"><div><span class="ans">${r.why === "pass" ? "Passed" : "Time's up"}</span>
              ${tried.length ? `<span class="typed">tried ${tried.map(t => `"${esc(t)}"`).join(", ")}</span>` : ""}</div>
              <div class="right"><span class="gain">+0</span></div></div>`}
        ${passed.length ? `<p class="passed">${passed.map(([d, n]) => `<span>↓ ${fmtM(d)} · ${esc(n)}</span>`).join("")}</p>` : ""}
        <dl class="lists">
          <dt>Everyone says</dt><dd>${common.map(c => `<span class="chip t1">${esc(c)}</span>`).join("")}</dd>
          ${deep.length ? `<dt>Deep cuts</dt><dd>${deep.map(c => `<span class="chip t5">${esc(c)}</span>`).join("")}</dd>` : ""}
        </dl>
        <details class="all">
          <summary>See all ${p.a.length} answers</summary>
          ${byTier.filter(([, list]) => list.length).map(([t, list]) => `<div class="all-tier"><h4 class="t${t}">${TIER[t]} · ${POINTS[t]}</h4>
            <p>${list.map(esc).join(" · ")}</p></div>`).join("")}
        </details>
        <button type="button" class="primary" id="next">${last ? "Surface for results" : "Keep sinking ▼"}</button>
        <p class="hint center">press Enter</p>
      </section>`;
    setDepth(before);
    // Let the reveal paint at the old depth, then sink.
    const t = setTimeout(() => setDepth(rec.score), 60);
    cleanups.push(() => clearTimeout(t));
    if (gained && $("#gain")) countUp($("#gain"), 0, gained, String);
    const verdict = $(".verdict");
    const fxT = setTimeout(() => {
      if (gained) fx.fly($("#gain"), "+" + gained, r.tier);
      fx.burst(verdict, r.tier);
    }, 380);
    cleanups.push(() => clearTimeout(fxT));
    const crossed = passed.filter(([, n]) => / · /.test(n) && /ZONE|trench/.test(n)).pop();
    if (crossed) {
      const zt = setTimeout(() => fx.zone(crossed[1].split(" · ")[0], crossed[1].split(" · ")[1]), 900);
      cleanups.push(() => clearTimeout(zt));
    }
    countUp($("#hud-depth"), before * METRES_PER_POINT, m, fmtM);

    const next = () => { if (last) finish(prompts, meta, rec); else round(prompts, meta, rec); };
    $("#next").onclick = next;
    // Small delay so the Enter that submitted the answer doesn't skip this screen.
    const armT = setTimeout(() => onKey(e => {
      if (e.key === "Enter" && !(e.target.closest && e.target.closest("summary"))) { e.preventDefault(); next(); }
    }), 300);
    cleanups.push(() => clearTimeout(armT));
  }

  function finish(prompts, meta, rec) {
    rec.done = true;
    if (meta.kind === "practice") {
      state.practice.push({ t: Date.now(), title: meta.title, score: rec.score });
      state.practice = state.practice.slice(-200);
    }
    save();
    results(rec, meta);
  }

  function shareText(rec, meta) {
    const m = rec.score * METRES_PER_POINT;
    return `Fathom ${meta.kind === "daily" ? "#" + meta.n : "· " + meta.title} · ${rec.score} pts · ${fmtM(m)}\n` +
      rec.rounds.map(r => SHARE_SQ[r.tier]).join("") + `\n${zoneAt(m)}`;
  }

  function results(rec, meta) {
    screen();
    setDepth(rec.score);
    const m = rec.score * METRES_PER_POINT;
    const deepest = MARKS.filter(([d]) => d <= m).pop();
    const isToday = meta.kind === "daily" && meta.n === todayNumber();
    app.innerHTML = `
      <section class="screen results">
        <span class="pill">${esc(meta.title)} · ${esc(meta.sub)}</span>
        <h2 class="big" id="big">${fmtM(m)}</h2>
        <p class="zone">${zoneAt(m)}${deepest ? ` · past ${esc(deepest[1].split(" · ").pop())}` : ""}</p>
        <p class="score-line">${rec.score} / ${ROUNDS * 100} points</p>
        <ol class="recap">
          ${rec.rounds.map(r => {
            const p = PROMPTS.get(r.id);
            const ans = r.hit >= 0 && p ? p.a[r.hit][0] : "—";
            return `<li style="--i:${rec.rounds.indexOf(r)}"><span class="sq t${r.tier}"></span><span class="q">${esc(p ? p.q : r.id)}</span>
              <span class="a">${esc(ans)}</span><span class="pts t${r.tier}">${POINTS[r.tier]}</span></li>`;
          }).join("")}
        </ol>
        <pre class="share" id="share">${esc(shareText(rec, meta))}</pre>
        <div class="actions">
          <button type="button" class="primary small" id="copy">Copy result</button>
          ${meta.again ? `<button type="button" class="small" id="again">Another dive</button>` : ""}
          ${meta.kind === "daily" ? `<button type="button" class="small" id="more">Archive</button>` : ""}
          <button type="button" class="ghost small" id="back">Home</button>
        </div>
        ${isToday ? `<p class="next">Next dive in <b id="countdown">${untilMidnight()}</b></p>` : ""}
      </section>`;
    countUp($("#big"), 0, m, fmtM);
    $("#copy").onclick = () => copy(shareText(rec, meta), $("#copy"), "Copy result");
    $("#back").onclick = home;
    if ($("#again")) $("#again").onclick = meta.again;
    if ($("#more")) $("#more").onclick = archive;
    if (isToday) every(30000, () => { const c = $("#countdown"); if (c) c.textContent = untilMidnight(); });
  }

  function copy(text, btn, label) {
    const done = () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = label; }, 1500); };
    const fallback = () => {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* the text is on screen to select */ }
      t.remove();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  // ---------- friends lobby (peer to peer) ----------
  // The host's browser is the referee. Everyone connects to it through PeerJS (the free
  // public broker only introduces the browsers), it picks the 7 prompts, runs the clock
  // and sends the whole room state to everyone after every change.
  const LOBBY_MAX = 8;
  const LOBBY_PREFIX = "fathom-room-";
  const ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }] };
  let L = null; // the live lobby session

  function myId() {
    try {
      let id = sessionStorage.getItem("fathom:me");
      if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem("fathom:me", id); }
      return id;
    } catch (e) { return Math.random().toString(36).slice(2, 10); }
  }
  function myName() { try { return localStorage.getItem("fathom:name") || ""; } catch (e) { return ""; } }
  function saveName(n) { try { localStorage.setItem("fathom:name", n); } catch (e) { /* fine */ } }
  const roomCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
  const inviteLink = code => location.origin + location.pathname + "?room=" + code;
  const peerReady = () => typeof window.Peer === "function";

  function lobbyLeave() {
    if (!L) return;
    const s = L;
    L = null;
    clearTimeout(s.timer);
    try { s.peer && s.peer.destroy(); } catch (e) { /* already gone */ }
  }

  function friends(prefill) {
    screen();
    setDepth(0);
    lobbyLeave();
    const name = myName();
    app.innerHTML = `
      <section class="screen list lobby">
        <h2>Play with friends</h2>
        <p class="sub">Up to ${LOBBY_MAX} players. Everyone gets the same 7 prompts at the same time and sees the scores live.</p>
        ${peerReady() ? "" : `<p class="warn">The multiplayer library didn't load. Check your internet connection and reload.</p>`}
        <label class="field"><span>Your name</span><input id="nm" maxlength="16" placeholder="e.g. Andy" value="${esc(name)}" autocomplete="off"></label>
        <div class="lobby-choice">
          <div class="lobby-card">
            <h3>Host a lobby</h3>
            <p class="sub">You get a code and a link to send. Keep this tab open while you play.</p>
            <button type="button" class="primary small" id="host">Create lobby</button>
          </div>
          <div class="lobby-card">
            <h3>Join a lobby</h3>
            <input id="code" class="code-in" maxlength="4" placeholder="CODE" value="${esc(prefill || "")}" autocomplete="off" autocapitalize="characters">
            <button type="button" class="primary small" id="join">Join</button>
          </div>
        </div>
        <p class="feedback" id="feedback"></p>
        <button type="button" class="ghost back">← Back</button>
      </section>`;
    const fb = $("#feedback");
    const getName = () => {
      const n = $("#nm").value.trim().slice(0, 16);
      if (!n) { fb.textContent = "Pick a name first."; $("#nm").focus(); return null; }
      saveName(n);
      return n;
    };
    $("#host").onclick = () => { const n = getName(); if (n && peerReady()) hostLobby(n, fb); };
    $("#join").onclick = () => {
      const n = getName();
      const c = $("#code").value.trim().toUpperCase();
      if (!n) return;
      if (!/^[A-Z]{4}$/.test(c)) { fb.textContent = "Codes are 4 letters."; return; }
      if (peerReady()) joinLobby(n, c, fb);
    };
    $("#code").addEventListener("keydown", e => { if (e.key === "Enter") $("#join").click(); });
    $(".back").onclick = home;
    if (!name) $("#nm").focus(); else if (prefill) $("#join").focus();
  }

  // ----- host side -----
  function hostLobby(name, fb, tries = 0) {
    const code = roomCode();
    fb.textContent = "Opening a lobby…";
    const peer = new Peer(LOBBY_PREFIX + code, { config: ICE, debug: 0 });
    const me = myId();
    const S = {
      code, phase: "lobby", r: -1, ids: [], endsAt: 0,
      players: [{ id: me, name, score: 0, ans: {}, online: true, host: true }],
    };
    let opened = false;
    L = { role: "host", peer, me, S, conns: new Map(), timer: null };
    peer.on("open", () => { opened = true; hostBroadcast(); });
    peer.on("error", e => {
      if (!opened && e.type === "unavailable-id" && tries < 3) { peer.destroy(); hostLobby(name, fb, tries + 1); return; }
      if (!opened) { fb.textContent = "Couldn't reach the matchmaking server. Check your connection and try again."; lobbyLeave(); }
    });
    peer.on("disconnected", () => setTimeout(() => { if (L && L.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect(); }, 2000));
    peer.on("connection", conn => {
      conn.on("data", d => hostOnMsg(conn, d));
      conn.on("close", () => {
        const p = L && L.S.players.find(x => x.id === conn.pid);
        if (p) { p.online = false; L.conns.delete(p.id); hostCheckRound(); hostBroadcast(); }
      });
    });
  }

  function hostOnMsg(conn, d) {
    if (!L || L.role !== "host" || !d || typeof d !== "object") return;
    const S = L.S;
    if (d.t === "hello") {
      const name = String(d.name || "Player").slice(0, 16);
      let p = S.players.find(x => x.id === d.id);
      if (!p) {
        if (S.players.length >= LOBBY_MAX) { conn.send({ t: "full" }); setTimeout(() => conn.close(), 300); return; }
        p = { id: String(d.id).slice(0, 12), name, score: 0, ans: {}, online: true };
        S.players.push(p);
      }
      p.name = name; p.online = true;
      conn.pid = p.id;
      L.conns.set(p.id, conn);
      hostBroadcast();
    } else if (d.t === "answer" && conn.pid) {
      hostAnswer(conn.pid, d);
    }
  }

  function hostAnswer(pid, d) {
    const S = L.S;
    const p = S.players.find(x => x.id === pid);
    if (!p || S.phase !== "round" || d.r !== S.r || p.ans[S.r]) return;
    const prompt = PROMPTS.get(S.ids[S.r]);
    // The host re-checks the guess, so everyone is scored by the same rules.
    const hit = prompt && d.guess ? FathomMatch.match(prompt, String(d.guess).slice(0, 60), idx(prompt)) : -1;
    const tier = hit >= 0 ? prompt.a[hit][1] : 0;
    p.ans[S.r] = { guess: String(d.guess || "").slice(0, 60), hit, tier, why: d.why || "" };
    p.score += POINTS[tier];
    hostCheckRound();
    hostBroadcast();
  }

  function hostStartGame() {
    const S = L.S;
    S.ids = practiceIds(IDS);
    S.players = S.players.filter(p => p.online);
    S.players.forEach(p => { p.score = 0; p.ans = {}; });
    hostStartRound(0);
  }
  function hostStartRound(r) {
    const S = L.S;
    S.phase = "round"; S.r = r; S.endsAt = Date.now() + SECONDS * 1000 + 600;
    clearTimeout(L.timer);
    // Grace second for slow connections, then anyone who hasn't answered gets 0.
    L.timer = setTimeout(() => {
      if (!L || L.S.phase !== "round" || L.S.r !== r) return;
      L.S.players.forEach(p => { if (!p.ans[r]) p.ans[r] = { guess: "", hit: -1, tier: 0, why: "time" }; });
      hostCheckRound();
      hostBroadcast();
    }, SECONDS * 1000 + 1800);
    hostBroadcast();
  }
  function hostCheckRound() {
    const S = L.S;
    if (S.phase !== "round") return;
    if (S.players.filter(p => p.online).every(p => p.ans[S.r])) {
      clearTimeout(L.timer);
      S.phase = S.r >= ROUNDS - 1 ? "done" : "reveal";
    }
  }
  function hostNext() {
    const S = L.S;
    if (S.phase === "reveal") hostStartRound(S.r + 1);
    else if (S.phase === "done") { S.phase = "lobby"; S.r = -1; hostBroadcast(); }
  }
  function hostBroadcast() {
    if (!L || L.role !== "host") return;
    const S = L.S;
    const msg = { t: "state", S: Object.assign({}, S, { left: S.phase === "round" ? S.endsAt - Date.now() : 0 }) };
    for (const c of L.conns.values()) { try { c.open && c.send(msg); } catch (e) { /* dropped */ } }
    lobbyRender(msg.S);
  }

  // ----- guest side -----
  function joinLobby(name, code, fb) {
    fb.textContent = "Connecting…";
    const peer = new Peer({ config: ICE, debug: 0 });
    const me = myId();
    let joined = false;
    L = { role: "guest", peer, me, S: null, conn: null };
    const fail = msg => { if (!joined) { fb.textContent = msg; lobbyLeave(); } };
    const t = setTimeout(() => fail("No answer from that lobby. Check the code, and that the host still has the page open."), 12000);
    peer.on("error", e => fail(e.type === "peer-unavailable" ? "No lobby with that code." : "Couldn't connect. Some school or mobile networks block this; try other Wi-Fi."));
    peer.on("open", () => {
      const conn = peer.connect(LOBBY_PREFIX + code, { reliable: true, serialization: "json" });
      L.conn = conn;
      conn.on("open", () => { joined = true; clearTimeout(t); conn.send({ t: "hello", id: me, name }); });
      conn.on("data", d => {
        if (!L || L.conn !== conn) return;
        if (d && d.t === "full") { joined = false; fail("That lobby is full."); return; }
        if (d && d.t === "state") { d.S.left = Math.max(0, d.S.left); d.S.endsAtLocal = Date.now() + d.S.left; lobbyRender(d.S); }
      });
      conn.on("close", () => { if (L && L.conn === conn) lobbyLost(code); });
    });
  }
  function lobbyLost(code) {
    lobbyLeave();
    screen();
    app.innerHTML = `<section class="screen list"><h2>Lost the lobby</h2>
      <p class="sub">The connection to the host dropped. If they still have the page open you can rejoin; your score is kept.</p>
      <div class="actions"><button type="button" class="primary small" id="rejoin">Rejoin ${esc(code)}</button>
      <button type="button" class="ghost small" id="back">Home</button></div></section>`;
    $("#rejoin").onclick = () => friends(code);
    $("#back").onclick = home;
  }
  function lobbySend(msg) {
    if (!L) return;
    if (L.role === "host") hostAnswer(L.me, msg);
    else if (L.conn && L.conn.open) L.conn.send(msg);
  }

  // ----- views (shared by host and guests) -----
  function standings(S) {
    return S.players.slice().sort((a, b) => b.score - a.score);
  }
  function lobbyRender(S) {
    if (!L) return;
    L.S = L.role === "host" ? L.S : S;
    const prev = L.view;
    const key = S.phase + ":" + S.r;
    L.view = key;
    if (prev === key && (S.phase === "round" || S.phase === "lobby")) return lobbyUpdate(S); // live bits only
    if (S.phase === "lobby") return lobbyRoom(S);
    if (S.phase === "round") return lobbyRound(S);
    return lobbyReveal(S);
  }

  function playerRows(S, mode) {
    const r = S.r;
    return standings(S).map((p, k) => {
      const a = p.ans[r];
      const status = mode === "round" ? (a ? `<span class="st ok">answered</span>` : `<span class="st">thinking…</span>`) : "";
      return `<li class="${p.id === L.me ? "me" : ""} ${p.online ? "" : "off"}">
        <span class="rk">${k + 1}</span><span class="nm">${esc(p.name)}${p.host ? ` <em>host</em>` : ""}${p.online ? "" : ` <em>left</em>`}</span>
        ${status}<span class="sc">${p.score}</span></li>`;
    }).join("");
  }

  function lobbyRoom(S) {
    screen();
    setDepth(0);
    leaveGuard = () => { lobbyLeave(); return false; };
    const host = L.role === "host";
    app.innerHTML = `
      <section class="screen list lobby">
        <h2>Lobby</h2>
        <div class="room-code"><span class="lbl">Code</span><b>${esc(S.code)}</b>
          <button type="button" class="small" id="copy-link">Copy invite link</button></div>
        <p class="sub">${host ? "Send friends the code or the link, then start when everyone's in." : "Waiting for the host to start…"}</p>
        <ol class="players" id="lb-players">${playerRows(S, "lobby")}</ol>
        ${host ? `<button type="button" class="primary" id="start">Start the dive</button>` : ""}
        <button type="button" class="ghost back">← Leave lobby</button>
      </section>`;
    $("#copy-link").onclick = () => copy(inviteLink(S.code), $("#copy-link"), "Copy invite link");
    if (host) $("#start").onclick = () => hostStartGame();
    $(".back").onclick = () => { lobbyLeave(); friends(); };
  }

  function lobbyUpdate(S) {
    const list = $("#lb-players");
    if (list) list.innerHTML = playerRows(S, S.phase === "round" ? "round" : "lobby");
  }

  function lobbyRound(S) {
    screen();
    const r = S.r;
    const p = PROMPTS.get(S.ids[r]);
    const mine = S.players.find(x => x.id === L.me);
    setDepth(mine ? mine.score : 0);
    leaveGuard = () => { lobbyLeave(); return false; };
    if (!p) { app.innerHTML = `<section class="screen list"><p class="warn">This prompt isn't in your copy of the game. Reload to get the latest version.</p></section>`; return; }
    const already = mine && mine.ans[r];
    app.innerHTML = `
      <section class="screen round lobby-round">
        <div class="round-top">
          <span class="pill">Lobby ${esc(S.code)}</span>
          <span class="pill">${r + 1} / ${ROUNDS}</span>
          <span class="pill muted">${esc(p.packTitle)}</span>
        </div>
        <h2 class="prompt">${esc(p.q)}</h2>
        <form class="answer" autocomplete="off" ${already ? "hidden" : ""}>
          <input id="guess" type="text" autocapitalize="off" autocorrect="off" spellcheck="false"
            placeholder="type one answer" aria-label="Your answer" maxlength="60" enterkeyhint="go">
          <button type="submit" class="primary small">Dive</button>
        </form>
        <div class="clock"><div class="clock-fill" id="clock-fill"></div><span id="clock-n">${SECONDS}</span></div>
        <p class="feedback" id="feedback">${already ? "Locked in. Waiting for the others…" : ""}</p>
        <div class="tried" id="tried"></div>
        <ol class="players compact" id="lb-players">${playerRows(S, "round")}</ol>
      </section>`;
    fx.words($(".round .prompt"));
    const input = $("#guess");
    const fb = $("#feedback");
    const tried = [];
    let sent = !!already;
    const lock = (guess, why) => {
      if (sent) return;
      sent = true;
      lobbySend({ t: "answer", r, guess, why });
      $(".answer").hidden = true;
      fb.innerHTML = guess ? `<span class="ok">Locked in "${esc(guess)}". Waiting for the others…</span>` : "Out of time. Waiting for the others…";
    };
    if (!already) {
      input.focus();
      $(".answer").onsubmit = e => {
        e.preventDefault();
        const g = input.value.trim();
        if (!g) return;
        if (FathomMatch.match(p, g, idx(p)) < 0) {
          tried.push(g);
          fb.textContent = `"${g}" isn't on the list. Try another.`;
          $("#tried").innerHTML = tried.map(t => `<span class="chip">${esc(t)}</span>`).join("");
          input.value = "";
          input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake");
          return;
        }
        lock(g, "");
      };
    }
    const deadline = L.role === "host" ? S.endsAt : S.endsAtLocal;
    const clockFill = $("#clock-fill"), clockN = $("#clock-n"), clock = $(".clock"), promptEl = $(".round .prompt");
    let raf;
    const tick = () => {
      const left = Math.max(0, Math.min(SECONDS, (deadline - Date.now()) / 1000));
      clockFill.style.transform = `scaleX(${left / SECONDS})`;
      clockN.textContent = Math.ceil(left);
      clock.classList.toggle("low", left <= 5);
      promptEl.classList.toggle("tense", left <= 5 && !sent);
      if (left <= 0) return lock("", "time");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    cleanups.push(() => cancelAnimationFrame(raf));
  }

  function lobbyReveal(S) {
    screen();
    const r = S.r;
    const p = PROMPTS.get(S.ids[r]);
    const done = S.phase === "done";
    const host = L.role === "host";
    const mine = S.players.find(x => x.id === L.me);
    const myAns = mine && mine.ans[r];
    setDepth(mine ? mine.score : 0);
    leaveGuard = () => { lobbyLeave(); return false; };
    const rows = S.players.slice().sort((a, b) => ((b.ans[r] || {}).tier || 0) - ((a.ans[r] || {}).tier || 0)).map(pl => {
      const a = pl.ans[r] || { hit: -1, tier: 0 };
      const label = a.hit >= 0 && p ? p.a[a.hit][0] : a.why === "time" || !a.guess ? "no answer" : a.guess;
      return `<li class="t${a.tier} ${pl.id === L.me ? "me" : ""}"><span class="nm">${esc(pl.name)}</span>
        <span class="an">${esc(label)}</span><span class="tr">${a.tier ? TIER[a.tier] : ""}</span><span class="pt">+${POINTS[a.tier]}</span></li>`;
    }).join("");
    const board = standings(S);
    const medal = k => ["gold", "silver", "bronze"][k] || "";
    app.innerHTML = `
      <section class="screen reveal lobby-reveal">
        <div class="round-top"><span class="pill">Lobby ${esc(S.code)}</span><span class="pill">${r + 1} / ${ROUNDS}</span></div>
        ${p ? `<h2 class="prompt small">${esc(p.q)}</h2>` : ""}
        <ol class="answers-round">${rows}</ol>
        ${p ? `<dl class="lists"><dt>Everyone says</dt><dd>${p.a.filter(e => e[1] === 1).map(e => `<span class="chip t1">${esc(e[0])}</span>`).join("")}</dd></dl>` : ""}
        <h3>${done ? "Final standings" : "Standings"}</h3>
        <ol class="players ${done ? "final" : ""}">${board.map((pl, k) => `<li class="${pl.id === L.me ? "me" : ""} ${done ? medal(k) : ""}">
          <span class="rk">${k + 1}</span><span class="nm">${esc(pl.name)}</span>
          <span class="sq-row">${Array.from({ length: r + 1 }, (_, i) => `<i class="sq t${(pl.ans[i] || {}).tier || 0}"></i>`).join("")}</span>
          <span class="sc">${pl.score}</span></li>`).join("")}</ol>
        ${host ? `<button type="button" class="primary" id="next">${done ? "Back to the lobby" : "Next prompt ▼"}</button>`
               : `<p class="sub center">${done ? "Waiting for the host to start another round…" : "Waiting for the host to go on…"}</p>`}
      </section>`;
    if (myAns) fx.burst($(".answers-round li.me"), myAns.tier);
    if (done && board[0]) setTimeout(() => fx.zone(board[0].name + " wins", `${board[0].score} points · ${fmtM(board[0].score * METRES_PER_POINT)}`), 500);
    if (host) {
      $("#next").onclick = hostNext;
      const armT = setTimeout(() => onKey(e => { if (e.key === "Enter") { e.preventDefault(); hostNext(); } }), 300);
      cleanups.push(() => clearTimeout(armT));
    }
  }

  // ---------- boot ----------
  if (!calm()) {
    window.addEventListener("pointermove", e => {
      const root = document.documentElement.style;
      root.setProperty("--mx", (e.clientX / innerWidth - 0.5).toFixed(3));
      root.setProperty("--my", (e.clientY / innerHeight - 0.5).toFixed(3));
    }, { passive: true });
  }
  buildGauge();
  bubbles();
  $("#home-btn").onclick = () => { if (leaveGuard && leaveGuard()) return; lobbyLeave(); home(); };
  const invite = new URLSearchParams(location.search).get("room");
  if (invite && /^[A-Za-z]{4}$/.test(invite)) friends(invite.toUpperCase());
  else home();
})();
