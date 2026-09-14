// Chicago badge: the John Hancock Center (tapered, X-braced) beside Willis
// Tower (bundled tubes stepping back). Those two silhouettes are what make a
// skyline read as Chicago rather than "generic city".
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
          {/* cuts the bracing + tube seam out so the gradient shows through */}
          <mask id="glyph-cut">
            <rect width="48" height="48" fill="#fff" />
            <g stroke="#000" strokeWidth="0.62" strokeLinecap="square">
              <line x1="9" y1="16" x2="18.25" y2="28.5" />
              <line x1="17" y1="16" x2="7.75" y2="28.5" />
              <line x1="7.75" y1="28.5" x2="19.5" y2="41" />
              <line x1="18.25" y1="28.5" x2="6.5" y2="41" />
            </g>
            <rect x="31.7" y="10" width="0.7" height="7" fill="#000" />
          </mask>
        </defs>
        <rect width="48" height="48" fill="url(#glyph-bg)" />
        <g fill="#ffffff" mask="url(#glyph-cut)">
          {/* John Hancock Center */}
          <path d="M6.5 41 L9 16 L17 16 L19.5 41 Z" />
          <rect x="11" y="8" width="1.3" height="8" />
          <rect x="14.4" y="8" width="1.3" height="8" />
          {/* Willis Tower */}
          <rect x="22.5" y="24" width="19" height="17" />
          <rect x="25" y="17" width="14" height="7" />
          <rect x="27.5" y="10" width="9" height="7" />
          <rect x="28.9" y="4" width="1.3" height="6" />
          <rect x="33.8" y="4" width="1.3" height="6" />
        </g>
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
