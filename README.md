# Fathom

A free, offline take on the daily trivia game Krillion. Each day you get seven prompts like "Name a country in South America" and 25 seconds to answer each one. Obvious answers barely score. Rare ones sink you deeper, at 10 metres per point, and a perfect 700 reaches the trench at 7,000 m.

A personal fan project, not affiliated with Krillion. Everything here is free: today's dive, the archive of past dives, themed packs and unlimited play.

**Play it:** https://andyqueyl.github.io/fathom/

## How to play

Open `index.html` in a browser. Double-clicking it works and needs no server and no internet. Without internet the custom fonts don't load, so you get system fonts instead.

- **Daily dive:** the same seven prompts for everyone on a given day, playable once. Dive #1 was 15 Oct 2026.
- **Archive:** any past dive, also once each.
- **Themed packs:** seven random prompts from one category.
- **Unlimited:** seven random prompts from everything. Practice modes skip the next 7 days of daily prompts and show you unseen prompts first.
- **Play with friends:** host a lobby, send the 4-letter code or invite link, and up to 8 people play the same 7 prompts at the same time. Everyone sees who has answered, then all the answers side by side, then live standings.
- **Stats:** dives played, average, deepest, streak, recent scores, how rare your answers are, and your flagged answers. Stats live in this browser only (localStorage).

During a round you can **Pass**, see the guesses that got rejected, and **flag** a rejected answer you think is right. Flags collect on the Stats page with a Copy button, so you can send them over to get added. After each round you see your answer's rarity, and you can open the full answer list if you want it.

Typing an answer that isn't on the list doesn't cost you anything. You get "not on the list" and can try again until the clock runs out. Case, accents, punctuation, apostrophes, a leading "the" and plural "s" are ignored, and numbers can be typed any way ("Toy Story 2" = "Toy Story II" = "Toy Story Two", "Henry the Eighth" = "Henry VIII"). Typos are forgiven only a little: one slip in a word of 6+ letters, two in 10+, or two swapped letters ("balck"). Each word has to keep its first letter, and numbers have to match ("Shrek 5" is not "Shrek 2"). That's strict on purpose: a rejected typo can be retyped, but a wrong answer that sneaks through can't be undone.

### Scoring

| Rarity | Points | Roughly how many players would say it |
|---|---|---|
| Common | 10 | over 15% |
| Popular | 30 | 5-15% |
| Decent | 50 | 2-5% |
| Rare | 75 | 0.5-2% |
| Abyssal | 100 | under 0.5% |
| Missed | 0 | time ran out |

## What it can't do (read this)

- **Rarity is estimated, not measured.** The real game scores you against what other players actually typed. Fathom has no players to count, so every answer carries a hand-assigned tier (written with Claude). Expect some tiers to feel wrong. Fix them in the `data/pack-*.js` files.
- **Only answers on the list count.** Every prompt is a closed set (countries, elements, Pixar films...) with a list that's meant to be complete, but some correct answers will be missing. If one gets rejected, add it to the pack.
- **Friends lobbies are peer to peer.** Browsers connect directly using PeerJS (its free public server only introduces them). The host's tab runs the game, so it has to stay open. Some strict networks (school, cellular, office) block direct connections. Tested with two tabs on one computer, not yet across two devices.
- **There's no global leaderboard and no accounts.** "Same prompts for everyone" holds because the daily schedule is computed from the date, so friends opening their own copy get the same dive. Scores aren't shared.
- **The schedule shifts when you add prompts.** Days are dealt from a seeded shuffle of all prompt ids, so adding or removing prompts changes which prompts upcoming (and past) dive numbers show.
- With 410 prompts, the daily cycle repeats after 58 days (reshuffled). Heavy unlimited play uses up prompts before they come round in the daily.
- **Typo matching still lets a few wrong answers through.** `node scripts/false-matches.cjs` lists every case where an answer from another prompt would typo-match (about 1,800 across 37,600 answers). Most are fair, like demonyms ("Austrian" for Austria) or spacing ("Heilong Jiang"). A few aren't, like "Indians" counting as the Indiana Pacers.

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/style.css`, `js/game.js` | The game. |
| `js/match.js` | Answer normalising and typo matching, shared with the validator. |
| `data/pack-*.js` | 410 prompts and about 37,600 answers in 11 packs: geography (50), science & nature (50), pop culture (49), food & everyday (49), sports & history (48), games (34), Film & TV (30), words & language (36), brands (26), famous people (20), music (18). |
| `data/FORMAT.md` | How to write or edit a pack, and how tiers are defined. |
| `scripts/validate.cjs` | `node scripts/validate.cjs` checks every pack (ids, tiers, alias collisions). |
| `scripts/false-matches.cjs` | Typo-matching audit (about 2 minutes). Lists wrong answers that would still score. |

## Adding prompts

1. Add an entry to a pack (or a new `data/pack-<name>.js`, plus a `<script>` tag in `index.html`), following `data/FORMAT.md`.
2. Run `node scripts/validate.cjs` and fix it until it reports 0 errors.
3. Reload the page.
