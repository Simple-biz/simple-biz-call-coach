// Pricing is Bob's job. Kept dependency-free so the root test suite can import it
// without the infra packages (the Anthropic SDK) installed.

export const PRICING_REDIRECT = "I honestly don't want to give you the wrong number — it really depends on what you need. Would you mind if I have Bob or his partner give you a call to go over options and pricing?";

// Any spoken price figure: "$500", "500 dollars", "2k", "a few hundred", "couple thousand", "per month".
// Must NOT trip on the script's own "48,000 Page-1 rankings", on time ("for a month") or on
// counts ("thousands of businesses", "a hundred percent").
export function mentionsPrice(script: string): boolean {
  return /\$\s?\d|\b\d[\d,.]*\s*(dollars|bucks|k\b)|\b(a|one|two|three|five|few|couple|several|\d+)\s+(hundred|thousand)\b(?!\s+(of|percent))|\bper month\b/i.test(script);
}
