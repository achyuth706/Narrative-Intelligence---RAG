import { SendHorizontal } from 'lucide-react'

export default function ChatInput({ value, onChange, onSubmit, loading, large = false, placeholder }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className={`flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-[var(--blue)] shadow-sm transition-colors ${
        large ? 'px-4 py-3' : 'px-3 py-2'
      }`}
    >
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        placeholder={placeholder ?? 'Ask about a neighborhood, crime type, or incident…'}
        rows={1}
        autoFocus={large}
        className={`flex-1 resize-none bg-transparent outline-none placeholder:text-[var(--muted)] ${
          large ? 'text-base py-1.5 max-h-48' : 'text-sm py-1.5 max-h-32'
        }`}
      />
      <button
        type="submit"
        disabled={loading || !value.trim()}
        className={`shrink-0 rounded-full bg-[var(--blue)] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-opacity ${
          large ? 'h-9 w-9' : 'h-8 w-8'
        }`}
      >
        <SendHorizontal size={large ? 17 : 15} className="text-white" />
      </button>
    </form>
  )
}
