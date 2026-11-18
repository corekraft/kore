// A set of writer sessions' summed spend (#1093): raw tokens, the dollars of the models the price
// table prices, and the models it could not price, so a sum never reads an unpriced model as zero.

/** Summed spend: raw tokens, dollars of the priced models, and the unpriced models, sorted and each once. */
export interface WritingSpend {
  tokens: number;
  dollars: number;
  unpriced: string[];
}

/** No spend: the start of a sum. */
export const NO_SPEND: WritingSpend = { tokens: 0, dollars: 0, unpriced: [] };

/** Two spends summed, with their unpriced models joined. */
export function addSpend(a: WritingSpend, b: WritingSpend): WritingSpend {
  return {
    tokens: a.tokens + b.tokens,
    dollars: a.dollars + b.dollars,
    unpriced: [...new Set([...a.unpriced, ...b.unpriced])].sort(),
  };
}
