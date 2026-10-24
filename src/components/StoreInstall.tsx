import { useEffect, useState } from 'react'
import { Download, LoaderCircle, X } from 'lucide-react'
import { api } from '../api'
import type { StoreAppDetails, StoreEntry } from '../api/types'
import { usePresence } from '../hooks/usePresence'
import { DATA_ROOT } from '../lib/places'
import { AppIcon } from './AppIcon'
import { ContainerFields, EMPTY_FORM, formFromSpec, toSpec, type Form } from './CustomInstall'
import { tr } from '../lib/i18n'

const EXIT_MS = 220
const ICON_COLOR: [string, string] = ['#64d2ff', '#2f6bff']

interface Props {
  entry: StoreEntry | null
  /** Details its page already read; otherwise the sheet reads them. */
  prefetched?: StoreAppDetails | null
  onClose: () => void
  onInstalled: (appId: string) => void
}

/** Installing a store app: its settings (ports, folders, variables) or compose file, then Install. */
export function StoreInstall({ entry, ...rest }: Props) {
  const { mounted, closing } = usePresence(!!entry, EXIT_MS)
  const [last, setLast] = useState(entry)
  if (entry && entry !== last) setLast(entry)
  if (!mounted || !last) return null
  return <Sheet key={last.id} entry={last} closing={closing} {...rest} />
}

function Sheet({ entry, prefetched, closing, onClose, onInstalled }: Omit<Props, 'entry'> & { entry: StoreEntry; closing: boolean }) {
  const [details, setDetails] = useState<StoreAppDetails | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<'form' | 'compose'>('form')
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [yaml, setYaml] = useState('')
  const [yamlEdited, setYamlEdited] = useState(false)
  const [networks, setNetworks] = useState(['bridge', 'host'])
  const [advanced, setAdvanced] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const use = (d: StoreAppDetails) => {
      setDetails(d)
      setForm(formFromSpec(d.spec))
      setYaml(d.yaml)
    }
    if (prefetched) use(prefetched)
    else api.storeApp(entry.id).then(use, (err: Error) => setLoadError(err.message))
    api.listNetworks().then(setNetworks, () => {})
    // Once per app: the page's details don't change while the sheet is open.
  }, [entry.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const install = async () => {
    if (!details) return
    setInstalling(true)
    setError(null)
    try {
      const body =
        mode === 'compose' && yamlEdited
          ? { appId: details.appId, yaml }
          : { appId: details.appId, service: details.service, spec: toSpec(form, 'form', '') }
      const id = await api.installStoreApp(entry.id, body)
      onInstalled(id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(false)
    }
  }

  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }))
  return (
    <div
      className={`sheet-backdrop as-backdrop ${closing ? 'is-closing' : ''}`}
      onPointerDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="sheet ci as si" role="dialog" aria-label={tr('Install {0}', entry.name)}>
        <header className="ci-head as-head">
          <AppIcon icon="boxes" iconUrl={entry.iconUrl || undefined} color={ICON_COLOR} size={30} />
          <span className="as-title">
            <strong>{tr('Install {0}', entry.name)}</strong>
            <small>{[entry.developer, entry.category, entry.source].filter(Boolean).join(' · ')}</small>
          </span>
          <div className="segmented ci-modes">
            <button className={mode === 'form' ? 'is-active' : ''} onClick={() => setMode('form')}>
              {tr('Settings')}
            </button>
            <button className={mode === 'compose' ? 'is-active' : ''} onClick={() => setMode('compose')}>
              {tr('Compose')}
            </button>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={tr('Close')}>
            <X size={15} />
          </button>
        </header>

        <div className={`ci-body as-body ${mode === 'compose' ? 'as-compose' : ''}`}>
          {loadError && (
            <p className="form-error">
              {tr('Couldn’t prepare this app:')} {loadError}
            </p>
          )}
          {!details && !loadError && (
            <p className="as-loading">
              <LoaderCircle size={14} className="spin" /> {tr('Reading the app’s compose file…')}
            </p>
          )}
          {details && mode === 'form' && (
            <>
              {details.services.length > 1 && (
                <p className="ci-note">
                  {entry.name} {tr('runs')} {details.services.length} {tr('containers (')}
                  {details.services.join(', ')}
                  {tr('). The form sets up')} {details.service}
                  {tr('; the Compose tab shows all of them.')}
                </p>
              )}
              <ContainerFields
                form={form}
                set={set}
                networks={networks}
                appData={`${DATA_ROOT}/AppData/${details.appId}`}
                advanced={advanced}
                onAdvanced={setAdvanced}
                editing
              />
            </>
          )}
          {details && mode === 'compose' && (
            <>
              <p className="ci-note">
                {tr(
                  'The store’s compose file with $AppID, $PUID, $PGID and $TZ filled in and taken ports moved. Edits here are installed as written (the Settings form is ignored once you change this).',
                )}
              </p>
              <textarea
                className="ci-compose as-yaml"
                value={yaml}
                onChange={e => {
                  setYaml(e.target.value)
                  setYamlEdited(true)
                }}
                spellCheck={false}
              />
            </>
          )}
        </div>

        <footer className="ci-foot as-foot">
          <span className="as-status">
            {error ? (
              <span className="form-error">{error}</span>
            ) : (
              <span className="form-hint">{tr('Images are pulled on the server; big ones take a while.')}</span>
            )}
          </span>
          <button className="btn" onClick={onClose}>
            {tr('Cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void install()} disabled={installing || !details}>
            {installing ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />} {tr('Install')}
          </button>
        </footer>
      </div>
    </div>
  )
}
