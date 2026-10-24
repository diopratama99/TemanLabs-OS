import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { tr } from '../lib/i18n'

/**
 * A window whose content crashes shows the error in its place, with a way to try again; the rest
 * of the desktop keeps working (without this, one bad answer blanks the whole page).
 */
export class WindowErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Window crashed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="win-crash" role="alert">
        <TriangleAlert size={30} strokeWidth={1.6} />
        <strong>{tr('Something went wrong in this window.')}</strong>
        <code>{this.state.error.message}</code>
        <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
          {tr('Reload Window')}
        </button>
      </div>
    )
  }
}
