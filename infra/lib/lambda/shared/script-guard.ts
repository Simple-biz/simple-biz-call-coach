// Deterministic checks that keep a suggestion inside the official call script
// (doc/reference/official-call-script.md). The prompt asks for all of this, but the model
// still slips now and then, and a slip is read out to a live lead. Dependency-free, like
// price-guard, so the root test suite can import it.

// The script's answer to anything the agent can't answer ("Are you able to do [technical question]?").
export const SCRIPT_DEFLECT = "Great question. I'm just Bob's assistant, so I don't want to give you the wrong answer. Would you mind if I have Bob or his partner give you a call to answer that for you?";

export const CALLBACK_ASK = 'Would you mind if I have Bob or his partner give you a call?';
export const THEM_ASK = 'Would you mind if I have them give you a call?';

// Claims the script never makes: past work ("we've built a ton of sites in Topeka",
// "a lot of shops we work with"), capabilities ("we can definitely set up online booking"),
// and company-name answers ("we don't have a formal company name"). The script's own
// "go over some examples of websites we've built for businesses like yours" must pass.
const UNSCRIPTED_CLAIMS: RegExp[] = [
  /\bwe(?:'ve| have)? (?:built|done|made|designed) (?:a ton|tons|a lot|lots|a bunch|plenty|many|dozens|hundreds|several|sites|websites|some sites)\b/i,
  /\b(?:clients?|businesses|shops|owners|companies|practices) (?:that |like yours )?we(?:'ve)? (?:work(?:ed)? with|helped)\b/i,
  /\b(?:can|will|could) (?:definitely |absolutely |totally |easily )?(?:set up|build|do|handle|add|integrate) (?:online|booking|e-?commerce|scheduling|payments?|ordering)\b/i,
  /\bdefinitely something (?:bob|we|they)\b/i,
  /\b(?:yes|yeah),? (?:we|bob) (?:can|does|do)\b/i,
  /\b(?:no|don't have a|do not have a|not a) (?:formal |real |official |fancy )?company name\b/i,
  /\bbob hansen'?s? (?:website|web design) (?:team|practice)\b/i,
  // Live coach mass test 2026-10-23: "we have worked with roofing businesses before", "Bob does both, he fixes broken sites".
  /\bwe(?:'ve| have)? (?:already )?worked with\b/i,
  /\b(?:bob|he|we) (?:also |can )?(?:fix(?:es)?|repairs?|does both)\b/i,
];

export function claimsUnscriptedFact(script: string): boolean {
  return UNSCRIPTED_CLAIMS.some(re => re.test(script));
}

// ALWAYS "Bob or his partner" when offering a callback.
export function addHisPartner(script: string): string {
  return script
    .replace(/\b(have|get) Bob (give|call|reach)\b/gi, '$1 Bob or his partner $2')
    .replace(/\bBob will (give|call|reach)\b/g, 'Bob or his partner will $1');
}

// Before the lead has said yes, every line ends with the callback question, never
// "Does that work?" / "Sound fair?". After agreement (conversion/signoff) a confirmation is fine.
const WEAK_ENDING = /\s*(?:[—-]\s*)?(?:does that work|would that work|sounds? fair|fair enough|sounds? good|makes? sense|is that okay)\s*\?\s*$/i;

export function fixWeakEnding(script: string, callStage: string): string {
  if (callStage === 'conversion' || callStage === 'signoff' || !WEAK_ENDING.test(script)) return script;
  const trimmed = script.replace(WEAK_ENDING, '').replace(/[\s,—-]+$/, '');
  if (/would you mind if i have bob or his partner/i.test(trimmed)) return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}?`;
  // A line that already names Bob or his partner ends the way the script's own rebuttals do
  // ("I'll have Bob or his partner give you a call... Would you mind if I have them give you a call?"),
  // not with the full callback ask repeated.
  const ask = /bob or his partner/i.test(trimmed) ? THEM_ASK : CALLBACK_ASK;
  return `${/[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`} ${ask}`;
}
