import { Braces, Brackets, CircleAlert, Eye, FolderTree, ListChecks, Palette, PanelTop, Rainbow, Tags, WandSparkles, type LucideIcon } from 'lucide-react'
import type { ExtensionId, ExtensionSettings } from './editorExtensions'
import { Switch } from '../Switch'
import { tr } from '../../lib/i18n'

// The Extensions view: Code's built-in extensions, each with what it does and a switch.

interface Entry {
  id: ExtensionId
  name: string
  text: string
  icon: LucideIcon
  color: string
  /** Shown under another one, and only while that one is on. */
  under?: ExtensionId
}

const ENTRIES: Entry[] = [
  { id: 'prettier', name: 'Prettier', text: tr('Formats JavaScript, TypeScript, JSON, CSS, HTML, Vue, Markdown, YAML and GraphQL (Format Document, or Shift+Alt+F).'), icon: WandSparkles, color: '#c596c7' },
  { id: 'formatOnSave', name: tr('Format on Save'), text: tr('Runs Prettier every time a file is saved.'), icon: WandSparkles, color: '#c596c7', under: 'prettier' },
  { id: 'inlineErrors', name: tr('Inline Errors'), text: tr('Shows each line’s problem at the end of the line, so it can’t be missed.'), icon: CircleAlert, color: '#f14c4c' },
  { id: 'renameTags', name: tr('Rename Paired Tags'), text: tr('Renaming an HTML tag renames its closing tag too.'), icon: Tags, color: '#e44d26' },
  { id: 'todo', name: tr('TODO Highlight'), text: tr('Highlights TODO, FIXME, HACK, BUG and NOTE, and marks them in the scrollbar.'), icon: ListChecks, color: '#ffb02e' },
  { id: 'rainbowIndent', name: tr('Rainbow Indents'), text: tr('Colours each level of indentation, to see where blocks start and end.'), icon: Rainbow, color: '#7cc8ff' },
  { id: 'pathCompletion', name: tr('Path Completion'), text: tr('Suggests file and folder names while typing a path in quotes (./, ../ or /).'), icon: FolderTree, color: '#6b9eff' },
  { id: 'colors', name: tr('Color Swatches'), text: tr('Shows a swatch and a color picker next to #hex and rgb() colors in any file.'), icon: Palette, color: '#ff7ab2' },
  { id: 'markdownPreview', name: tr('Markdown Preview'), text: tr('A live preview beside a Markdown file (the eye button at the top right).'), icon: Eye, color: '#519aba' },
  { id: 'htmlPreview', name: tr('HTML Preview'), text: tr('A live preview beside an HTML file. It runs in a sealed frame: its scripts can’t reach the server.'), icon: Eye, color: '#e44d26' },
  { id: 'bracketColors', name: tr('Bracket Pair Colors'), text: tr('Colours matching brackets alike, and draws guides between them.'), icon: Brackets, color: '#ffd700' },
  { id: 'stickyScroll', name: tr('Sticky Scroll'), text: tr('Keeps the function or block being read at the top while scrolling.'), icon: PanelTop, color: '#4ec9b0' },
]

export function ExtensionsPanel({ value, onChange }: { value: ExtensionSettings; onChange: (next: ExtensionSettings) => void }) {
  return (
    <>
      <div className="ce-side-head">{tr('EXTENSIONS')}</div>
      <div className="ce-exts">
        <p className="ce-exts-note">
          <Braces size={12} /> {tr('Built in, and working without internet. For VS Code itself, with its whole marketplace, install code-server from the App Center.')}
        </p>
        {ENTRIES.filter(e => !e.under || value[e.under]).map(e => (
          <div key={e.id} className={`ce-ext ${e.under ? 'is-under' : ''} ${value[e.id] ? '' : 'is-off'}`}>
            <span className="ce-ext-icon" style={{ color: e.color }}>
              <e.icon size={e.under ? 14 : 18} />
            </span>
            <span className="ce-ext-text">
              <strong>{e.name}</strong>
              <small>{e.text}</small>
            </span>
            <Switch checked={value[e.id]} onChange={on => onChange({ ...value, [e.id]: on })} label={e.name} />
          </div>
        ))}
      </div>
    </>
  )
}
