import { useEffect, useRef } from "react";
import { Mic, MessageSquare, FileText, Code, Maximize2, Minimize2 } from "lucide-react";
import { GreetingsSelector } from "./GreetingsSelector";
import { useSettingsStore } from "@/stores/settings-store";
import { highlightText } from "@/utils/highlightKeywords";
import type { Transcription, ScriptOption, CallState } from "@/types";

interface ChatThreadProps {
  transcriptions: Transcription[];
  callState: CallState;
  isLoadingScripts: boolean;
  onSelectScript: (option: ScriptOption) => void;
  onExportText?: () => void;
  onExportJSON?: () => void;
  expanded?: boolean;
  collapsed?: boolean;
  onToggleExpand?: () => void;
  onToggleCollapse?: () => void;
}

export function ChatThread({
  transcriptions,
  callState,
  isLoadingScripts,
  onSelectScript,
  onExportText,
  onExportJSON,
  expanded,
  collapsed,
  onToggleExpand,
  onToggleCollapse,
}: ChatThreadProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const highlightKeywords = useSettingsStore((s) => s.highlightKeywords);
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

  // Collapsed state — just show a compact bar
  if (collapsed && !expanded) {
    const finalCount = transcriptions.filter(t => t.isFinal).length;
    return (
      <div className="px-3 pb-2 mt-auto shrink-0">
        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-white rounded-xl border border-[#dddddd] hover:border-[#1B1F6B]/30 transition-colors shadow-sm"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#1B1F6B]" />
            <span className="text-xs font-bold uppercase tracking-widest text-[#757575]">Live Thread</span>
            {finalCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[#1B1F6B]/10 text-[#1B1F6B] rounded-full font-semibold">
                {finalCount}
              </span>
            )}
          </div>
          <Maximize2 className="w-3.5 h-3.5 text-[#757575]" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 px-3 pb-2 overflow-hidden flex flex-col">
      <div className="bg-white backdrop-blur-sm rounded-xl border border-[#dddddd] flex flex-col shadow-inner flex-1 min-h-0 overflow-hidden">
        {/* Thread Header */}
        <div className="px-3 py-2 border-b border-[#dddddd] flex items-center justify-between bg-[#F5F7FA] rounded-t-xl shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-[#1B1F6B]" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#757575]">
              Live Thread
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {transcriptions.filter((t) => t.isFinal).length > 0 && (
              <>
                <button
                  onClick={onExportText}
                  className="p-1 text-gray-500 hover:text-[#333333] transition-colors"
                  title="Export as Text"
                >
                  <FileText size={13} />
                </button>
                <button
                  onClick={onExportJSON}
                  className="p-1 text-gray-500 hover:text-[#333333] transition-colors"
                  title="Export as JSON"
                >
                  <Code size={13} />
                </button>
              </>
            )}
            {onToggleCollapse && !expanded && (
              <button
                onClick={onToggleCollapse}
                className="p-1 text-gray-500 hover:text-[#1B1F6B] transition-colors"
                title="Collapse"
              >
                <Minimize2 size={13} />
              </button>
            )}
            {onToggleExpand && (
              <button
                onClick={onToggleExpand}
                className="p-1 text-gray-500 hover:text-[#1B1F6B] transition-colors"
                title={expanded ? "Normal view" : "Full screen"}
              >
                {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
          </div>
        </div>

        {/* Thread Messages */}
        <div
          ref={scrollContainerRef}
          className="flex-1 p-2 space-y-1.5 overflow-y-auto min-h-0 custom-scrollbar"
        >
          {transcriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-[#F5F7FA] flex items-center justify-center border border-[#dddddd]">
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
                      className={`max-w-[92%] px-2.5 py-1.5 rounded-xl text-[13px] shadow-sm transition-all duration-200 leading-snug ${
                        t.speaker === "agent"
                          ? "bg-[#1B1F6B] text-white rounded-tr-none"
                          : "bg-[#F5F7FA] text-[#333333] rounded-tl-none border border-[#dddddd]"
                      } ${
                        !t.isFinal
                          ? "opacity-70 italic scale-[0.98]"
                          : "scale-100"
                      }`}
                    >
                      {highlightText(t.text, highlightKeywords)}
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
        <div className="p-2 border-t border-[#dddddd] bg-[#F5F7FA] backdrop-blur-sm">
             <GreetingsSelector
                isLoading={isLoadingScripts}
                onSelect={onSelectScript}
              />
        </div>
      </div>
    </div>
  );
}
