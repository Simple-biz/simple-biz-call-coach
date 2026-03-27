import { Smile, Frown, Meh, TrendingUp, MapPin, Calendar, Mail, Phone, Globe, Building2, User } from 'lucide-react'
import type { ConversationIntelligence, ExtractedEntities } from '@/types'

interface IntelligenceDisplayProps {
  intelligence: ConversationIntelligence | null
  entities: ExtractedEntities | null
  isRecording: boolean
}

export function IntelligenceDisplay({ intelligence, entities, isRecording }: IntelligenceDisplayProps) {
  // Always show component with placeholders to indicate readiness
  // Use data if available, otherwise defaults
  const sentiment = intelligence?.sentiment || { label: 'neutral', score: 0, averageScore: 0 };
  const intents = intelligence?.intents || [];
  const topics = intelligence?.topics || [];

  // Entities with defaults
  const businessNames = entities?.businessNames || [];
  const emails = entities?.contactInfo?.emails || [];
  const phones = entities?.contactInfo?.phoneNumbers || [];
  const websites = entities?.contactInfo?.urls || [];
  const locations = entities?.locations || [];
  const dates = entities?.dates || [];
  const people = entities?.people || [];

  const getSentimentIcon = (label: string) => {
    switch (label) {
      case 'positive': return <Smile className="w-5 h-5 text-green-400" />
      case 'negative': return <Frown className="w-5 h-5 text-red-400" />
      case 'neutral': return <Meh className="w-5 h-5 text-gray-400" />
      default: return <Meh className="w-5 h-5 text-gray-600" />
    }
  }

  const getSentimentColor = (label: string) => {
    switch (label) {
      case 'positive': return 'text-green-400 bg-green-500/10 border-green-500/30'
      case 'negative': return 'text-red-400 bg-red-500/10 border-red-500/30'
      case 'neutral': return 'text-gray-400 bg-gray-500/10 border-gray-500/30'
      default: return 'text-gray-500 bg-gray-500/5 border-gray-500/20'
    }
  }

  return (
    <div className="space-y-4 mb-4">
      {/* Section Header */}
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-[#1B1F6B]" />
        <span className="text-sm font-medium text-[#333333]">Conversation Intelligence</span>
        {isRecording && !intelligence && (
           <span className="text-xs text-[#1B1F6B]/70 animate-pulse ml-auto">Analyzing...</span>
        )}
      </div>

      {/* Sentiment Display */}
      <div className={`p-3 rounded-lg border ${getSentimentColor(sentiment.label as string)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getSentimentIcon(sentiment.label as string)}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#757575]">
                Customer Sentiment
              </div>
              <div className="text-sm font-medium capitalize text-[#333333]">
                {sentiment.label || 'Pending...'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-[#333333]">
              {sentiment.score ? `${Math.round(sentiment.score * 100)}%` : '--'}
            </div>
            <div className="text-xs text-[#757575]">confidence</div>
          </div>
        </div>
      </div>

      {/* Extracted Entities Grid - 2 columns */}
      <div className="grid grid-cols-2 gap-1.5 text-sm">
        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd]">
          <Building2 className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">Business</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {businessNames.length > 0 ? businessNames.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd]">
          <Mail className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">Email</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {emails.length > 0 ? emails.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd]">
          <Phone className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">Phone</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {phones.length > 0 ? phones.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd]">
          <Globe className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">Website</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {websites.length > 0 ? websites.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd]">
          <MapPin className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">Location</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {locations.length > 0 ? locations.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd]">
          <Calendar className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">Dates</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {dates.length > 0 ? dates.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-1.5 rounded bg-[#F5F7FA] border border-[#dddddd] col-span-2">
          <User className="w-3.5 h-3.5 text-[#1B1F6B] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] text-[#757575]">People</div>
            <div className="text-xs font-medium text-[#333333] truncate">
               {people.length > 0 ? people.join(', ') : <span className="text-[#757575] italic">--</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Top Intents & Topics */}
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div>
          <div className="text-xs text-[#757575] mb-1">Customer Intent</div>
          <div className="flex flex-wrap gap-1">
            {intents.length > 0 ? intents.slice(0, 2).map((intent, idx) => (
              <span key={idx} className="px-1.5 py-0.5 text-[10px] bg-[#1B1F6B]/20 text-[#1B1F6B] rounded border border-[#1B1F6B]/30 truncate max-w-full">
                {intent.intent}
              </span>
            )) : <span className="text-xs text-[#757575] italic">--</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#757575] mb-1">Discussion Topics</div>
           <div className="flex flex-wrap gap-1">
            {topics.length > 0 ? topics.slice(0, 2).map((topic, idx) => (
              <span key={idx} className="px-1.5 py-0.5 text-[10px] bg-[#1B1F6B]/20 text-[#1B1F6B] rounded border border-[#1B1F6B]/30 truncate max-w-full">
                {topic.topic}
              </span>
            )) : <span className="text-xs text-[#757575] italic">--</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
