// LLMs often render tables as ASCII art (+----+----+ with | cells), sometimes
// wrapped in a code fence. Those render as overflowing <pre> blocks instead of
// tables. The prompt asks for real Markdown tables, but instructions aren't
// guaranteed — and answers already saved to localStorage can't be re-prompted.
// So convert them deterministically at render time.

const SEP = /^\s*\+[-+=\s]*\+\s*$/
const ROW = /^\s*\|.*\|\s*$/

function splitCells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
}

// Rows wrap across lines; a line whose first cell is blank continues the one above.
function toLogicalRows(rowLines) {
  const rows = []
  for (const line of rowLines) {
    const cells = splitCells(line)
    const isContinuation = rows.length > 0 && cells[0] === '' && cells.some((c) => c !== '')
    if (isContinuation) {
      const prev = rows[rows.length - 1]
      cells.forEach((c, i) => {
        if (!c) return
        prev[i] = prev[i] ? `${prev[i]} ${c}` : c
      })
    } else if (cells.some((c) => c !== '')) {
      rows.push(cells)
    }
  }
  return rows
}

function buildMarkdownTable(blockLines) {
  // Group rows by the separator lines between them; the first group is the header.
  const groups = []
  let current = []
  for (const line of blockLines) {
    if (SEP.test(line)) {
      if (current.length) groups.push(current)
      current = []
    } else if (ROW.test(line)) {
      current.push(line)
    }
  }
  if (current.length) groups.push(current)
  if (groups.length === 0) return null

  const headerRows = toLogicalRows(groups[0])
  if (headerRows.length === 0) return null
  const header = headerRows[0]
  const width = header.length
  if (width < 2) return null

  const bodyRows = groups.slice(1).flatMap((g) => toLogicalRows(g))
  // A single-group block is a header with no body — not worth converting.
  if (groups.length === 1 && headerRows.length < 2) return null
  const body = groups.length === 1 ? headerRows.slice(1) : bodyRows

  const fit = (cells) => {
    const padded = [...cells]
    while (padded.length < width) padded.push('')
    return padded.slice(0, width).map((c) => c.replace(/\|/g, '\\|'))
  }

  return [
    `| ${fit(header).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map((r) => `| ${fit(r).join(' | ')} |`),
  ]
}

function convertBlocks(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    if (SEP.test(lines[i])) {
      let j = i
      const block = []
      while (j < lines.length && (SEP.test(lines[j]) || ROW.test(lines[j]))) {
        block.push(lines[j])
        j++
      }
      const table = buildMarkdownTable(block)
      if (table) {
        out.push('', ...table, '')
        i = j
        continue
      }
    }
    out.push(lines[i])
    i++
  }
  return out
}

export default function normalizeMarkdown(text) {
  if (!text || !text.includes('|')) return text

  const lines = text.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const fence = lines[i].match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      const marker = fence[1]
      let j = i + 1
      const inner = []
      while (j < lines.length && !lines[j].trimStart().startsWith(marker)) {
        inner.push(lines[j])
        j++
      }
      // Unwrap the fence only when it's really an ASCII table, not code.
      if (inner.some((l) => SEP.test(l)) && inner.some((l) => ROW.test(l))) {
        out.push(...convertBlocks(inner))
      } else {
        out.push(lines[i], ...inner)
        if (j < lines.length) out.push(lines[j])
      }
      i = j < lines.length ? j + 1 : j
      continue
    }
    out.push(lines[i])
    i++
  }

  return convertBlocks(out).join('\n')
}
