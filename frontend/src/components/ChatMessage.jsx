import ReactMarkdown from 'react-markdown'
import { ShieldHalf, AlertTriangle } from 'lucide-react'
import SourcesPanel from './SourcesPanel'

export default function ChatMessage({ role, content, sources, error }) {
  const isUser = role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in-up">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[var(--blue)] px-4 py-2.5 text-sm text-white shadow-sm">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 animate-fade-in-up">
      <div
        className={`shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center shadow-sm ${
          error ? 'bg-[var(--red)]' : 'bg-[var(--orange)]'
        }`}
      >
        {error ? <AlertTriangle size={15} className="text-white" /> : <ShieldHalf size={15} className="text-white" />}
      </div>
      <div className="min-w-0 max-w-[85%] flex-1">
        <div
          className={`rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed shadow-sm ${
            error
              ? 'bg-red-50 border border-[var(--red)]/30 text-red-900'
              : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)]'
          }`}
        >
          <div className="prose-ink max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        </div>
        {sources && <SourcesPanel {...sources} />}
      </div>
    </div>
  )
}
