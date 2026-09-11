import { useState } from 'react'
import { ChevronDown, ShieldAlert, Newspaper, Link2 } from 'lucide-react'

function Section({ icon: Icon, label, count, accent, children }) {
  const [open, setOpen] = useState(false)
  if (!count) return null
  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--surface)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--page)] transition-colors"
      >
        <Icon size={15} className={accent} />
        <span className="font-medium text-[var(--ink)]">{label}</span>
        <span className="text-[var(--muted)] text-xs tabular">({count})</span>
        <ChevronDown
          size={15}
          className={`ml-auto text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-2 max-h-64 overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  )
}

export default function SourcesPanel({ crime = [], news = [], links = [] }) {
  return (
    <div className="mt-3 space-y-2 w-full">
      <Section icon={ShieldAlert} label="Crime records retrieved" count={crime.length} accent="text-[var(--blue)]">
        {crime.map((c, i) => (
          <div key={i} className="text-xs rounded-lg bg-[var(--page)] border border-[var(--border)] p-2 text-[var(--ink-2)]">
            <div className="text-[var(--ink)] font-medium">
              {c.metadata?.primary_type} &middot; {c.metadata?.block}
            </div>
            <div className="text-[var(--muted)]">
              {c.metadata?.date} &middot; {c.metadata?.count} incidents
            </div>
          </div>
        ))}
      </Section>

      <Section icon={Newspaper} label="News articles retrieved" count={news.length} accent="text-[var(--orange)]">
        {news.map((n, i) => (
          <div key={i} className="text-xs rounded-lg bg-[var(--page)] border border-[var(--border)] p-2 text-[var(--ink-2)]">
            <div className="text-[var(--ink)] font-medium line-clamp-2">{n.metadata?.title}</div>
            <div className="text-[var(--muted)]">{n.metadata?.date}</div>
          </div>
        ))}
      </Section>

      <Section icon={Link2} label="Crime ↔ news links used" count={links.length} accent="text-[var(--aqua)]">
        {links.map((l, i) => (
          <div key={i} className="text-xs rounded-lg bg-[var(--page)] border border-[var(--border)] p-2 text-[var(--ink-2)]">
            <div className="text-[var(--ink)]">
              {l.crime_type} @ {l.crime_block}
            </div>
            <div className="text-[var(--muted)] line-clamp-1">&rarr; "{l.news_title}"</div>
          </div>
        ))}
      </Section>
    </div>
  )
}
