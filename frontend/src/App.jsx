import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Download, Menu, Sparkles } from 'lucide-react'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'
import Sidebar from './components/Sidebar'
import Skyline from './components/Skyline'
import { BrandGlyph } from './components/BrandMark'
import { API_BASE } from './api'

const STORAGE_KEY = 'ccni.conversation.v1'

const QUICK_PROMPTS = [
  'Crime near N Lincoln Ave',
  'Policing in Englewood',
  'Criminal damage in the news',
  'Where are arrests highest?',
]

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export default function App() {
  const [messages, setMessages] = useState(loadSaved)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [status, setStatus] = useState('checking')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  const started = messages.length > 0

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)))
    } catch {
      /* quota or private mode — conversation just won't persist */
    }
  }, [messages])

  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/stats`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) {
          setStats(data)
          setStatus('online')
        }
      } catch {
        if (!cancelled) setStatus('offline')
      }
    }
    async function loadAnalytics() {
      try {
        const res = await fetch(`${API_BASE}/analytics`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setAnalytics(data)
      } catch {
        /* analytics is a nice-to-have; ignore failures */
      }
    }
    poll()
    loadAnalytics()
    const id = setInterval(poll, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    if (atBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, loading, atBottom])

  // Cmd/Ctrl+K focuses the composer, Escape blurs it
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape') inputRef.current?.blur()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const send = useCallback(
    async (query, { replaceLast = false } = {}) => {
      const q = (query ?? input).trim()
      if (!q || loading) return
      setInput('')
      setAtBottom(true)
      setMessages((m) => {
        const base = replaceLast ? m.slice(0, -1) : m
        return replaceLast ? base : [...base, { role: 'user', content: q }]
      })
      setLoading(true)
      const t0 = performance.now()

      try {
        const res = await fetch(`${API_BASE}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, top_k: 5 }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Request failed')

        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: data.answer,
            query: q,
            elapsed: performance.now() - t0,
            sources: {
              crime: data.crime_chunks ?? [],
              news: data.news_chunks ?? [],
              links: data.links ?? [],
            },
          },
        ])
      } catch (err) {
        setMessages((m) => [
          ...m,
          { role: 'assistant', content: `Something went wrong: ${err.message}`, error: true },
        ])
      } finally {
        setLoading(false)
      }
    },
    [input, loading],
  )

  function exportChat() {
    const md = messages
      .map((m) => (m.role === 'user' ? `## ${m.content}` : m.content))
      .join('\n\n---\n\n')
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'chicago-crime-conversation.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  function onScroll(e) {
    const el = e.currentTarget
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120)
  }

  return (
    <div className="h-screen w-screen flex bg-[var(--page)] text-[var(--ink)] overflow-hidden">
      <Sidebar
        stats={stats}
        analytics={analytics}
        status={status}
        onExample={(ex) => {
          setSidebarOpen(false)
          send(ex)
        }}
        onReset={() => setMessages([])}
        open={sidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <button onClick={() => setSidebarOpen((o) => !o)} className="text-[var(--ink-2)]">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <BrandGlyph size={26} />
            <span className="text-sm font-medium tracking-tight">Chicago Crime</span>
          </div>
        </header>

        {!started ? (
          <div className="flex-1 relative flex flex-col items-center justify-center px-4 overflow-hidden">
            {/* ambient glow */}
            <div
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-[420px] w-[820px] float-glow"
              style={{
                background:
                  'radial-gradient(ellipse at center, rgba(42,120,214,0.16), rgba(74,58,167,0.10) 45%, transparent 70%)',
              }}
            />

            <div className="relative w-full max-w-2xl -mt-10">
              <div className="flex flex-col items-center text-center mb-7">
                <BrandGlyph size={56} className="mb-6" />
                {/* leading + pb keep the gradient text-clip from cropping the "g" descender */}
                <h1 className="wordmark text-5xl sm:text-6xl font-semibold tracking-[-0.035em] leading-[1.25] pb-1">
                  Chicago Crime
                </h1>
                <div className="mt-3 text-[11px] sm:text-xs uppercase tracking-[0.42em] text-[var(--muted)] pl-[0.42em]">
                  Narrative Intelligence
                </div>
                <p className="mt-5 text-sm text-[var(--ink-2)] max-w-md leading-relaxed">
                  Ask about Chicago crime patterns and how the news covered them —
                  answers grounded in real incident records and Tribune reporting.
                </p>
              </div>

              <ChatInput
                ref={inputRef}
                value={input}
                onChange={setInput}
                onSubmit={() => send()}
                loading={loading}
                large
              />

              <div className="flex flex-wrap justify-center gap-2 mt-4 stagger">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => send(p)}
                    className="lift text-xs text-[var(--ink-2)] hover:text-[var(--ink)] bg-[var(--surface)] border border-[var(--border)] rounded-full px-3.5 py-1.5 flex items-center gap-1.5"
                  >
                    <Sparkles size={11} className="text-[var(--blue)]" />
                    {p}
                  </button>
                ))}
              </div>

              <p className="text-center text-[10px] text-[var(--muted)] mt-6">
                Press <kbd className="px-1 py-0.5 rounded border border-[var(--border)] bg-[var(--surface)]">⌘K</kbd> to
                focus · answers are LLM-generated over retrieved records
              </p>
            </div>

            {/* skyline anchored to the bottom of the hero */}
            <Skyline className="pointer-events-none absolute bottom-0 left-0 w-full h-[38%] opacity-[0.13]" />
          </div>
        ) : (
          <>
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
              <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-5">
                {messages.map((m, i) => (
                  <ChatMessage
                    key={i}
                    {...m}
                    onRegenerate={
                      m.role === 'assistant' && m.query && !loading
                        ? () => send(m.query, { replaceLast: i === messages.length - 1 })
                        : undefined
                    }
                  />
                ))}

                {loading && (
                  <div className="flex gap-3 animate-fade-in-up">
                    <BrandGlyph size={36} className="shrink-0" />
                    <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] pulse-dot" style={{ animationDelay: '0ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] pulse-dot" style={{ animationDelay: '160ms' }} />
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] pulse-dot" style={{ animationDelay: '320ms' }} />
                      <span className="ml-1.5 text-xs text-[var(--muted)]">Retrieving &amp; synthesizing…</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {!atBottom && (
              <button
                onClick={() => {
                  setAtBottom(true)
                  scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
                }}
                className="absolute bottom-28 left-1/2 -translate-x-1/2 h-9 w-9 rounded-full bg-[var(--surface)] border border-[var(--border)] shadow-md flex items-center justify-center text-[var(--ink-2)] hover:text-[var(--ink)] animate-fade-in-up"
                title="Jump to latest"
              >
                <ArrowDown size={16} />
              </button>
            )}

            <div className="border-t border-[var(--border)] bg-[var(--page)]/90 backdrop-blur px-4 md:px-6 py-4">
              <div className="max-w-3xl mx-auto">
                <ChatInput
                  ref={inputRef}
                  value={input}
                  onChange={setInput}
                  onSubmit={() => send()}
                  loading={loading}
                />
                <div className="flex items-center justify-center gap-3 mt-2">
                  <p className="text-[10px] text-[var(--muted)]">
                    LLM-generated over retrieved records — verify before relying on them.
                  </p>
                  <button
                    onClick={exportChat}
                    className="flex items-center gap-1 text-[10px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                    title="Download conversation as Markdown"
                  >
                    <Download size={11} />
                    Export
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
