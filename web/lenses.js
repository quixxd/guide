// Lenses: the angle the commentary takes. Ported from server/lenses.ts.
// The prototype uses History by default (spec rev2 §3.2); a lens switch comes in iteration 2.

/** @typedef {{ id: string, label: string, covers: string, keywords: RegExp | null }} Lens */

/** @type {Lens[]} */
export const LENSES = [
  { id: "surprise", label: "Surprise me", covers: "a balanced mix, leaning on whatever is most remarkable about the place", keywords: null },
  { id: "history", label: "History", covers: "how the place came to be, eras, events, who lived here and what happened here, told the way a good walking-tour guide would, with architecture, legends and everyday life woven in where they serve the story", keywords: /\b(century|centuries|founded|built in|medieval|roman|moorish|king|queen|battle|siege|earthquake|empire|ancient|history)\b/i },
  { id: "today", label: "Today", covers: "what the place is like now: daily life, what's going on, the vibe", keywords: /\b(today|currently|now|popular|nightlife|residents|tourists|modern|contemporary)\b/i },
  { id: "architecture", label: "Architecture & Art", covers: "buildings and styles, artworks, artists, design", keywords: /\b(architect|architecture|style|baroque|gothic|manueline|romanesque|neoclassical|facade|façade|azulejo|tiles|museum|art|painting|sculpture|gallery|designed)\b/i },
  { id: "people", label: "People & Society", covers: "how people live and lived, communities, traditions, social issues", keywords: /\b(residents|community|working.class|neighbourhood|neighborhood|tradition|festival|daily life|immigrant|poverty|housing)\b/i },
  { id: "food", label: "Food & Drink", covers: "local cuisine and produce, and notable places to eat and drink along the way", keywords: /\b(restaurant|café|cafe|bakery|pastry|pastelaria|food|wine|market|tavern|bar|cuisine|dish)\b/i },
  { id: "culture", label: "Culture & Legends", covers: "myths, folklore, literature, film, music, festivals", keywords: /\b(legend|myth|folklore|fado|poet|novel|film|music|theatre|theater|festival|literature)\b/i },
  { id: "religion", label: "Religion & Belief", covers: "faiths and their places of worship, religious history, rituals, pilgrimages", keywords: /\b(church|cathedral|chapel|convent|monastery|basilica|sé|mosque|synagogue|saint|religious|pilgrim|order|jesuit|franciscan|shrine)\b/i },
  { id: "curiosities", label: "Curiosities", covers: "odd facts, little-known stories, trivia", keywords: /\b(oldest|smallest|largest|only|unusual|strange|secret|legend|first)\b/i },
];

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
