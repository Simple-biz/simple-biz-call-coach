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
        <TrendingUp className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-white">Conversation Intelligence</span>
        {isRecording && !intelligence && (
           <span className="text-xs text-purple-400/70 animate-pulse ml-auto">Analyzing...</span>
        )}
      </div>

      {/* Sentiment Display */}
      <div className={`p-3 rounded-lg border ${getSentimentColor(sentiment.label as string)}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getSentimentIcon(sentiment.label as string)}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Customer Sentiment
              </div>
              <div className="text-sm font-medium capitalize text-white">
                {sentiment.label || 'Pending...'}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-white">
              {sentiment.score ? `${Math.round(sentiment.score * 100)}%` : '--'}
            </div>
            <div className="text-xs text-gray-400">confidence</div>
          </div>
        </div>
      </div>

      {/* Extracted Entities Grid */}
      <div className="grid grid-cols-1 gap-2 text-sm">

        {/* Business */}
        <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <Building2 className="w-4 h-4 text-blue-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">Business</div>
            <div className="font-medium text-gray-200 truncate">
               {businessNames.length > 0 ? businessNames.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>

        {/* Email */}
        <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <Mail className="w-4 h-4 text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">Email</div>
            <div className="font-medium text-gray-200 truncate">
               {emails.length > 0 ? emails.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>

        {/* Phone */}
        <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <Phone className="w-4 h-4 text-green-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">Phone</div>
            <div className="font-medium text-gray-200 truncate">
               {phones.length > 0 ? phones.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>

        {/* Website */}
        <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">Website</div>
            <div className="font-medium text-gray-200 truncate">
               {websites.length > 0 ? websites.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <MapPin className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">Location</div>
            <div className="font-medium text-gray-200 truncate">
               {locations.length > 0 ? locations.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>

         {/* Dates */}
         <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <Calendar className="w-4 h-4 text-pink-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">Dates Mentioned</div>
            <div className="font-medium text-gray-200 truncate">
               {dates.length > 0 ? dates.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>

         {/* People */}
         <div className="flex items-center gap-3 p-2 rounded bg-gray-800/50 border border-gray-700/50">
          <User className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400">People</div>
            <div className="font-medium text-gray-200 truncate">
               {people.length > 0 ? people.join(', ') : <span className="text-gray-600 italic">--</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Top Intents & Topics */}
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div>
          <div className="text-xs text-gray-400 mb-1">Customer Intent</div>
          <div className="flex flex-wrap gap-1">
            {intents.length > 0 ? intents.slice(0, 2).map((intent, idx) => (
              <span key={idx} className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 rounded border border-purple-500/30 truncate max-w-full">
                {intent.intent}
              </span>
            )) : <span className="text-xs text-gray-600 italic">--</span>}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400 mb-1">Discussion Topics</div>
           <div className="flex flex-wrap gap-1">
            {topics.length > 0 ? topics.slice(0, 2).map((topic, idx) => (
              <span key={idx} className="px-1.5 py-0.5 text-[10px] bg-teal-500/20 text-teal-300 rounded border border-teal-500/30 truncate max-w-full">
                {topic.topic}
              </span>
            )) : <span className="text-xs text-gray-600 italic">--</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
