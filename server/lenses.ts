export type Lens = {
  id: string;
  label: string;
  /** Told to the narrator so it knows what the lens covers. */
  covers: string;
  /** Rough relevance signal used by the planner when picking among nearby places. */
  keywords: RegExp | null;
};

export const LENSES: Lens[] = [
  { id: "surprise", label: "Surprise me", covers: "a balanced mix, leaning on whatever is most remarkable about the place", keywords: null },
  { id: "history", label: "History", covers: "how the place came to be, eras, events, what happened here", keywords: /\b(century|centuries|founded|built in|medieval|roman|moorish|king|queen|battle|siege|earthquake|empire|ancient|history)\b/i },
  { id: "today", label: "Today", covers: "what the place is like now: daily life, what's going on, the vibe", keywords: /\b(today|currently|now|popular|nightlife|residents|tourists|modern|contemporary)\b/i },
  { id: "architecture", label: "Architecture & Art", covers: "buildings and styles, artworks, artists, design", keywords: /\b(architect|architecture|style|baroque|gothic|manueline|romanesque|neoclassical|facade|façade|azulejo|tiles|museum|art|painting|sculpture|gallery|designed)\b/i },
  { id: "people", label: "People & Society", covers: "how people live and lived, communities, traditions, social issues", keywords: /\b(residents|community|working.class|neighbourhood|neighborhood|tradition|festival|daily life|immigrant|poverty|housing)\b/i },
  { id: "economy", label: "Economy & Industry", covers: "what the place lives on: trade, work, wealth and poverty", keywords: /\b(trade|merchant|port|industry|factory|market|commerce|bank|economy|wealth|fishing|wine)\b/i },
  { id: "politics", label: "Politics & Power", covers: "who rules and ruled, conflicts, borders, current politics", keywords: /\b(palace|parliament|government|revolution|republic|monarchy|dictatorship|regime|minister|political|politics|council)\b/i },
  { id: "nature", label: "Nature & Landscape", covers: "geography, geology, climate, plants and animals", keywords: /\b(park|garden|river|beach|cliff|hill|mountain|forest|viewpoint|valley|coast|ocean|estuary|nature)\b/i },
  { id: "food", label: "Food & Drink", covers: "local cuisine and produce, and notable places to eat and drink along the way", keywords: /\b(restaurant|café|cafe|bakery|pastry|pastelaria|food|wine|market|tavern|bar|cuisine|dish)\b/i },
  { id: "culture", label: "Culture & Legends", covers: "myths, folklore, literature, film, music, festivals", keywords: /\b(legend|myth|folklore|fado|poet|novel|film|music|theatre|theater|festival|literature)\b/i },
  { id: "religion", label: "Religion & Belief", covers: "faiths and their places of worship, religious history, rituals, pilgrimages, how belief shapes the place", keywords: /\b(church|cathedral|chapel|convent|monastery|basilica|sé|mosque|synagogue|saint|religious|pilgrim|order|jesuit|franciscan|shrine)\b/i },
  { id: "famous", label: "Famous People", covers: "notable people who were born, lived, or worked here", keywords: /\b(born|lived|died|poet|writer|painter|statue of|monument to|explorer|navigator)\b/i },
  { id: "curiosities", label: "Curiosities", covers: "odd facts, little-known stories, trivia", keywords: /\b(oldest|smallest|largest|only|unusual|strange|secret|legend|first)\b/i },
];

const BY_ID = new Map(LENSES.map((l) => [l.id, l]));

export function resolveLenses(ids: unknown): Lens[] {
  const list = Array.isArray(ids) ? ids.map((id) => BY_ID.get(String(id))).filter((l): l is Lens => !!l) : [];
  return list.length ? list : [BY_ID.get("surprise")!];
}

/** 0..1: how well a text fits the chosen lenses. "Surprise me" scores everything neutrally. */
export function lensFit(text: string, lenses: Lens[]): number {
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
