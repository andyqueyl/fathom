# Prompt pack format

Each `data/pack-<name>.js` is a plain script (no fetch, so the game works from `file://`):

```js
window.FATHOM_PACKS = window.FATHOM_PACKS || [];
window.FATHOM_PACKS.push({
  pack: "geo",
  title: "Geography",
  prompts: [
    { id: "geo-001", q: "Name a country in South America", a: [
      ["Brazil", 1],
      ["Argentina", 1],
      ["Colombia", 2],
      ["Venezuela", 3],
      ["Suriname", 5],
      ["Guyana", 4, "co-operative republic of guyana"],
      // [canonical name, tier, ...aliases]
    ]},
  ],
});
```

## Tiers (the whole game rests on these)

There is no crowd data, so a tier is an estimate: out of 100 typical US players (adults, general knowledge, 25 seconds on the clock), how many would type this answer?

| Tier | Share of players | Points | Typical count per prompt |
|---|---|---|---|
| 1 | over 15% | 10 | 1-4 (the obvious ones) |
| 2 | 5-15% | 30 | about 3-8 |
| 3 | 2-5% | 50 | about 5-15 |
| 4 | 0.5-2% | 75 | many |
| 5 | under 0.5% (correct but obscure) | 100 | many |

The "clever" pick that feels rare usually isn't. Put it in tier 2 or 3, not 5.

## Rules for prompts

- **Closed sets only.** The list must contain essentially every correct answer a player could type. An unlisted correct answer scores 0, which feels unfair. Good: countries, elements, Pixar films, NFL teams, bones. Bad: "name something red".
- Lists run from 20 answers up to a few hundred. Bigger is better when the real set is big.
- **Aliases:** add common alternate names, abbreviations and spellings ("USA", "United States", "America"). Matching already ignores case, accents, punctuation, a leading "the" and plural "s"/"es", so don't add those as aliases. Typo tolerance is strict (6+ letters for one slip), so DO add common misspellings of short or hard names as aliases.
- Two different answers must never share a label (the validator fails that).
- Stick to stable facts. Avoid anything that changes month to month (current rosters, charts).
- Phrase every prompt as "Name a ..." or similar, answerable with a word or short phrase.
- Ids: `<pack>-NNN`, unique across all packs.

Run `node scripts/validate.cjs` before committing. It must report 0 errors. Warnings about near-identical labels are fine when both answers are real.
