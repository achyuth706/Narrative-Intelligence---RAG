import { forwardRef } from 'react'
import { ArrowUp } from 'lucide-react'

const ChatInput = forwardRef(function ChatInput(
  { value, onChange, onSubmit, loading, large = false, placeholder },
  ref,
) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className={`flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm transition-all duration-300 focus-within:border-[var(--blue)] focus-within:shadow-[0_10px_30px_-16px_rgba(42,120,214,0.65)] ${
        large ? 'px-4 py-3' : 'px-3 py-2'
      }`}
    >
      <textarea
        ref={ref}
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
        className={`shrink-0 rounded-full bg-gradient-to-br from-[var(--blue)] to-[var(--violet)] text-white flex items-center justify-center transition-all duration-200 disabled:opacity-25 disabled:cursor-not-allowed enabled:hover:scale-105 enabled:active:scale-95 ${
          large ? 'h-9 w-9' : 'h-8 w-8'
        }`}
      >
        <ArrowUp size={large ? 18 : 16} />
      </button>
    </form>
  )
})

export default ChatInput
