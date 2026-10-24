// Loaded lazily (React.lazy) — Monaco is several MB, so it only downloads when Code is opened.
import { useMemo } from 'react'
import Editor, { loader, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
// monaco-editor's package exports map `monaco-editor/<path>` to `esm/vs/<path>.js`.
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { tr } from '../../lib/i18n'

// Use the bundled copy instead of @monaco-editor/react's default CDN, so the editor works on a
// home server without internet access.
window.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  },
}
loader.config({ monaco })

// Transparent backgrounds so the editor sits on the window's glass.
monaco.editor.defineTheme('teman-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000',
    'editorGutter.background': '#00000000',
    'minimap.background': '#16161d66',
    'editor.lineHighlightBackground': '#ffffff0c',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#ffffff40',
    'editorLineNumber.activeForeground': '#ffffffb3',
    'scrollbarSlider.background': '#ffffff1a',
    'scrollbarSlider.hoverBackground': '#ffffff2e',
    'editorWidget.background': '#26262ef2',
    'editorStickyScroll.background': '#1d1d24f0',
    'editorOverviewRuler.background': '#00000000',
    'editorOverviewRuler.border': '#00000000',
  },
})

monaco.editor.defineTheme('teman-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff00',
    'editorGutter.background': '#ffffff00',
    'minimap.background': '#ffffff66',
    'editor.lineHighlightBackground': '#0000000a',
    'editor.lineHighlightBorder': '#00000000',
    'editorLineNumber.foreground': '#00000040',
    'editorLineNumber.activeForeground': '#000000a6',
    'scrollbarSlider.background': '#0000001a',
    'scrollbarSlider.hoverBackground': '#0000002e',
    'editorWidget.background': '#f6f6f9f2',
    'editorStickyScroll.background': '#f4f4f8f0',
    'editorOverviewRuler.background': '#ffffff00',
    'editorOverviewRuler.border': '#ffffff00',
  },
})

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
  fontSize: 13,
  lineHeight: 20,
  tabSize: 2,
  padding: { top: 10, bottom: 10 },
  minimap: { enabled: true, renderCharacters: false, scale: 1 },
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  stickyScroll: { enabled: true },
  renderLineHighlight: 'all',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  // Replaced by the desktop's glass context menu (see CodeEditor).
  contextmenu: false,
}

export interface MonacoViewProps {
  path: string
  language: string
  /** Only used when the model for `path` is created; afterwards the model owns the text. */
  defaultValue: string
  dark: boolean
  wordWrap: boolean
  minimap: boolean
  onChange: (value: string) => void
  onMount: OnMount
}

export default function MonacoView({
  path,
  language,
  defaultValue,
  dark,
  wordWrap,
  minimap,
  onChange,
  onMount,
}: MonacoViewProps) {
  const options = useMemo<monaco.editor.IStandaloneEditorConstructionOptions>(
    () => ({ ...OPTIONS, wordWrap: wordWrap ? 'on' : 'off', minimap: { ...OPTIONS.minimap, enabled: minimap } }),
    [wordWrap, minimap],
  )
  return (
    <Editor
      path={path}
      defaultLanguage={language}
      defaultValue={defaultValue}
      theme={dark ? 'teman-dark' : 'teman-light'}
      options={options}
      // Models (and their undo history) outlive the window; CodeEditor disposes them when tabs close.
      keepCurrentModel
      loading={<div className="ce-loading">{tr('Loading editor…')}</div>}
      onChange={value => onChange(value ?? '')}
      onMount={onMount}
    />
  )
}
