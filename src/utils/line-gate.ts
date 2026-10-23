/**
 * When a live coach line may replace the one on screen. Kayser, 2026-10-23: "when they say hmm it
 * generates a new response so sometimes the suggested line changes and sometimes I get caught like
 * I'm reading".
 *
 * The live model replies to any lead speech. Probed on the live model the same day: "Hmm." got
 * "Do you have a website right now?", "Mhm." got a new line, and "Uh-huh." was taken as a yes. Its
 * own transcript of the lead comes after the reply and garbles these sounds ("Mhm" came back as
 * "うん"), so the gate goes by timing, the way people take turns:
 *   - a short sound the lead makes while the agent is reading, with the agent still reading after
 *     it, is a backchannel: the reply to it is dropped and the line on screen stays;
 *   - any other reply that arrives while the agent is talking waits until the agent stops;
 *   - a reply to the lead speaking after the agent finished shows at once.
 *
 * "Talking" is any of the agent's transcripts (interim or final) in the last AGENT_QUIET_MS. Those
 * arrive up to a second late, so a quick answer to the agent's question ("Doing good, thanks" to
 * "How are you?") looks like it overlapped the agent. Kayser's next test call: that answer was taken
 * for a backchannel, the pitch was dropped and the call stalled. So overlap alone no longer drops a
 * reply: the agent must also have kept talking AGENT_CONTINUED_MS after the lead stopped.
 */
export const AGENT_QUIET_MS = 1500
export const BACKCHANNEL_MS = 1300
export const AGENT_CONTINUED_MS = 700

export type GateVerdict = 'show' | 'hold' | 'drop'

export class LineGate {
  private agentAt = Number.NEGATIVE_INFINITY
  private leadStartedAt = 0
  private leadStoppedAt = 0
  private overlapped = false
  private shortOverlap = false

  constructor(private now: () => number = Date.now) {}

  agentSpoke(): void {
    this.agentAt = this.now()
  }

  agentTalking(): boolean {
    return this.now() - this.agentAt < AGENT_QUIET_MS
  }

  /** How long until the agent counts as quiet. */
  msUntilQuiet(): number {
    return Math.max(0, this.agentAt + AGENT_QUIET_MS - this.now())
  }

  leadStarted(): void {
    this.leadStartedAt = this.now()
    this.overlapped = this.agentTalking()
    this.shortOverlap = false
  }

  leadStopped(): void {
    this.leadStoppedAt = this.now()
    this.shortOverlap = this.overlapped && this.leadStoppedAt - this.leadStartedAt < BACKCHANNEL_MS
  }

  /** For the reply to the lead's latest turn. Asked again when a held reply comes up for release. */
  verdict(): GateVerdict {
    if (this.shortOverlap && this.agentAt - this.leadStoppedAt >= AGENT_CONTINUED_MS) return 'drop'
    return this.agentTalking() ? 'hold' : 'show'
  }
}
