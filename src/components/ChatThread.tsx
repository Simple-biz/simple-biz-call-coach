import { useEffect, useRef } from "react";
import { Mic, MessageSquare, FileText, Code } from "lucide-react";
import { GreetingsSelector } from "./GreetingsSelector";
import type { Transcription, ScriptOption, CallState } from "@/types";

interface ChatThreadProps {
  transcriptions: Transcription[];
  callState: CallState;
  isLoadingScripts: boolean; // From store
  onSelectScript: (option: ScriptOption) => void; // Wrapped handler
  onExportText?: () => void;
  onExportJSON?: () => void;
}

export function ChatThread({
  transcriptions,
  callState,
  isLoadingScripts,
  onSelectScript,
  onExportText,
  onExportJSON,
}: ChatThreadProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logic
  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (container) {
      const isNearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 150;

      if (isNearBottom && transcriptEndRef.current) {
        transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    } else if (transcriptEndRef.current) {
        transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [transcriptions]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="flex-1 px-4 pb-4 overflow-hidden flex flex-col h-full">
      <div className="bg-card/50 backdrop-blur-sm rounded-xl border border-white/5 flex flex-col shadow-inner h-full overflow-hidden">
        {/* Thread Header */}
        <div className="p-3 border-b border-white/5 flex items-center justify-between bg-white/5 rounded-t-xl shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-purple-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              Live Thread
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {transcriptions.filter((t) => t.isFinal).length > 0 && (
              <>
                <button
                  onClick={onExportText}
                  className="p-1.5 text-gray-500 hover:text-white transition-colors"
                  title="Export as Text"
                >
                  <FileText size={14} />
                </button>
                <button
                  onClick={onExportJSON}
                  className="p-1.5 text-gray-500 hover:text-white transition-colors"
                  title="Export as JSON"
                >
                  <Code size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Thread Messages */}
        <div
          ref={scrollContainerRef}
          className="flex-1 p-2 space-y-2 overflow-y-auto min-h-0 custom-scrollbar"
        >
          {transcriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-gray-800/50 flex items-center justify-center border border-white/5">
                <Mic className="w-6 h-6 text-gray-600 animate-pulse" />
              </div>
              <p className="text-sm text-gray-500 italic max-w-[200px]">
                {callState === "active"
                  ? "Listening for conversation..."
                  : "Start a call to see the live conversation thread"}
              </p>
            </div>
          ) : (
            <>
              {transcriptions
                .filter((t) => t.text && t.text.trim().length > 0)
                .map((t, index) => (
                  <div
                    key={t.id || index}
                    className={`flex flex-col ${
                      t.speaker === "agent" ? "items-end" : "items-start"
                    } group animate-in slide-in-from-bottom-1 duration-300`}
                  >
                    <div className="flex items-center gap-2 mb-0.5 px-1">
                      <span className="text-[9px] font-bold text-gray-500 uppercase">
                        {t.speaker === "agent" ? "You" : "Customer"}
                      </span>
                      <span className="text-[9px] text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatTime(t.timestamp)}
                      </span>
                    </div>
                    <div
                      className={`max-w-[92%] p-2.5 rounded-xl text-[13.5px] shadow-sm transition-all duration-200 leading-relaxed ${
                        t.speaker === "agent"
                          ? "bg-purple-600 text-white rounded-tr-none"
                          : "bg-gray-800 text-gray-100 rounded-tl-none border border-white/5"
                      } ${
                        !t.isFinal
                          ? "opacity-70 italic scale-[0.98]"
                          : "scale-100"
                      }`}
                    >
                      {t.text}
                      {!t.isFinal && (
                        <span className="ml-1 inline-flex gap-0.5">
                          <span
                            className="w-1 h-1 bg-current rounded-full animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <span
                            className="w-1 h-1 bg-current rounded-full animate-bounce"
                            style={{ animationDelay: "200ms" }}
                          />
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </>
          )}

           {/* Anchor for auto-scroll */}
           <div ref={transcriptEndRef} className="h-px w-full" />
        </div>

        {/* AI Suggestion Area - Fixed at bottom of thread container */}
        <div className="p-2 border-t border-white/5 bg-gray-900/30 backdrop-blur-sm">
             <GreetingsSelector
                isLoading={isLoadingScripts}
                onSelect={onSelectScript}
              />
        </div>
      </div>
    </div>
  );
}
