// Compact logo mark: the three iconic towers reduced to a badge-sized glyph.
export function BrandGlyph({ size = 36, className = '' }) {
  return (
    <span
      className={`relative inline-flex items-center justify-center rounded-xl overflow-hidden shadow-sm brand-glyph ${className}`}
      style={{ height: size, width: size }}
    >
      <svg viewBox="0 0 48 48" className="h-full w-full">
        <defs>
          <linearGradient id="glyph-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2a78d6" />
            <stop offset="55%" stopColor="#3f5fd0" />
            <stop offset="100%" stopColor="#4a3aa7" />
          </linearGradient>
        </defs>
        <rect width="48" height="48" fill="url(#glyph-bg)" />
        <g fill="rgba(255,255,255,0.96)">
          {/* Hancock — tapered, twin antennas */}
          <path d="M10 39 L13.2 20 L18.8 20 L22 39 Z" />
          <rect x="14.4" y="12" width="1.3" height="8" />
          <rect x="17.3" y="12" width="1.3" height="8" />
          {/* Willis — bundled tubes, twin antennas */}
          <rect x="24" y="23" width="11" height="16" />
          <rect x="25.8" y="16" width="7.4" height="7" />
          <rect x="25.8" y="9" width="3" height="7" />
          <rect x="30.2" y="9" width="3" height="7" />
          <rect x="26.9" y="4" width="1.1" height="5" />
          <rect x="31.3" y="4" width="1.1" height="5" />
          {/* Aon — slim slab */}
          <rect x="37" y="18" width="5.5" height="21" />
        </g>
        <rect x="0" y="39" width="48" height="9" fill="rgba(255,255,255,0.16)" />
      </svg>
    </span>
  )
}

export default function BrandMark({ size = 'sm' }) {
  const glyph = size === 'lg' ? 44 : 36
  return (
    <div className="flex items-center gap-3">
      <BrandGlyph size={glyph} />
      <div className="leading-none">
        <div
          className={`font-semibold tracking-tight text-[var(--ink)] ${
            size === 'lg' ? 'text-lg' : 'text-[15px]'
          }`}
        >
          Chicago Crime
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
          Narrative Intelligence
        </div>
      </div>
    </div>
  )
}
