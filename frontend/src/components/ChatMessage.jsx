import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { AlertTriangle, Check, Copy, RefreshCw, Timer } from 'lucide-react'
import { BrandGlyph } from './BrandMark'
import SourcesPanel from './SourcesPanel'

function Action({ icon: Icon, label, onClick, done }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--ink)] px-1.5 py-1 rounded-md hover:bg-[var(--page)] transition-colors"
    >
      {done ? <Check size={12} className="text-[var(--green)]" /> : <Icon size={12} />}
      {done ? 'Copied' : label}
    </button>
  )
}

export default function ChatMessage({ role, content, sources, error, elapsed, onRegenerate }) {
  const [copied, setCopied] = useState(false)
  const isUser = role === 'user'

  async function copy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable (insecure context) — ignore */
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end animate-fade-in-up">
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-gradient-to-br from-[var(--blue)] to-[var(--violet)] px-4 py-2.5 text-sm text-white shadow-sm">
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3 animate-fade-in-up">
      {error ? (
        <div className="shrink-0 mt-0.5 h-9 w-9 rounded-xl bg-[var(--red)] flex items-center justify-center shadow-sm">
          <AlertTriangle size={16} className="text-white" />
        </div>
      ) : (
        <BrandGlyph size={36} className="shrink-0 mt-0.5" />
      )}

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

        {!error && (
          <div className="flex items-center gap-0.5 mt-1.5 ml-0.5">
            <Action icon={Copy} label="Copy" onClick={copy} done={copied} />
            {onRegenerate && <Action icon={RefreshCw} label="Retry" onClick={onRegenerate} />}
            {elapsed != null && (
              <span className="flex items-center gap-1 text-[11px] text-[var(--muted)] px-1.5 tabular">
                <Timer size={12} />
                {(elapsed / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        )}

        {sources && <SourcesPanel {...sources} />}
      </div>
    </div>
  )
}
