import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCallStore } from '@/stores/call-store';
import { awsWebSocketService } from '@/services/aws-websocket.service';
import type { AIBackendStatus, AIRecommendation } from '@/types';

/**
 * AI Tips Section Component
 *
 * Displays real-time AI coaching recommendations with:
 * - 2-word heading (max)
 * - Conversation stage indicator
 * - THREE clickable dialogue options (Minimal, Explanative, Contextual)
 * - Context explanation
 * - Loading/error states
 * - Auto-update every 30 seconds (after 3-min warmup)
 * - Clickable tips history
 */
export function AITipsSection() {
  const aiBackendStatus = useCallStore((state) => state.aiBackendStatus);
  const aiTips = useCallStore((state) => state.aiTips);
  const selectAIOption = useCallStore((state) => state.selectAIOption);
  const lastAIUpdate = useCallStore((state) => state.lastAIUpdate);
  const [showHistory, setShowHistory] = useState(false);
  const [countdown, setCountdown] = useState(30);

  // Get the most recent tip
  const latestTip = aiTips.length > 0 ? aiTips[aiTips.length - 1] : null;

  // Countdown timer for next update
  useEffect(() => {
    if (!lastAIUpdate || aiBackendStatus !== 'ready') return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastAIUpdate) / 1000);
      const remaining = Math.max(0, 30 - (elapsed % 30));
      setCountdown(remaining);
    }, 1000);

    return () => clearInterval(interval);
  }, [lastAIUpdate, aiBackendStatus]);

  // Handle option selection
  const handleOptionSelect = (tip: AIRecommendation, optionNumber: 1 | 2 | 3) => {
    // Update store to mark option as selected
    selectAIOption(tip.id, optionNumber);

    // Send selection to backend
    awsWebSocketService.selectOption(tip.recommendationId, optionNumber);

    console.log(`✅ [AITipsSection] Selected option ${optionNumber}:`, tip.options[optionNumber - 1].script);
  };

  // Render status indicator
  const renderStatusBadge = () => {
    const statusConfig: Record<AIBackendStatus, { color: string; text: string; icon: string }> = {
      disconnected: { color: 'bg-gray-500', text: 'Disconnected', icon: '○' },
      connecting: { color: 'bg-yellow-500', text: 'Connecting...', icon: '◐' },
      ready: { color: 'bg-green-500', text: 'AI Ready', icon: '●' },
      error: { color: 'bg-red-500', text: 'Error', icon: '✕' },
      reconnecting: { color: 'bg-orange-500', text: 'Reconnecting...', icon: '⟳' },
    };

    const config = statusConfig[aiBackendStatus];

    return (
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${config.color} animate-pulse`} />
        <span className="text-xs text-gray-500">
          {config.icon} {config.text}
        </span>
      </div>
    );
  };

  // Render loading state (warmup period)
  if (aiBackendStatus === 'ready' && aiTips.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 shadow-sm"
      >
        {renderStatusBadge()}
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="text-4xl mb-4"
          >
            ⏱️
          </motion.div>
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            AI Analyzing Conversation...
          </h3>
          <p className="text-xs text-blue-700 mb-3">
            Generating personalized suggestions based on the call context
          </p>
          {/* Loading skeleton */}
          <div className="w-full max-w-md space-y-2 mt-4">
            <motion.div
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="h-3 bg-blue-200 rounded w-3/4 mx-auto"
            />
            <motion.div
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
              className="h-3 bg-blue-200 rounded w-1/2 mx-auto"
            />
            <motion.div
              animate={{ opacity: [0.3, 0.6, 0.3] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
              className="h-3 bg-blue-200 rounded w-2/3 mx-auto"
            />
          </div>
        </div>
      </motion.div>
    );
  }

  // Render disconnected/error state
  if (aiBackendStatus === 'disconnected' || aiBackendStatus === 'error') {
    const errorDetails = aiBackendStatus === 'error'
      ? {
          title: 'Connection Lost',
          message: 'Unable to reach AI backend server',
          action: 'The backend may be offline or unreachable',
          suggestion: 'Your transcription will continue working normally',
        }
      : {
          title: 'AI Coaching Offline',
          message: 'Not connected to AI backend',
          action: 'Start a call and enable AI coaching from the popup',
          suggestion: null,
        };

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg p-4 shadow-sm"
      >
        {renderStatusBadge()}
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="text-4xl mb-4"
          >
            🤖
          </motion.div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            {errorDetails.title}
          </h3>
          <p className="text-xs text-gray-600 mb-1">
            {errorDetails.message}
          </p>
          <p className="text-xs text-gray-500 italic">
            {errorDetails.action}
          </p>
          {errorDetails.suggestion && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-3 px-3 py-2 bg-green-50 border border-green-200 rounded-lg"
            >
              <p className="text-xs text-green-700">
                ✓ {errorDetails.suggestion}
              </p>
            </motion.div>
          )}
        </div>
      </motion.div>
    );
  }

  // Render connecting/reconnecting state
  if (aiBackendStatus === 'connecting' || aiBackendStatus === 'reconnecting') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-gradient-to-br from-yellow-50 to-orange-50 border border-yellow-200 rounded-lg p-4 shadow-sm"
      >
        {renderStatusBadge()}
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
            className="text-4xl mb-4"
          >
            ⟳
          </motion.div>
          <h3 className="text-sm font-semibold text-yellow-900 mb-2">
            {aiBackendStatus === 'connecting' ? 'Connecting to AI...' : 'Reconnecting...'}
          </h3>
          <p className="text-xs text-yellow-700 mb-2">
            Establishing connection to AI backend
          </p>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "60%" }}
            transition={{ duration: 2, repeat: Infinity }}
            className="h-1 bg-yellow-400 rounded-full"
          />
        </div>
      </motion.div>
    );
  }

  // Render AI tip
  if (!latestTip) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        {renderStatusBadge()}
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="text-4xl mb-4">💭</div>
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            No Tips Yet
          </h3>
          <p className="text-xs text-gray-600">
            Keep talking - AI is listening
          </p>
        </div>
      </div>
    );
  }

  // Format timestamp for "Last updated"
  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000); // seconds

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  return (
    <motion.div
      key={latestTip.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
      className="bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 shadow-sm"
    >
      {renderStatusBadge()}

      {/* AI Tip Card with 3 Options */}
      <div className="space-y-3">
        {/* Heading + Stage */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <motion.span
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              className="text-2xl"
            >
              💡
            </motion.span>
            <h3 className="text-lg font-bold text-purple-900 uppercase tracking-wide">
              {latestTip.heading}
            </h3>
          </div>
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: "spring" }}
            className="text-xs px-2 py-1 bg-purple-200 text-purple-800 rounded-full font-semibold"
          >
            {latestTip.stage?.replace('_', ' ')}
          </motion.span>
        </motion.div>

        {/* Context - Why this recommendation */}
        {latestTip.context && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white/60 rounded-lg p-2 border border-purple-100"
          >
            <p className="text-xs italic text-gray-700">
              💭 {latestTip.context}
            </p>
          </motion.div>
        )}

        {/* 3 Dialogue Options */}
        <div className="space-y-2">
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-xs font-semibold text-purple-700 uppercase tracking-wide"
          >
            Choose your response:
          </motion.p>

          <AnimatePresence>
            {latestTip.options?.map((option, index) => {
              const optionNum = (index + 1) as 1 | 2 | 3;
              const isSelected = latestTip.selectedOption === optionNum;
              const isDisabled = latestTip.selectedOption !== undefined;

              return (
                <motion.button
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                  whileHover={!isDisabled ? { scale: 1.02, x: 4 } : {}}
                  whileTap={!isDisabled ? { scale: 0.98 } : {}}
                  onClick={() => !isDisabled && handleOptionSelect(latestTip, optionNum)}
                  disabled={isDisabled}
                  className={`
                    w-full text-left p-3 rounded-lg border-2 transition-all duration-200
                    ${isSelected
                      ? 'bg-purple-600 border-purple-700 text-white shadow-md'
                      : isDisabled
                        ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-60'
                        : 'bg-white border-purple-300 hover:border-purple-500 hover:bg-purple-50 cursor-pointer hover:shadow-lg'
                    }
                  `}
                >
                  <div className="flex items-start gap-2">
                    {isSelected && (
                      <motion.span
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ type: "spring", stiffness: 200 }}
                        className="text-lg"
                      >
                        ✓
                      </motion.span>
                    )}
                    <div className="flex-1">
                      <div className={`text-xs font-semibold mb-1 ${isSelected ? 'text-purple-100' : 'text-purple-700'}`}>
                        {option.label}
                      </div>
                      <div className={`text-sm ${isSelected ? 'font-medium' : 'text-gray-800'}`}>
                        "{option.script}"
                      </div>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Metadata */}
        <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-purple-200">
          <span className="flex items-center gap-1">
            <span>⏱️</span>
            <span>Updated {formatTimestamp(latestTip.timestamp)}</span>
          </span>
          {aiTips.length > 1 && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full font-medium hover:bg-purple-200 transition-colors cursor-pointer"
              title={showHistory ? "Hide tips history" : "Show tips history"}
            >
              {aiTips.length} tips {showHistory ? '▲' : '▼'}
            </button>
          )}
        </div>

        {/* Next update indicator with countdown */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="text-xs text-center text-gray-500 space-y-1"
        >
          <div className="flex items-center justify-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            >
              🔄
            </motion.span>
            <span>Next update in {countdown}s</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-gray-200 rounded-full h-1 overflow-hidden">
            <motion.div
              className="h-full bg-purple-400"
              animate={{ width: `${(countdown / 30) * 100}%` }}
              transition={{ duration: 1 }}
            />
          </div>
        </motion.div>

        {/* Tips History (Expandable) */}
        {showHistory && aiTips.length > 1 && (
          <div className="mt-4 pt-4 border-t border-purple-200 space-y-2">
            <h4 className="text-xs font-semibold text-purple-700 uppercase tracking-wide mb-3">
              Previous Tips ({aiTips.length - 1})
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {aiTips
                .slice(0, -1) // Exclude the latest tip (already shown above)
                .reverse()
                .map((tip) => (
                  <div
                    key={tip.id}
                    className="bg-white border border-purple-100 rounded-lg p-3 text-sm hover:border-purple-300 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-purple-700 uppercase">
                        {tip.heading}
                      </span>
                      <span className="text-xs text-gray-400">
                        {formatTimestamp(tip.timestamp)}
                      </span>
                    </div>
                    {/* Show selected option or all options */}
                    {tip.selectedOption ? (
                      <div className="text-xs text-gray-700 leading-relaxed">
                        <span className="font-semibold text-purple-600">
                          {tip.options[tip.selectedOption - 1].label}:
                        </span>{' '}
                        "{tip.options[tip.selectedOption - 1].script}"
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 italic">
                        No option selected
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * AI Tips History Component (Optional - shows all tips)
 *
 * Can be used to display a scrollable history of all AI tips
 */
export function AITipsHistory() {
  const aiTips = useCallStore((state) => state.aiTips);

  if (aiTips.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        Previous Tips ({aiTips.length})
      </h4>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {aiTips
          .slice()
          .reverse()
          .map((tip) => (
            <div
              key={tip.id}
              className="bg-white border border-gray-200 rounded-lg p-3 text-sm"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold text-purple-700 uppercase">
                  {tip.heading}
                </span>
                <span className="text-xs text-gray-400">
                  {new Date(tip.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {/* Show selected option or all options */}
              {tip.selectedOption ? (
                <div className="text-xs text-gray-700">
                  <span className="font-semibold text-purple-600">
                    {tip.options[tip.selectedOption - 1].label}:
                  </span>{' '}
                  "{tip.options[tip.selectedOption - 1].script}"
                </div>
              ) : (
                <div className="text-xs text-gray-500 italic">
                  No option selected
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
