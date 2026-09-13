import { Activity, Database, Newspaper, Link2, Sparkles, MapPinned, Tags, CalendarRange } from 'lucide-react'
import BarRanking from './BarRanking'
import BrandMark from './BrandMark'

const EXAMPLES = [
  'What crimes with arrests were reported near the N Lincoln Ave corridor?',
  'How effective has police response been in Englewood according to arrest patterns?',
  'Were any criminal damage incidents near Englewood covered by news?',
  'What are the main public safety concerns in Englewood?',
]

function Section({ icon: Icon, label, children }) {
  return (
    <div className="px-5 py-4 border-t border-[var(--border)]">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-2)] mb-3">
        <Icon size={13} />
        {label}
      </div>
      {children}
    </div>
  )
}

function formatDate(d) {
  if (!d) return null
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return d
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Sidebar({ stats, analytics, status, onExample, onReset, open }) {
  const dateRange = analytics?.date_range

  return (
    <aside
      className={`${
        open ? 'flex' : 'hidden'
      } md:flex w-full md:w-96 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] h-full overflow-y-auto`}
    >
      <div className="px-5 pt-6 pb-4">
        <BrandMark size="lg" />
        <p className="mt-4 text-xs text-[var(--ink-2)] leading-relaxed">
          Hybrid RAG over Chicago crime records and Chicago Tribune reporting.
          Retrieves matching crime chunks + news articles + deterministic
          links, then asks Gemini to synthesize a narrative.
        </p>

        <div className="flex items-center gap-2 text-xs mt-4">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === 'online' ? 'bg-[var(--green)]' : status === 'checking' ? 'bg-[var(--yellow)]' : 'bg-[var(--red)]'
            }`}
          />
          <span className="text-[var(--muted)]">
            {status === 'online' ? 'Backend connected' : status === 'checking' ? 'Connecting…' : 'Backend offline'}
          </span>
          {dateRange && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--muted)]">
              <CalendarRange size={11} />
              {formatDate(dateRange.start)}–{formatDate(dateRange.end)}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 mt-4 stagger">
          <StatCard icon={Database} label="Crime chunks" value={stats?.crime_chunks} accent="text-[var(--blue)]" />
          <StatCard icon={Newspaper} label="News chunks" value={stats?.news_chunks} accent="text-[var(--orange)]" />
          <StatCard icon={Link2} label="Links" value={stats?.links} accent="text-[var(--aqua)]" />
        </div>
      </div>

      <Section icon={Activity} label="Top crime types">
        <BarRanking data={analytics?.top_crime_types} hue="blue" />
      </Section>

      <Section icon={MapPinned} label="Most-flagged blocks">
        <BarRanking data={analytics?.top_blocks} hue="orange" />
      </Section>

      {analytics?.top_news_subjects?.length > 0 && (
        <Section icon={Tags} label="Trending in coverage">
          <div className="flex flex-wrap gap-1.5">
            {analytics.top_news_subjects.map((s) => (
              <span
                key={s.label}
                className="text-[11px] px-2 py-1 rounded-full bg-[var(--page)] border border-[var(--border)] text-[var(--ink-2)]"
              >
                {s.label} <span className="text-[var(--muted)] tabular">· {s.value}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section icon={Sparkles} label="Try asking">
        <div className="space-y-1.5 stagger">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => onExample(ex)}
              className="lift w-full text-left text-xs text-[var(--ink-2)] hover:text-[var(--ink)] bg-[var(--page)] hover:bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--blue)]/40 rounded-lg px-3 py-2"
            >
              {ex}
            </button>
          ))}
        </div>
      </Section>

      <div className="mt-auto px-5 py-4 border-t border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <Activity size={12} />
          IS597 &middot; Group 6
        </div>
        <button
          onClick={onReset}
          className="text-[11px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
        >
          Clear chat
        </button>
      </div>
    </aside>
  )
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="lift rounded-lg bg-[var(--page)] border border-[var(--border)] px-2 py-2 text-center">
      <Icon size={13} className={`mx-auto mb-1 ${accent}`} />
      <div className="text-sm font-semibold text-[var(--ink)] tabular">{value?.toLocaleString() ?? '–'}</div>
      <div className="text-[9px] text-[var(--muted)] leading-tight">{label}</div>
    </div>
  )
}
