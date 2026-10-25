import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen } from 'lucide-react'
import { OpenDialog } from './code/OpenDialog'
import { FileTypeIcon } from './code/FileTypeIcon'
import { tr } from '../lib/i18n'
import { displayName } from '../lib/paths'

interface Props {
  label: string
  value: string
  onChoose: (path: string) => void
  /** The Choose panel's title. */
  title?: string
  /** Beside the Choose panel's buttons, given the folder that would be chosen. */
  hint?: (name: string) => string
  disabled?: boolean
}

/** A folder setting: the folder, and a Choose… button that browses the server's files for another. */
export function FolderField({ label, value, onChoose, title, hint, disabled }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [choosing, setChoosing] = useState(false)
  // Over the sheet this sits in, filling the window rather than the sheet.
  const host = (choosing && (ref.current?.closest('.sheet-backdrop')?.parentElement ?? ref.current?.closest('.window'))) || null
  return (
    <div className="bk-field" ref={ref}>
      <span>{label}</span>
      <div className="ff-row">
        <FileTypeIcon name="" folder size={26} />
        <span className="ff-text">
          <strong>{displayName(value) || value}</strong>
          <small title={value}>{value}</small>
        </span>
        <button type="button" className="btn" disabled={disabled} onClick={() => setChoosing(true)}>
          <FolderOpen size={13} /> {tr('Choose…')}
        </button>
      </div>
      {host &&
        createPortal(
          <OpenDialog
            mode="folder"
            title={title ?? tr('Choose a Folder')}
            startDir={value}
            confirmLabel={tr('Choose')}
            hint={hint ?? (name => tr('Saves into “{0}”', name))}
            canCreate
            onOpen={path => {
              setChoosing(false)
              if (path !== value) onChoose(path)
            }}
            onCancel={() => setChoosing(false)}
          />,
          host,
        )}
    </div>
  )
}
