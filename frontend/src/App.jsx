import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, Download, Menu, Sparkles } from 'lucide-react'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'
import Sidebar from './components/Sidebar'
import Skyline from './components/Skyline'
import { BrandGlyph } from './components/BrandMark'
import { API_BASE } from './api'

const SB_MIN = 260
const SB_MAX = 620
const SB_DEFAULT = 384
const SB_KEY = 'ccni.sidebarWidth'

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))

const QUICK_PROMPTS = [
  'Crime near N Lincoln Ave',
  'Policing in Englewood',
  'Criminal damage in the news',
  'Where are arrests highest?',
]

export default function App() {
  // Deliberately not persisted — a reload should land you back on the hero,
  // not resume mid-conversation.
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [status, setStatus] = useState('checking')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem(SB_KEY))
    return saved >= SB_MIN && saved <= SB_MAX ? saved : SB_DEFAULT
  })
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const rootRef = useRef(null)
  const dragRef = useRef(false)

  const started = messages.length > 0

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

  // --- sidebar resizing -------------------------------------------------
  // Width is driven through a CSS variable during the drag rather than React
  // state, so each frame is a single style write instead of a re-render of
  // the whole tree (which makes the panel lag behind the cursor).
  const applyWidth = useCallback((w) => {
    rootRef.current?.style.setProperty('--sb-w', `${w}px`)
  }, [])

  const commitWidth = useCallback((w) => {
    setSidebarWidth(w)
    try {
      localStorage.setItem(SB_KEY, String(w))
    } catch {
      /* private mode — width just won't be remembered */
    }
  }, [])

  const beginResize = useCallback(
    (e) => {
      e.preventDefault()
      dragRef.current = true
      document.body.classList.add('resizing')

      const move = (ev) => {
        if (!dragRef.current) return
        // the sidebar starts at x=0, so the pointer's x *is* the width
        applyWidth(clamp(ev.clientX, SB_MIN, SB_MAX))
      }
      const end = (ev) => {
        dragRef.current = false
        document.body.classList.remove('resizing')
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        commitWidth(clamp(ev.clientX, SB_MIN, SB_MAX))
      }

      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    },
    [applyWidth, commitWidth],
  )

  const nudgeWidth = useCallback(
    (e) => {
      const step = e.shiftKey ? 48 : 16
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        commitWidth(clamp(sidebarWidth - step, SB_MIN, SB_MAX))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        commitWidth(clamp(sidebarWidth + step, SB_MIN, SB_MAX))
      } else if (e.key === 'Home') {
        e.preventDefault()
        commitWidth(SB_DEFAULT)
      }
    },
    [sidebarWidth, commitWidth],
  )

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
        let res
        try {
          res = await fetch(`${API_BASE}/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q, top_k: 5 }),
          })
        } catch {
          // fetch only rejects when no response was readable at all
          throw new Error(
            "Couldn't reach the backend. It may be starting up — wait a moment and retry.",
          )
        }
        // error pages from the hosting proxy aren't JSON, so don't assume
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.detail || `Request failed (HTTP ${res.status})`)

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
    <div
      ref={rootRef}
      className="h-screen w-screen flex bg-[var(--page)] text-[var(--ink)] overflow-hidden"
      style={{ '--sb-w': `${sidebarWidth}px` }}
    >
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

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={sidebarWidth}
        aria-valuemin={SB_MIN}
        aria-valuemax={SB_MAX}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={beginResize}
        onKeyDown={nudgeWidth}
        onDoubleClick={() => commitWidth(SB_DEFAULT)}
        className="resize-handle hidden md:block"
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
                Answers are LLM-generated over retrieved records — verify before relying on them.
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
