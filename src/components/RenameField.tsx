import { useEffect, useRef } from 'react'

interface Props {
  name: string
  /** Called once with the new name, or null when cancelled with Escape. */
  onDone: (value: string | null) => void
}

/** Inline rename input for Files and the code editor's Explorer. */
export function RenameField({ name, onDone }: Props) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }

  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    // Select the name but not the extension.
    const dot = name.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : name.length)
  }, [name])

  return (
    <input
      ref={ref}
      className="file-rename"
      defaultValue={name}
      aria-label="New name"
      onBlur={e => finish(e.target.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
  )
}
