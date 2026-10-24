interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}

export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  )
}
