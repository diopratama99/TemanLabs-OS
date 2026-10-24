import { CircleAlert, CircleCheck, LoaderCircle, X } from 'lucide-react'
import type { UploadJob } from '../hooks/useUploads'
import { formatBytes } from '../lib/format'
import { tr } from '../lib/i18n'

interface Props {
  jobs: UploadJob[]
  busy: boolean
  onCancel: () => void
  onClear: () => void
}

/** Copy progress for uploads into Files. */
export function UploadsPanel({ jobs, busy, onCancel, onClear }: Props) {
  if (jobs.length === 0) return null
  const files = jobs.filter(j => j.size > 0 || j.status !== 'done')
  const total = files.reduce((sum, j) => sum + j.size, 0)
  const loaded = files.reduce((sum, j) => sum + Math.min(j.loaded, j.size), 0)
  const done = jobs.filter(j => j.status === 'done').length
  const failed = jobs.filter(j => j.status === 'error')
  const percent = total ? Math.round((loaded / total) * 100) : busy ? 0 : 100

  return (
    <div className="uploads" role="status">
      <div className="uploads-head">
        <strong>
          {busy
            ? tr('Copying {0} of {1}…', done + 1 > jobs.length ? jobs.length : done + 1, jobs.length)
            : failed.length
              ? tr('{0} of {1} couldn’t be copied', failed.length, jobs.length)
              : tr('Copied {0} item{1}', jobs.length, jobs.length > 1 ? 's' : '')}
        </strong>
        <small>
          {formatBytes(loaded)} of {formatBytes(total)}
        </small>
        <button className="icon-btn" onClick={busy ? onCancel : onClear} aria-label={busy ? tr('Cancel uploads') : tr('Close')} title={busy ? tr('Stop') : tr('Close')}>
          <X size={13} />
        </button>
      </div>
      <div className="uploads-bar">
        <i style={{ width: `${percent}%` }} />
      </div>
      <ul className="uploads-list">
        {jobs.map(job => (
          <li key={job.id} className={`is-${job.status}`} title={job.error ?? job.name}>
            {job.status === 'done' ? (
              <CircleCheck size={13} />
            ) : job.status === 'error' ? (
              <CircleAlert size={13} />
            ) : (
              <LoaderCircle size={13} className={job.status === 'uploading' ? 'spin' : ''} />
            )}
            <span>{job.name}</span>
            <small>
              {job.status === 'error'
                ? job.error
                : job.status === 'uploading' && job.size
                  ? `${Math.round((job.loaded / job.size) * 100)}%`
                  : job.size
                    ? formatBytes(job.size)
                    : ''}
            </small>
          </li>
        ))}
      </ul>
    </div>
  )
}
