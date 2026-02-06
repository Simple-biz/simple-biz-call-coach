import { Pool } from 'pg';

// PostgreSQL Client (reuse connection pool)
let pgPool: Pool | null = null;

function getPgPool(): Pool {
  if (!pgPool) {
    console.log(`[PostgreSQL] Initializing connection pool with URL: ${process.env.DATABASE_URL?.substring(0, 20)}...`);
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2, // Lambda concurrency limit
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: {
        rejectUnauthorized: false
      }
    });
  }
  return pgPool;
}

export interface Conversation {
  id: string;
  agent_id: string;
  start_time: Date;
  end_time?: Date;
  status: 'active' | 'ended';
  metadata?: Record<string, any>;
}

export interface Transcript {
  id: string;
  conversation_id: string;
  speaker: 'agent' | 'caller';
  text: string;
  timestamp: Date;
  is_final: boolean;
}

export interface AIRecommendation {
  id: string;
  conversation_id: string;
  heading: string; // Max 20 chars
  stage: string; // GREETING, DISCOVERY, VALUE_PROP, OBJECTION_HANDLING, NEXT_STEPS
  context?: string; // Why this recommendation makes sense
  option1_label: string; // e.g., "Minimal", "Direct", "Friendly"
  option1_script: string; // Actual words to say
  option2_label: string;
  option2_script: string;
  option3_label: string;
  option3_script: string;
  selected_option?: number; // 1, 2, or 3
  selected_at?: Date;
  created_at: Date;
}

export async function createConversation(agentId: string): Promise<string> {
  const pool = getPgPool();
  try {
    const result = await pool.query(
      'INSERT INTO conversations (agent_id, start_time, status) VALUES ($1, NOW(), $2) RETURNING id',
      [agentId, 'active']
    );
    const conversationId = result.rows[0].id;
    console.log(`[PostgreSQL] Conversation created: ${conversationId}`);
    return conversationId;
  } catch (error) {
    console.error('[PostgreSQL] Error creating conversation:', error);
    throw error;
  }
}

export async function endConversation(conversationId: string): Promise<void> {
  const pool = getPgPool();
  try {
    await pool.query(
      'UPDATE conversations SET end_time = NOW(), status = $1 WHERE id = $2',
      ['ended', conversationId]
    );
    console.log(`[PostgreSQL] Conversation ended: ${conversationId}`);
  } catch (error) {
    console.error('[PostgreSQL] Error ending conversation:', error);
    throw error;
  }
}

export async function saveTranscript(transcript: Omit<Transcript, 'id'>): Promise<void> {
  const pool = getPgPool();
  try {
    await pool.query(
      'INSERT INTO transcripts (conversation_id, speaker, text, timestamp, is_final) VALUES ($1, $2, $3, $4, $5)',
      [transcript.conversation_id, transcript.speaker, transcript.text, transcript.timestamp, transcript.is_final]
    );
    console.log(`[PostgreSQL] Transcript saved for conversation: ${transcript.conversation_id}`);
  } catch (error) {
    console.error('[PostgreSQL] Error saving transcript:', error);
    throw error;
  }
}

export async function getRecentTranscripts(conversationId: string, limit: number = 10): Promise<Transcript[]> {
  const pool = getPgPool();
  try {
    const result = await pool.query(
      'SELECT * FROM transcripts WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [conversationId, limit]
    );
    return result.rows;
  } catch (error) {
    console.error('[PostgreSQL] Error getting transcripts:', error);
    return [];
  }
}

export async function getTranscriptCount(conversationId: string): Promise<number> {
  const pool = getPgPool();
  try {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM transcripts WHERE conversation_id = $1',
      [conversationId]
    );
    return parseInt(result.rows[0].count);
  } catch (error) {
    console.error('[PostgreSQL] Error getting transcript count:', error);
    return 0;
  }
}

export async function saveAIRecommendation(recommendation: Omit<AIRecommendation, 'id' | 'created_at'>): Promise<string> {
  const pool = getPgPool();
  try {
    const result = await pool.query(
      `INSERT INTO ai_recommendations
       (conversation_id, heading, stage, context,
        option1_label, option1_script, option2_label, option2_script, option3_label, option3_script)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        recommendation.conversation_id,
        recommendation.heading.substring(0, 20), // Ensure max 20 chars
        recommendation.stage,
        recommendation.context || null,
        recommendation.option1_label,
        recommendation.option1_script,
        recommendation.option2_label,
        recommendation.option2_script,
        recommendation.option3_label,
        recommendation.option3_script
      ]
    );
    const recommendationId = result.rows[0].id;
    console.log(`[PostgreSQL] AI recommendation saved: ${recommendationId} for conversation: ${recommendation.conversation_id}`);
    return recommendationId;
  } catch (error) {
    console.error('[PostgreSQL] Error saving AI recommendation:', error);
    throw error;
  }
}

export async function getConversationSummary(conversationId: string): Promise<string> {
  const pool = getPgPool();
  try {
    const result = await pool.query(
      'SELECT summary FROM conversation_summaries WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
      [conversationId]
    );
    return result.rows[0]?.summary || '';
  } catch (error) {
    console.error('[PostgreSQL] Error getting conversation summary:', error);
    return '';
  }
}

// Cleanup on Lambda exit
export async function closePgPool(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
    console.log('[PostgreSQL] Connection pool closed');
  }
}
