import { useState } from 'react';
import { Send, Play, Settings2, Database, RefreshCw } from 'lucide-react';
import { useCallStore } from '@/stores/call-store';
import type { Transcription } from '@/types';
import { logger } from '@/utils/logger';

interface DeveloperModeProps {
  enabled: boolean;
}

export function DeveloperMode({ enabled }: DeveloperModeProps) {
  const { environment, setEnvironment } = useCallStore();
  const [speaker, setSpeaker] = useState<'agent' | 'customer'>('customer');
  const [messageText, setMessageText] = useState('');
  const [selectedScenario, setSelectedScenario] = useState('');
  const [autoResponse, setAutoResponse] = useState(true);

  if (!enabled) return null;

  const handleSendMessage = () => {
    if (!messageText.trim()) return;

    logger.log(`📨 [DevMode] Sending manual ${speaker} message:`, messageText);

    // Create transcription
    const transcription: Transcription = {
      id: `manual-${Date.now()}`,
      text: messageText,
      speaker,
      timestamp: Date.now(),
      confidence: 1.0,
      isFinal: true,
    };

    // Add to store
    useCallStore.getState().addTranscription(transcription);

    // If auto-response enabled and this was a customer message, trigger AI suggestion
    if (autoResponse && speaker === 'customer') {
      // Send to backend for AI suggestion
      chrome.runtime.sendMessage({
        type: 'MANUAL_TRANSCRIPT',
        payload: {
          speaker: 'caller',
          text: messageText,
          isFinal: true,
          timestamp: Date.now(),
        },
      }).catch(err => logger.error('Failed to send manual transcript:', err));
    }

    // Clear input
    setMessageText('');
  };

  const handleLoadScenario = () => {
    if (!selectedScenario) return;

    logger.log(`🎬 [DevMode] Loading scenario:`, selectedScenario);

    // Import and inject mock data
    import('@/test/mock-call-data').then(module => {
      module.injectMockCallData();
      logger.log('✅ [DevMode] Scenario loaded successfully');
    }).catch(err => {
      logger.error('❌ [DevMode] Failed to load scenario:', err);
    });
  };

  const handleToggleEnvironment = () => {
    const newEnv = environment === 'production' ? 'sandbox' : 'production';
    setEnvironment(newEnv);
    logger.log(`🔧 [DevMode] Environment switched to: ${newEnv}`);
  };

  const mockScenarios = [
    { id: 'scenario-bella-vista', name: 'Bella Vista (Happy Path)' },
    { id: 'scenario-angry-refund', name: 'Angry Customer' },
    { id: 'scenario-seo-pivot', name: "Dave's Plumbing (Direct Owner)" },
    { id: 'scenario-gatekeeper', name: 'Corporate Gatekeeper' },
  ];

  return (
    <div className="border-t border-white/10 bg-gradient-to-br from-blue-900/20 to-purple-900/20 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-bold text-white">Developer Mode</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${
            environment === 'sandbox'
              ? 'bg-blue-100 text-blue-700 border-blue-300'
              : 'bg-green-100 text-green-700 border-green-300'
          }`}>
            {environment.toUpperCase()}
          </span>
        </div>
        <button
          onClick={handleToggleEnvironment}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Switch to {environment === 'production' ? 'Sandbox' : 'Production'}
        </button>
      </div>

      {/* Environment Info */}
      <div className="mb-4 p-3 bg-black/20 rounded-lg border border-white/5">
        <div className="text-xs text-gray-400 space-y-1">
          <div className="flex justify-between">
            <span>WebSocket:</span>
            <span className="font-mono text-gray-300">
              {environment === 'sandbox' ? 'ws://localhost:8080' : useCallStore.getState().websocketUrl}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Mode:</span>
            <span className="text-gray-300">
              {environment === 'sandbox' ? 'Mock Data (Offline)' : 'Live AWS Lambda'}
            </span>
          </div>
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-gray-300 mb-2">
          Load Test Scenario
        </label>
        <div className="flex gap-2">
          <select
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            className="flex-1 px-3 py-2 text-sm bg-gray-800 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a scenario...</option>
            {mockScenarios.map(scenario => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name}
              </option>
            ))}
          </select>
          <button
            onClick={handleLoadScenario}
            disabled={!selectedScenario}
            className="flex items-center gap-1 px-3 py-2 text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            <Play className="w-3 h-3" />
            Load
          </button>
        </div>
      </div>

      {/* Manual Message Input */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-gray-300">
          Manual Message Input
        </label>

        {/* Speaker Selector */}
        <div className="flex gap-2">
          <button
            onClick={() => setSpeaker('customer')}
            className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              speaker === 'customer'
                ? 'bg-blue-600 text-white border-2 border-blue-400'
                : 'bg-gray-800 text-gray-400 border-2 border-white/10 hover:border-blue-400/50'
            }`}
          >
            Customer
          </button>
          <button
            onClick={() => setSpeaker('agent')}
            className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${
              speaker === 'agent'
                ? 'bg-purple-600 text-white border-2 border-purple-400'
                : 'bg-gray-800 text-gray-400 border-2 border-white/10 hover:border-purple-400/50'
            }`}
          >
            Agent (You)
          </button>
        </div>

        {/* Message Textarea */}
        <div className="relative">
          <textarea
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={`Type a ${speaker} message... (Press Enter to send, Shift+Enter for new line)`}
            className="w-full px-3 py-2 text-sm bg-gray-800 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={3}
          />
        </div>

        {/* Send Button & Auto-Response Toggle */}
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoResponse}
              onChange={(e) => setAutoResponse(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <span>Auto AI Response (for customer messages)</span>
          </label>
          <button
            onClick={handleSendMessage}
            disabled={!messageText.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-semibold"
          >
            <Send className="w-4 h-4" />
            Send as {speaker === 'agent' ? 'Agent' : 'Customer'}
          </button>
        </div>
      </div>

      {/* Info Note */}
      <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <Database className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-300">
            <p className="font-semibold mb-1">Sandbox Mode Features:</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-200">
              <li>No internet required - fully offline</li>
              <li>Mock WebSocket server at localhost:8080</li>
              <li>Uses Mark's 28 Golden Scripts locally</li>
              <li>Pre-loaded test scenarios for quick testing</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
