import { ChevronsUpDown } from 'lucide-react'
import { useContextMenu } from '../lib/contextMenu'

interface Option<T extends string> {
  value: T
  label: string
}

/** A pop-up button: shows the current choice and opens the glass menu below itself. */
export function PopUpButton<T extends string>({
  value,
  options,
  onChange,
  className = '',
  'aria-label': ariaLabel,
}: {
  value: T
  options: Option<T>[]
  onChange: (value: T) => void
  className?: string
  'aria-label'?: string
}) {
  const { show } = useContextMenu()
  const current = options.find(o => o.value === value)
  return (
    <button
      type="button"
      className={`popup-btn ${className}`}
      aria-label={ariaLabel}
      aria-haspopup="menu"
      onClick={e => {
        const r = e.currentTarget.getBoundingClientRect()
        show(
          { x: r.left, y: r.bottom + 4, placement: 'below', align: 'start' },
          options.map(o => ({ label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) })),
        )
      }}
    >
      <span>{current?.label ?? value}</span>
      <ChevronsUpDown size={12} />
    </button>
  )
}
