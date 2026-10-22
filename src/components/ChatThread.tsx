import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Mic, MessageSquare, FileText, Code, Maximize2, Minimize2, ArrowDown } from "lucide-react";
import { GreetingsSelector } from "./GreetingsSelector";
import { useSettingsStore } from "@/stores/settings-store";
import { highlightText } from "@/utils/highlightKeywords";
import { groupTranscriptions } from "@/utils/group-transcript";
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
  /** Side-panel compact mode: collapsed view also shows the caller's latest paragraph. */
  compact?: boolean;
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
  compact,
}: ChatThreadProps) {
  const paragraphs = useMemo(() => groupTranscriptions(transcriptions), [transcriptions]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const highlightKeywords = useSettingsStore((s) => s.highlightKeywords);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll: follow the newest words unless the agent has scrolled up to read something.
  // "Following" is decided by the agent's own scrolling, not re-measured after each update: a
  // lead's paragraph can grow by several lines at once, and the old "within 150px of the
  // bottom AFTER the update" check quietly stopped following on exactly those turns.
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  const jumpToBottom = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  };

  const onScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    followingRef.current = atBottom;
    setFollowing(atBottom);
  };

  useLayoutEffect(() => {
    if (followingRef.current) jumpToBottom();
  }, [transcriptions]);

  const resumeFollowing = () => {
    followingRef.current = true;
    setFollowing(true);
    jumpToBottom();
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Collapsed state — the suggested line stays visible above a bar that reopens the thread.
  // (It used to be just the bar, so collapsing the thread also hid the script.)
  if (collapsed && !expanded) {
    const finalCount = transcriptions.filter(t => t.isFinal).length;
    const lastCaller = [...paragraphs].reverse().find((p) => p.speaker === "customer");
    return (
      <div className={`px-3 pb-2 shrink-0 space-y-2 ${compact ? "pt-2" : "mt-auto"}`}>
        <div className="p-2 border border-[#dddddd] bg-[#F5F7FA] rounded-xl">
          <GreetingsSelector isLoading={isLoadingScripts} onSelect={onSelectScript} />
        </div>
        {/* Compact mode drops the thread, but agents still copy numbers off the caller's
            last answer — keep that one paragraph. */}
        {compact && lastCaller && (
          <div className="px-3 py-2 bg-white rounded-xl border border-[#dddddd]">
            <div className="text-[10px] font-bold text-gray-500 uppercase mb-0.5">Customer said</div>
            <p className="text-[14px] leading-relaxed text-[#333333] line-clamp-4">
              {lastCaller.text}
              {lastCaller.interim && <span className="opacity-60 italic"> {lastCaller.interim}</span>}
            </p>
          </div>
        )}
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
        <div className="relative flex-1 min-h-0 flex flex-col">
        <div
          ref={scrollContainerRef}
          onScroll={onScroll}
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
              {/* One bubble per speaker turn: consecutive fragments are joined into a
                  paragraph so a lead's numbers read as one line. */}
              {paragraphs.map((p) => (
                  <div
                    key={p.id}
                    className={`flex flex-col ${
                      p.speaker === "agent" ? "items-end" : "items-start"
                    } group animate-in slide-in-from-bottom-1 duration-300`}
                  >
                    <div className="flex items-center gap-2 mb-0.5 px-1">
                      <span className="text-[9px] font-bold text-gray-500 uppercase">
                        {p.speaker === "agent" ? "You" : "Customer"}
                      </span>
                      <span className="text-[9px] text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatTime(p.timestamp)}
                      </span>
                    </div>
                    <div
                      className={`max-w-[92%] px-3 py-2 rounded-xl text-[14px] shadow-sm transition-all duration-200 leading-relaxed ${
                        p.speaker === "agent"
                          ? "bg-[#1B1F6B] text-white rounded-tr-none"
                          : "bg-[#F5F7FA] text-[#333333] rounded-tl-none border border-[#dddddd]"
                      }`}
                    >
                      {p.text && highlightText(p.text, highlightKeywords)}
                      {p.interim && (
                        <span className="opacity-70 italic">
                          {p.text ? " " : ""}{p.interim}
                        </span>
                      )}
                      {p.interim && (
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
        {!following && transcriptions.length > 0 && (
          <button
            onClick={resumeFollowing}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-white bg-[#1B1F6B] hover:bg-[#14174f] rounded-full shadow-md"
          >
            <ArrowDown className="w-3 h-3" /> Jump to latest
          </button>
        )}
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
