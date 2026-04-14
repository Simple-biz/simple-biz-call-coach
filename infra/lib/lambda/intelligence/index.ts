// v2 — hybrid prompt fixes + infra improvements
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getConnection } from '../shared/dynamo-client';
import { getRecentTranscriptsWithCount, saveAIRecommendation } from '../shared/postgres-client';
import {
  generateConversationIntelligence,
  IntelligenceResult,
  IntelligenceTranscript,
  ClientIntelligenceSnapshot
} from '../shared/intelligence-client';
import { generateAITip, generateAITipStreaming } from '../shared/claude-client-optimized';
import { sendToConnection } from '../shared/apigw-client';
import { getCachedIntelligence, setCachedIntelligence } from './cache';

// Track previous AI suggestions per conversation (Lambda memory — resets on cold start)
const previousSuggestionsCache: Record<string, string[]> = {};

// Track highest stage reached per conversation — never regress from CONVERSION/SIGNOFF
const stageHighWaterMark: Record<string, string> = {};

// Track established facts per conversation — prevents repeating questions about things already discussed
const conversationFacts: Record<string, Set<string>> = {};

/**
 * IntelligenceHandler Lambda Function
 *
 * Performance optimization: caches intelligence results in Lambda memory.
 * Auto-analysis (skipTip=true) runs every 10s and refreshes the cache.
 * Manual tip requests (skipTip=false) reuse cached intelligence to skip
 * the redundant Claude call, cutting response time by ~1-2 seconds.
 */

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestStartTime = Date.now();
  const connectionId = event.requestContext.connectionId!;
  const domain = event.requestContext.domainName!;
  const stage = event.requestContext.stage!;

  console.log('[Intelligence] connectionId:', connectionId, 'bodyLen:', event.body?.length || 0);

  try {
    // Get connection info
    const connection = await getConnection(connectionId);
    if (!connection) {
      console.error('[Intelligence] Connection not found');
      return { statusCode: 404, body: JSON.stringify({ type: 'ERROR', payload: { code: 'NOT_FOUND', message: 'Connection not found' } }) };
    }

    if (!connection.conversationId) {
      console.error('[Intelligence] No conversation ID associated with connection');
      return { statusCode: 400, body: JSON.stringify({ type: 'ERROR', payload: { code: 'NO_CONVERSATION', message: 'No active conversation' } }) };
    }

    const conversationId = connection.conversationId;

    // Parse message body (optional parameters)
    const body = JSON.parse(event.body || '{}');
    const {
      limit = 50,
      skipTip = false,
      skipIntelligence = false,
      transcripts: clientTranscripts,
      clientIntelligence: clientIntelligenceSnapshot
    } = body;

    console.log(`[Intelligence] Analyzing conversation: ${conversationId} (limit: ${limit}, skipTip: ${skipTip}, skipIntelligence: ${skipIntelligence}, clientTranscripts: ${clientTranscripts?.length || 0}, clientSnapshot: ${!!clientIntelligenceSnapshot})`);

    // 1. Check if we can use cached intelligence (for manual tip requests)
    const cached = (!skipTip || skipIntelligence) ? getCachedIntelligence(conversationId) : null;
    const clientIntelligence = normalizeClientIntelligence(clientIntelligenceSnapshot);
    const fallbackIntelligence: IntelligenceResult = {
      sentiment: { label: 'neutral', score: 0, averageScore: 0 },
      intents: [],
      topics: [],
      summary: 'Intelligence skipped or cached',
      entities: {
        businessNames: [],
        contactInfo: { emails: [], phoneNumbers: [], urls: [] },
        locations: [],
        dates: [],
        people: [],
        websiteStatus: 'unknown'
      },
      model: 'none'
    };
    const baseIntelligence = cached || clientIntelligence || fallbackIntelligence;

    // FAST PATH: Manual tip requests use the client transcript snapshot directly.
    // Skip DB query entirely so button-click latency stays low.
    const canSkipDb = !skipTip && clientTranscripts && clientTranscripts.length > 0;

    let transcripts: IntelligenceTranscript[];
    let transcriptCount: number;

    if (canSkipDb) {
      // Use client-provided transcripts (already chronological from client)
      transcripts = clientTranscripts;
      transcriptCount = clientTranscripts.length;
      console.log(`[Intelligence] FAST PATH: Using ${transcriptCount} client-provided transcripts (skipping DB)`);
    } else {
      // NORMAL PATH: Fetch from DB (auto-analysis or no cache)
      const dbResult = await getRecentTranscriptsWithCount(conversationId, limit);
      transcripts = dbResult.transcripts;
      transcriptCount = dbResult.count;

      if (transcripts.length === 0) {
        console.warn('[Intelligence] No transcripts found for analysis');
        return {
          statusCode: 200,
          body: JSON.stringify({ type: 'ERROR', payload: { code: 'NO_TRANSCRIPTS', message: 'No transcripts available' } })
        };
      }

      console.log(`[Intelligence] Fetched ${transcripts.length} transcripts (${transcriptCount} total) for analysis`);
    }

    // 2. Parallelize Intelligence and Tip Generation
    let intelligence;
    let cacheHit = false;
    let aiTipPayload: any = undefined;

    // Determine if we need to run intelligence analysis
    const shouldRunIntelligence = !skipIntelligence && !cached && !clientIntelligence;

    const intelligencePromise = shouldRunIntelligence 
      ? generateConversationIntelligence({ conversationId, transcripts })
      : Promise.resolve(baseIntelligence);

    if (cached || clientIntelligence) cacheHit = true;

    // If skipTip is false, we start generating the tip in parallel with intelligence
    if (!skipTip) {
      console.log(`[Intelligence] Generating AI tip (Parallel)...`);

      // Normalize transcripts for tip generation
      const chronological = canSkipDb ? [...transcripts] : [...transcripts].reverse();
      
      let turnCount = 0;
      let lastSpeaker = '';
      for (const t of chronological) {
        if (t.speaker !== lastSpeaker) {
          turnCount++;
          lastSpeaker = t.speaker;
        }
      }

      let callStage: 'greeting' | 'discovery' | 'objection' | 'closing' | 'conversion';
      if (turnCount < 4) callStage = 'greeting';
      else if (turnCount < 8) callStage = 'discovery';
      else if (turnCount < 14) callStage = 'objection';
      else callStage = 'closing';

      // Use baseIntelligence immediately — never block tip generation on fresh analysis.
      // On cache hit: baseIntelligence is already fresh (instant).
      // On cache miss: baseIntelligence is fallback (empty entities) — tip still starts immediately.
      // Fresh intelligence resolves in background and updates cache for next request.
      intelligence = baseIntelligence;
      
      if (shouldRunIntelligence) {
        intelligencePromise.then(freshIntelligence => {
          setCachedIntelligence(conversationId, freshIntelligence);
          console.log(`[Intelligence] Cache updated with fresh analysis (background)`);
        }).catch(err => {
          console.error('[Intelligence] Background intelligence refresh failed:', err);
        });
      }

      // Detect conversion and signoff (logic remains same, uses freshly resolved intelligence)
      const recentMsgs = canSkipDb ? transcripts.slice(-10) : transcripts.slice(0, 10);
      const recentCustomerMessages = recentMsgs.filter(t => t.speaker === 'caller').map(t => t.text.toLowerCase());
      
      const objectionPhrases = ['already have', 'i don\'t know', 'not sure', 'i don\'t need', 'not interested', 'i\'m good', 'no thanks', 'my developer', 'don\'t think', 'already said', 'already told'];
      const directSignals = ['yes', 'sure', 'okay', 'yeah', 'sounds good', "i'm good with that", "that's great", "that's fine", "that works", "i'm down", "i'm interested", "go ahead", "let's do it", "fine"];
      
      let hasDirectAgreement = false;
      const last3CustomerMsgs = recentCustomerMessages.slice(-3);
      for (let i = 0; i < last3CustomerMsgs.length; i++) {
        const msg = last3CustomerMsgs[i];
        if (directSignals.some(signal => msg.includes(signal)) && !objectionPhrases.some(p => msg.includes(p))) {
          hasDirectAgreement = true;
          break;
        }
      }

      const indirectSignals = ["have bob call", "call me back", "they can call", "have them call", "bob can call", "give me a call", "i'll take a call", "take a call from bob", "he can call", "bob call me", "can call me", "want to call", "set up a call", "schedule a call", "call tomorrow", "call me tomorrow", "call me at", "call me later", "here's my number", "my number is", "you can reach me", "reach me at", "send me a quick call", "give you my number", "give you my email"];
      const hasIndirectAgreement = recentCustomerMessages.some(msg => indirectSignals.some(signal => msg.includes(signal)));
      const callbackPatterns = ['call later', 'callback', 'quick call', 'call you back', 'give you a call', 'bob or his partner'];
      const askedCallback = recentMsgs.filter(t => t.speaker === 'agent').some(t => callbackPatterns.some(p => t.text.toLowerCase().includes(p)));
      const hasAgreed = (hasDirectAgreement && askedCallback) || hasIndirectAgreement;

      const hasEntityPhone = (intelligence.entities?.contactInfo?.phoneNumbers?.length ?? 0) > 0;
      const hasEntityEmail = (intelligence.entities?.contactInfo?.emails?.length ?? 0) > 0;
      const hasEntityName = (intelligence.entities?.people?.length ?? 0) > 0;
      const entityBasedConversion = hasEntityName && (hasEntityPhone || hasEntityEmail) && askedCallback;

      if (hasAgreed || entityBasedConversion) {
        callStage = 'conversion';
        const namePattern = /my name is|it's \w+|i'm \w+|ask for \w+|call me \w+/i;
        const numberPattern = /\d{5,}/;
        const timePattern = /after \d|before \d|around \d|at \d|at\d|\d+\s*pm|\d+\s*am|this afternoon|this evening|tomorrow|in the morning|tonight/i;
        const alreadyToldYou = /already (said|gave|told|talked)|i got it|yeah yeah|you have my|we already/i;

        const customerGaveName = recentCustomerMessages.some(msg => namePattern.test(msg));
        const customerGaveNumber = recentCustomerMessages.some(msg => numberPattern.test(msg));
        const customerGaveTime = recentCustomerMessages.some(msg => timePattern.test(msg));
        const customerFrustrated = recentCustomerMessages.some(msg => alreadyToldYou.test(msg));
        const entitySignoff = hasEntityName && (hasEntityPhone || hasEntityEmail);
        
        if ((customerGaveName && customerGaveTime) || (customerGaveName && customerGaveNumber) || customerFrustrated || entitySignoff) {
          callStage = 'signoff' as any;
        }
      }

      // Regression prevention
      const stageRank: Record<string, number> = { greeting: 0, discovery: 1, objection: 2, closing: 3, conversion: 4, signoff: 5 };
      const prevHighStage = stageHighWaterMark[conversationId];
      const currentRank = stageRank[callStage] ?? 0;
      const prevRank = prevHighStage ? (stageRank[prevHighStage] ?? 0) : 0;
      if (prevRank >= stageRank['conversion'] && currentRank < prevRank) callStage = prevHighStage as any;
      stageHighWaterMark[conversationId] = currentRank > prevRank ? callStage : (prevHighStage || callStage);

      // Facts accumulation
      if (!conversationFacts[conversationId]) conversationFacts[conversationId] = new Set();
      const facts = conversationFacts[conversationId];
      if (intelligence.entities?.websiteStatus === 'has_website') facts.add('Customer ALREADY HAS a website.');
      else if (intelligence.entities?.websiteStatus === 'no_website') facts.add('Customer does NOT have a website.');
      if (intelligence.entities?.businessNames?.length) facts.add(`Business: ${intelligence.entities.businessNames.join(', ')}`);
      if (intelligence.intents?.some((i: any) => i.intent === 'not_interested')) facts.add('Customer NOT INTERESTED.');
      if (intelligence.intents?.some((i: any) => i.intent === 'request_callback')) facts.add('Customer agreed to callback.');
      if (hasEntityName) facts.add(`Name collected: ${intelligence.entities!.people!.join(', ')}`);

      const contextWindow = 20;
      let recentTranscripts;
      if (canSkipDb) recentTranscripts = transcripts.slice(-contextWindow);
      else recentTranscripts = transcripts.slice(0, contextWindow).reverse();
      const conversationContext = recentTranscripts.map(t => `${t.speaker.toUpperCase()}: "${t.text}"`).join('\n');

      const prevSuggestions = previousSuggestionsCache[conversationId] || [];

      const aiTipStartTime = Date.now();
      let isFirstChunk = true;
      const aiTip = await generateAITipStreaming({
        conversationId,
        callStage,
        recentTranscript: conversationContext,
        conversationSummary: intelligence.summary,
        transcriptCount,
        previousSuggestions: prevSuggestions,
        conversationFacts: Array.from(facts),
        collectedInfo: {
          customerName: hasEntityName,
          businessName: (intelligence.entities?.businessNames?.length ?? 0) > 0,
          phoneNumber: hasEntityPhone,
          email: hasEntityEmail,
        },
      }, async (delta: string) => {
        await sendToConnection(connectionId, {
          type: 'TIP_CHUNK',
          payload: { delta, ...(isFirstChunk ? { heading: 'Generating...', stage: callStage } : {}) }
        }, domain, stage);
        isFirstChunk = false;
      });

      if (!previousSuggestionsCache[conversationId]) previousSuggestionsCache[conversationId] = [];
      previousSuggestionsCache[conversationId].push(aiTip.suggestion);
      if (previousSuggestionsCache[conversationId].length > 10) previousSuggestionsCache[conversationId] = previousSuggestionsCache[conversationId].slice(-10);

      const recommendationId = await saveAIRecommendation({
        conversation_id: conversationId,
        heading: aiTip.heading,
        stage: aiTip.stage,
        context: aiTip.context,
        option1_label: 'Best Match',
        option1_script: aiTip.suggestion,
        option2_label: 'Alternative',
        option2_script: aiTip.suggestion,
        option3_label: 'Alternative',
        option3_script: aiTip.suggestion
      });

      aiTipPayload = {
        heading: aiTip.heading,
        stage: aiTip.stage,
        context: aiTip.context,
        suggestion: aiTip.suggestion,
        recommendationId,
      };
    } else {
      // If skipTip is true, we just wait for intelligence to finish
      intelligence = await intelligencePromise;
      if (shouldRunIntelligence) {
        setCachedIntelligence(conversationId, intelligence);
      }
      console.log(`[Intelligence] Skipping AI tip generation (auto-analysis mode)`);
    }

    const totalLatency = Date.now() - requestStartTime;
    console.log(`[Intelligence] Done in ${totalLatency}ms (cache ${cacheHit ? 'HIT' : 'MISS'})`);

    // 4. Return intelligence (+ AI tip if requested)
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 'INTELLIGENCE_UPDATE',
        payload: {
            intelligence: {
              sentiment: intelligence.sentiment,
              intents: intelligence.intents,
              topics: intelligence.topics,
              summary: intelligence.summary,
            },
            entities: intelligence.entities,
            ...(aiTipPayload ? { aiTip: aiTipPayload } : {}),
            timestamp: Date.now()
        }
      })
    };

  } catch (error: any) {
    console.error('[Intelligence] Error:', error);
    const totalLatency = Date.now() - requestStartTime;
    console.error(`[Intelligence] Failed after ${totalLatency}ms:`, error.message);

    // Return error via route response
    return {
      statusCode: 200,
      body: JSON.stringify({
        type: 'ERROR',
        payload: {
          message: 'Intelligence analysis temporarily unavailable',
          code: 'INTELLIGENCE_ERROR',
          timestamp: Date.now()
        }
      })
    };
  }
};

function normalizeClientIntelligence(snapshot: ClientIntelligenceSnapshot | undefined): IntelligenceResult | null {
  if (!snapshot) {
    return null;
  }

  const hasIntelligence = !!snapshot.intelligence;
  const hasEntities = !!snapshot.entities;

  if (!hasIntelligence && !hasEntities) {
    return null;
  }

  return {
    sentiment: {
      label: snapshot.intelligence?.sentiment?.label || 'neutral',
      score: snapshot.intelligence?.sentiment?.score || 0,
      averageScore: snapshot.intelligence?.sentiment?.averageScore || snapshot.intelligence?.sentiment?.score || 0
    },
    intents: snapshot.intelligence?.intents || [],
    topics: snapshot.intelligence?.topics || [],
    summary: snapshot.intelligence?.summary || 'Intelligence provided by client snapshot',
    entities: {
      businessNames: snapshot.entities?.businessNames || [],
      contactInfo: {
        emails: snapshot.entities?.contactInfo?.emails || [],
        phoneNumbers: snapshot.entities?.contactInfo?.phoneNumbers || [],
        urls: snapshot.entities?.contactInfo?.urls || []
      },
      locations: snapshot.entities?.locations || [],
      dates: snapshot.entities?.dates || [],
      people: snapshot.entities?.people || [],
      websiteStatus: snapshot.entities?.websiteStatus || 'unknown'
    },
    model: 'client-snapshot'
  };
}
