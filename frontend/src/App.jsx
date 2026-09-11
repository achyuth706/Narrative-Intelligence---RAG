import { useEffect, useRef, useState } from 'react'
import { SendHorizontal, Menu, ShieldHalf } from 'lucide-react'
import ChatMessage from './components/ChatMessage'
import Sidebar from './components/Sidebar'
import { API_BASE } from './api'

const WELCOME = {
  role: 'assistant',
  content:
    "Ask me about Chicago crime patterns and how the news covered them — e.g. *\"What happened near Lincoln Ave related to robbery this week?\"*",
}

export default function App() {
  const [messages, setMessages] = useState([WELCOME])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [status, setStatus] = useState('checking')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const scrollRef = useRef(null)

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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send(query) {
    const q = (query ?? input).trim()
    if (!q || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: q }])
    setLoading(true)

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
        onReset={() => setMessages([WELCOME])}
        open={sidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <button onClick={() => setSidebarOpen((o) => !o)} className="text-[var(--ink-2)]">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldHalf size={16} className="text-[var(--blue)]" />
            <span className="text-sm font-medium">Chicago Crime Narrative Intelligence</span>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-5">
            {messages.map((m, i) => (
              <ChatMessage key={i} {...m} />
            ))}

            {loading && (
              <div className="flex gap-3 animate-fade-in-up">
                <div className="shrink-0 h-8 w-8 rounded-full bg-[var(--orange)] flex items-center justify-center shadow-sm">
                  <ShieldHalf size={15} className="text-white" />
                </div>
                <div className="rounded-2xl rounded-tl-sm px-4 py-3.5 bg-[var(--surface)] border border-[var(--border)] flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] pulse-dot" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] pulse-dot" style={{ animationDelay: '160ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)] pulse-dot" style={{ animationDelay: '320ms' }} />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--page)]/90 backdrop-blur px-4 md:px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                send()
              }}
              className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--blue)] shadow-sm transition-colors px-3 py-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
                placeholder="Ask about a neighborhood, crime type, or incident…"
                rows={1}
                className="flex-1 resize-none bg-transparent outline-none text-sm py-1.5 placeholder:text-[var(--muted)] max-h-32"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 h-8 w-8 rounded-full bg-[var(--blue)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-opacity"
              >
                <SendHorizontal size={15} className="text-white" />
              </button>
            </form>
            <p className="text-center text-[10px] text-[var(--muted)] mt-2">
              Answers are generated by an LLM over retrieved records — verify before relying on them.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
