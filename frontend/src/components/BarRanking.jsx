const HUES = {
  blue: 'var(--blue)',
  orange: 'var(--orange)',
}

function formatValue(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return n.toLocaleString()
}

export default function BarRanking({ data, hue = 'blue', unit }) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-[var(--muted)] py-2">No data yet.</p>
  }
  const max = Math.max(...data.map((d) => d.value), 1)
  const color = HUES[hue] || HUES.blue

  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label}>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-xs text-[var(--ink-2)] truncate" title={d.label}>
              {d.label}
            </span>
            <span className="text-xs tabular text-[var(--muted)] shrink-0">
              {formatValue(d.value)}
              {unit ? ` ${unit}` : ''}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--grid)] overflow-hidden">
            <div
              className="h-full rounded-full animate-grow-bar"
              style={{
                width: `${Math.max((d.value / max) * 100, 3)}%`,
                background: color,
                animationDelay: `${i * 40}ms`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
