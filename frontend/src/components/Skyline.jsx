import { useState } from 'react'

// Hand-drawn Chicago skyline silhouette. Left to right the recognizable
// towers are Trump (stepped + spire), Willis (bundled tubes, twin antennas),
// Aon (flat slab), and Hancock (tapered with twin antennas).

const FILLERS = [
  [0, 46, 238], [50, 30, 196], [84, 62, 220], [150, 26, 168], [180, 12, 142],
  [248, 40, 188], [292, 30, 152], [326, 8, 214],
  [430, 44, 164], [478, 0, 300], [538, 40, 196], [582, 30, 210], [616, 8, 222],
  [700, 40, 190], [744, 22, 146], [770, 44, 176], [818, 34, 224],
  [856, 52, 152], [912, 18, 198], [934, 46, 214],
  [984, 62, 178], [1050, 28, 232], [1082, 40, 160], [1126, 34, 206], [1164, 36, 236],
]

// thin accent spires, [x, topY, height]
const SPIRES = [
  [186, 108, 36], [300, 126, 28], [878, 120, 34], [1098, 132, 30],
]

// deterministic pseudo-random so the lit windows don't reshuffle every render
function windows(x, w, top, seed) {
  const cells = []
  const cols = Math.max(1, Math.floor(w / 11))
  const rows = Math.max(1, Math.floor((300 - top) / 16))
  let s = seed
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      if ((s >> 8) % 100 < 16) {
        cells.push({
          x: x + 4 + c * 11,
          y: top + 9 + r * 16,
          key: `${x}-${c}-${r}`,
          delay: ((s >> 4) % 40) / 10,
        })
      }
    }
  }
  return cells
}

let instance = 0

export default function Skyline({ className = '', animate = true, lights = true }) {
  // SVG ids are document-global, so each instance needs its own
  const [uid] = useState(() => `sky${++instance}`)
  const lit = lights
    ? [
        ...FILLERS.flatMap((b, i) => windows(b[0], b[1], b[2], i + 7)),
        ...windows(196, 46, 124, 101),
        ...windows(336, 88, 96, 202),
        ...windows(482, 52, 88, 303),
        ...windows(626, 68, 96, 404),
      ]
    : []

  return (
    <svg
      viewBox="0 0 1200 300"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-grad`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.95" />
          <stop offset="55%" stopColor="var(--violet)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--violet)" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="1" />
          <stop offset="72%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={`${uid}-mask`}>
          <rect x="0" y="0" width="1200" height="300" fill={`url(#${uid}-fade)`} />
        </mask>
      </defs>

      <g mask={`url(#${uid}-mask)`} className={animate ? 'skyline-rise' : ''}>
        <g fill={`url(#${uid}-grad)`}>
          {FILLERS.filter(([, w]) => w > 0).map(([x, w, top]) => (
            <rect key={x} x={x} y={top} width={w} height={300 - top} />
          ))}
          {SPIRES.map(([x, top, h]) => (
            <rect key={`s${x}`} x={x} y={top} width="2.5" height={h} />
          ))}

          {/* Trump Tower — stepped setbacks */}
          <rect x="196" y="150" width="46" height="150" />
          <rect x="205" y="124" width="28" height="30" />
          <rect x="214" y="96" width="12" height="30" />
          <rect x="218" y="52" width="3" height="46" />

          {/* Willis Tower — bundled tubes */}
          <rect x="336" y="150" width="88" height="150" />
          <rect x="350" y="112" width="60" height="42" />
          <rect x="350" y="70" width="26" height="46" />
          <rect x="384" y="70" width="26" height="46" />
          <rect x="360" y="18" width="3" height="54" />
          <rect x="396" y="18" width="3" height="54" />

          {/* Aon Center — clean slab */}
          <rect x="482" y="88" width="52" height="212" />

          {/* Hancock — tapered with twin antennas */}
          <path d="M626 300 L634 96 L686 96 L694 300 Z" />
          <rect x="642" y="38" width="3" height="60" />
          <rect x="676" y="38" width="3" height="60" />
        </g>

        {lit.length > 0 && (
          <g fill="#f0b64a" className="sky-windows" opacity="0.75">
            {lit.map((c) => (
              <rect
                key={c.key}
                x={c.x}
                y={c.y}
                width="3"
                height="4.5"
                rx="0.5"
                style={{ animationDelay: `${c.delay}s` }}
              />
            ))}
          </g>
        )}
      </g>
    </svg>
  )
}
