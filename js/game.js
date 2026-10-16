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

  // Every screen starts by tearing down the last one's timers and listeners.
  let cleanups = [];
  let leaveGuard = null; // returns true if it handled the click itself
  function screen() {
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
    state.intro = true;
    save();
    $("#go-daily").onclick = () => done ? results(rec, dailyMeta(n)) : startDaily(n);
    app.querySelectorAll("[data-go]").forEach(b => b.onclick = () => ({ archive, packs, unlimited, stats })[b.dataset.go]());
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

    const clockFill = $("#clock-fill"), clockN = $("#clock-n"), clock = $(".clock");
    const tick = now => {
      const left = Math.max(0, SECONDS - (now - start) / 1000);
      clockFill.style.transform = `scaleX(${left / SECONDS})`;
      clockN.textContent = Math.ceil(left);
      clock.classList.toggle("low", left <= 5);
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
            return `<li><span class="sq t${r.tier}"></span><span class="q">${esc(p ? p.q : r.id)}</span>
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

  // ---------- boot ----------
  buildGauge();
  bubbles();
  $("#home-btn").onclick = () => { if (leaveGuard && leaveGuard()) return; home(); };
  home();
})();
