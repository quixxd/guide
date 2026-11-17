// Lenses: the angle the commentary takes. Ported from server/lenses.ts.
// The walk buttons on the start screen each pick one lens (spec rev2 §3.2: one walk, one lens):
// see WALKS. The others stay available for later.

/**
 * @typedef {{ id: string, label: string, covers: string, keywords: RegExp | null, walk?: string, tagline?: string }} Lens
 * covers: told to the narrator. keywords: matched against a place's name, description and
 * categories, to prefer places that suit the lens. walk / tagline: the start button.
 */

/** @type {Lens[]} */
export const LENSES = [
  {
    id: "history",
    label: "History",
    walk: "Historic walk",
    tagline: "How it all came to be",
    covers: "how the place came to be, eras, events, who lived here and what happened here, told the way a good walking-tour guide would, with architecture, legends and everyday life woven in where they serve the story",
    keywords: /\b(century|centuries|founded|built in|medieval|roman|moorish|king|queen|battle|siege|earthquake|empire|ancient|history|historic|heritage|monument|castle|palace|church|cathedral|town hall)\b/i,
  },
  {
    id: "famous",
    label: "Famous people",
    walk: "Famous people walk",
    tagline: "Who lived and worked here",
    covers: "the people behind the place: who was born, lived, worked, ruled, wrote, painted or died here, whom the statues, memorials, houses and streets are for, and the human stories that tie them to this spot. Lead with the person and their story; the building or street is the stage",
    keywords: /\b(born|lived|died|birthplace|grave|tomb|buried|poet|writer|author|painter|composer|musician|philosopher|scientist|mayor|merchant|king|queen|statue|bust|memorial|monument to|named after|house of|residence|museum of)\b/i,
  },
  {
    id: "food",
    label: "Food & drink",
    walk: "Food & drink walk",
    tagline: "Tastes, markets, old cafés",
    covers: "food and drink, past and present: what people here grew, traded, cooked, brewed and drank through the centuries, markets and merchants' cellars, historic cafés, bakeries and taverns, local dishes and specialities, and what is worth tasting here today. Mention a specific café, restaurant or shop only when the sources name it; never invent places, opening hours or prices",
    keywords: /\b(restaurant|café|cafe|coffee|bakery|baker|pastry|confectioner|chocolate|food|wine|beer|brewery|brewed|cellar|ratskeller|market|marketplace|tavern|inn|pub|bar|cuisine|dish|spice|fish|trade|merchant|guild)\b/i,
  },
  {
    id: "photo",
    label: "Photo",
    walk: "Photo walk",
    tagline: "Best views and angles",
    covers: "seeing and photographing the place: where to stand, what to frame, interesting angles, symmetry and reflections, details most people walk past, how the light falls at this time of day. Talk like a photography guide giving short, practical prompts; give only a line of history for context",
    keywords: /\b(view|viewpoint|panorama|vista|skyline|tower|spire|dome|facade|façade|gable|arch|arcade|bridge|fountain|square|statue|sculpture|mural|stained glass|reflection|river|waterfront|lookout|ornate|decorated)\b/i,
  },
  { id: "surprise", label: "Surprise me", covers: "a balanced mix, leaning on whatever is most remarkable about the place", keywords: null },
  { id: "architecture", label: "Architecture & Art", covers: "buildings and styles, artworks, artists, design", keywords: /\b(architect|architecture|style|baroque|gothic|manueline|romanesque|neoclassical|facade|façade|azulejo|tiles|museum|art|painting|sculpture|gallery|designed)\b/i },
  { id: "culture", label: "Culture & Legends", covers: "myths, folklore, literature, film, music, festivals", keywords: /\b(legend|myth|folklore|fado|poet|novel|film|music|theatre|theater|festival|literature)\b/i },
  { id: "curiosities", label: "Curiosities", covers: "odd facts, little-known stories, trivia", keywords: /\b(oldest|smallest|largest|only|unusual|strange|secret|legend|first)\b/i },
];

/** The walks offered on the start screen, in order. */
export const WALKS = LENSES.filter((l) => l.walk);

const BY_ID = new Map(LENSES.map((l) => [l.id, l]));

/** @param {string[]} ids @returns {Lens[]} */
export function resolveLenses(ids) {
  const list = ids.map((id) => BY_ID.get(id)).filter(Boolean);
  return list.length ? list : [BY_ID.get("history")];
}

/**
 * 0..1: how well a text fits the chosen lenses. "Surprise me" scores everything neutrally.
 * @param {string} text @param {Lens[]} lenses
 */
export function lensFit(text, lenses) {
  let best = 0;
  for (const lens of lenses) {
    if (!lens.keywords) {
      best = Math.max(best, 0.5);
      continue;
    }
    const matches = text.match(new RegExp(lens.keywords.source, "gi"))?.length ?? 0;
    best = Math.max(best, Math.min(1, matches / 3));
  }
  return best;
}
