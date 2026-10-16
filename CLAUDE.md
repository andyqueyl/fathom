# Fathom: notes for AI assistants

`README.md` is the user-facing description. Read it first, especially "What it can't do".

- **Owner:** Andy. He plays Krillion (krillion.io) daily and wanted a free version because the original charges for extras. Built 2026-10-15.
- **It's a clone of the mechanics, not the brand.** Keep the name Fathom, our own copy and our own depth facts. Never copy Krillion's text, logo or prompts.
- **Live site:** https://andyqueyl.github.io/fathom/ (GitHub Pages, `main` branch, repo root). **Repo:** https://github.com/andyqueyl/fathom (public, so Pages works on a free account).
- **Static and offline.** No build step, no server, no fetch (packs are `<script>` files so `file://` works too). Pushing to `main` redeploys the site.
- **Honesty about rarity.** Tiers are estimates. Never present them as player data in the UI or the README.

## Gameplay rules (Andy's spec, mirroring the original)

7 prompts, 25 s each, one daily dive per day (and one play per archive dive), 10 m per point, max 700 points = 7,000 m. Unrecognised answers don't count and can be retried while the clock runs; time running out scores 0. A daily that gets reloaded mid-round counts that round as missed, so no replays.

## Friends lobby

In `js/game.js` ("friends lobby" section). PeerJS 1.5.4 from cdnjs, peer id `fathom-room-<CODE>`, STUN only (no TURN). The host is the referee: it picks the prompts, runs the clock (25 s plus a grace second), re-checks every guess with `FathomMatch`, and broadcasts the full state after every change. Player ids are per tab (sessionStorage `fathom:me`), so two tabs can test it; names are in localStorage `fathom:name`. A guest who reconnects with the same id keeps their score. Max 8 players.

## Maintenance

- Pack edits: follow `data/FORMAT.md`, then `node scripts/validate.cjs` must report 0 errors. After changing `js/match.js`, rerun `node scripts/false-matches.cjs` and compare the hit count (1,822 on 2026-10-16, 410 prompts).
- Matching is deliberately strict (see `typoAllowance` in `js/match.js`). Retries are free while the clock runs, so rejecting a real typo costs less than accepting a wrong answer. Don't loosen it without rerunning the audit.
- `norm()` turns number words, ordinals and roman numerals (after another word only, so a bare "I" stays a word) into digits, and drops apostrophes.
- Time-sensitive prompts to recheck: mix-022 Super Bowl winners (after each February), screen-002/003 Oscar winners (after each March), anything "through 2025" in people-*.
- Packs still short of 40 (agents stopped early to save budget): music 18, people 20, brands 26, screen 30, games 34. Ids continue from the highest existing one.
- Removed as duplicates on 2026-10-16: life-026 (Clue, kept pop-040), pop-039 (Monopoly, kept life-013), mix-044/045 (kept geo-019/042). Don't reuse those ids. Also removed as too niche: people-003/004/006/008/012/015/017/019.
- Daily schedule = seeded shuffle of the sorted prompt ids, dealt 7 per day and reshuffled each cycle (`diveIds` in `js/game.js`). Adding prompts reshuffles every dive number. That's accepted and noted in the README.
- localStorage key `fathom:v1` (daily results, practice history, seen ids). Every access is wrapped in try/catch.
- Look: the background color is the depth (`--d` from 0 to 1 mixes `--surface` into `--abyss`). Chakra Petch / IBM Plex Sans / IBM Plex Mono. Tier colors `--t0`..`--t5` match the share-text squares.
