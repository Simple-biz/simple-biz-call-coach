import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock chrome.storage before import
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    },
  },
});

// Import the class (not the singleton, so we can create fresh instances)
import { aiCoachingService } from '@/services/ai-coaching-service';

// Access private fields via cast
const service = aiCoachingService as any;

describe('AICoachingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // Reset internal state
    service.config = null;
    service.lastRequestTime = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialize()', () => {
    it('should load config from chrome.storage', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
        aiCoachingEnabled: true,
        n8nWebhookUrl: 'https://n8n.example.com/webhook/test',
      });

      await aiCoachingService.initialize();

      const config = aiCoachingService.getConfig();
      expect(config).not.toBeNull();
      expect(config!.enabled).toBe(true);
      expect(config!.webhookUrl).toBe('https://n8n.example.com/webhook/test');
      expect(config!.timeoutMs).toBe(10000);
    });

    it('should default to disabled when storage is empty', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({});

      await aiCoachingService.initialize();

      const config = aiCoachingService.getConfig();
      expect(config!.enabled).toBe(false);
      expect(config!.webhookUrl).toBe('');
    });

    it('should handle storage errors gracefully', async () => {
      vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(
        new Error('Storage error')
      );

      await aiCoachingService.initialize();

      const config = aiCoachingService.getConfig();
      expect(config!.enabled).toBe(false);
    });
  });

  describe('updateConfig()', () => {
    it('should merge partial config updates', () => {
      service.config = { enabled: false, webhookUrl: '' };

      aiCoachingService.updateConfig({ enabled: true });

      expect(aiCoachingService.getConfig()!.enabled).toBe(true);
      expect(aiCoachingService.getConfig()!.webhookUrl).toBe('');
    });

    it('should create config if none exists', () => {
      service.config = null;

      aiCoachingService.updateConfig({ enabled: true, webhookUrl: 'https://test.com' });

      expect(aiCoachingService.getConfig()).not.toBeNull();
      expect(aiCoachingService.getConfig()!.enabled).toBe(true);
    });
  });

  describe('isReady()', () => {
    it('should return false when not initialized', () => {
      service.config = null;
      expect(aiCoachingService.isReady()).toBe(false);
    });

    it('should return false when disabled', () => {
      service.config = { enabled: false, webhookUrl: 'https://test.com' };
      expect(aiCoachingService.isReady()).toBe(false);
    });

    it('should return false when no webhook URL', () => {
      service.config = { enabled: true, webhookUrl: '' };
      expect(aiCoachingService.isReady()).toBe(false);
    });

    it('should return true when enabled with webhook URL', () => {
      service.config = { enabled: true, webhookUrl: 'https://test.com' };
      expect(aiCoachingService.isReady()).toBe(true);
    });
  });

  describe('getCoachingSuggestions()', () => {
    const mockContext = {
      transcript: 'I am interested in the pricing',
      speaker: 'caller' as const,
      timestamp: Date.now(),
    };

    beforeEach(() => {
      service.config = {
        enabled: true,
        webhookUrl: 'https://n8n.example.com/webhook/test',
        timeoutMs: 10000,
      };
      service.lastRequestTime = 0;
    });

    it('should return null when service is not ready', async () => {
      service.config = null;
      const result = await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(result).toBeNull();
    });

    it('should return null for empty transcript', async () => {
      const result = await aiCoachingService.getCoachingSuggestions({
        ...mockContext,
        transcript: '',
      });
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only transcript', async () => {
      const result = await aiCoachingService.getCoachingSuggestions({
        ...mockContext,
        transcript: '   ',
      });
      expect(result).toBeNull();
    });

    it('should throttle requests within MIN_REQUEST_INTERVAL', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true, coaching: { analysis: 'test', suggestions: [], priority: 'normal', category: 'info', timestamp: Date.now() } }))
      );

      // First request succeeds
      await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Second request immediately after should be throttled
      const result = await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(result).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should send correct payload to webhook', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          coaching: {
            analysis: 'Customer asking about pricing',
            suggestions: ['Mention current promotion'],
            priority: 'high',
            category: 'interest',
            timestamp: Date.now(),
          },
        }))
      );

      await aiCoachingService.getCoachingSuggestions(mockContext);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://n8n.example.com/webhook/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"transcript":"I am interested in the pricing"'),
        })
      );
    });

    it('should parse valid coaching response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          success: true,
          coaching: {
            analysis: 'Pricing interest detected',
            suggestions: ['Offer a discount', 'Show value proposition'],
            priority: 'high',
            category: 'interest',
            timestamp: 1234567890,
          },
        }))
      );

      const result = await aiCoachingService.getCoachingSuggestions(mockContext);

      expect(result).not.toBeNull();
      expect(result!.analysis).toBe('Pricing interest detected');
      expect(result!.suggestions).toHaveLength(2);
      expect(result!.priority).toBe('high');
      expect(result!.category).toBe('interest');
    });

    it('should return null on HTTP error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('Server Error', { status: 500, statusText: 'Internal Server Error' })
      );

      const result = await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(result).toBeNull();
    });

    it('should return null on invalid response format', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: false }))
      );

      const result = await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(result).toBeNull();
    });

    it('should return null on fetch timeout (AbortError)', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        Object.assign(new Error('Aborted'), { name: 'AbortError' })
      );

      const result = await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Network error')
      );

      const result = await aiCoachingService.getCoachingSuggestions(mockContext);
      expect(result).toBeNull();
    });
  });
});
