// Code's built-in extensions: what the VS Code extensions people install first do, made for this
// editor. Each one can be turned off in the Extensions view (see CodeEditor); this file is loaded
// with Monaco, and Prettier and the Markdown renderer only when they're first used.
import type * as Monaco from 'monaco-editor'
import { api } from '../../api'
import { joinPath, parentOf } from '../../lib/paths'

export type ExtensionId =
  | 'prettier'
  | 'formatOnSave'
  | 'inlineErrors'
  | 'renameTags'
  | 'todo'
  | 'rainbowIndent'
  | 'pathCompletion'
  | 'colors'
  | 'markdownPreview'
  | 'htmlPreview'
  | 'bracketColors'
  | 'stickyScroll'

export type ExtensionSettings = Record<ExtensionId, boolean>

export const DEFAULT_EXTENSIONS: ExtensionSettings = {
  prettier: true,
  formatOnSave: false,
  inlineErrors: true,
  renameTags: true,
  todo: true,
  rainbowIndent: false,
  pathCompletion: true,
  colors: true,
  markdownPreview: true,
  htmlPreview: true,
  bracketColors: true,
  stickyScroll: true,
}

type MonacoNS = typeof Monaco
type Editor = Monaco.editor.IStandaloneCodeEditor

// ----- Prettier -----

// Prettier's parser (and the plugins it needs) for each of the editor's languages.
const PRETTIER: Record<string, { parser: string; plugins: string[] }> = {
  javascript: { parser: 'babel', plugins: ['babel', 'estree'] },
  typescript: { parser: 'typescript', plugins: ['typescript', 'estree'] },
  json: { parser: 'json', plugins: ['babel', 'estree'] },
  css: { parser: 'css', plugins: ['postcss'] },
  scss: { parser: 'scss', plugins: ['postcss'] },
  less: { parser: 'less', plugins: ['postcss'] },
  html: { parser: 'html', plugins: ['html', 'postcss', 'babel', 'estree'] },
  markdown: { parser: 'markdown', plugins: ['markdown'] },
  mdx: { parser: 'mdx', plugins: ['markdown'] },
  yaml: { parser: 'yaml', plugins: ['yaml'] },
  graphql: { parser: 'graphql', plugins: ['graphql'] },
  handlebars: { parser: 'glimmer', plugins: ['glimmer'] },
}

const PLUGIN_LOADERS: Record<string, () => Promise<unknown>> = {
  babel: () => import('prettier/plugins/babel'),
  estree: () => import('prettier/plugins/estree'),
  typescript: () => import('prettier/plugins/typescript'),
  postcss: () => import('prettier/plugins/postcss'),
  html: () => import('prettier/plugins/html'),
  markdown: () => import('prettier/plugins/markdown'),
  yaml: () => import('prettier/plugins/yaml'),
  graphql: () => import('prettier/plugins/graphql'),
  glimmer: () => import('prettier/plugins/glimmer'),
}

// Files opened as HTML that Prettier's HTML parser would mangle (Vue has its own parser).
const NOT_HTML = /\.(svelte|astro|ejs|erb)$/i

const prettierFor = (language: string, path: string) => {
  if (language === 'html' && /\.vue$/i.test(path)) return { parser: 'vue', plugins: PRETTIER.html.plugins }
  if (language === 'html' && NOT_HTML.test(path)) return undefined
  return PRETTIER[language]
}

export const prettierSupports = (language: string, path: string) => !!prettierFor(language, path)

/** The file formatted by Prettier, keeping the file's indentation (tabs or spaces, and how many). */
export async function prettierFormat(text: string, language: string, path: string, model?: Monaco.editor.ITextModel): Promise<string> {
  const how = prettierFor(language, path)
  if (!how) return text
  const [prettier, ...plugins] = await Promise.all([import('prettier/standalone'), ...how.plugins.map(p => PLUGIN_LOADERS[p]())])
  const options = model?.getOptions()
  return prettier.format(text, {
    parser: how.parser,
    // A .tsx file needs the JSX-aware parser; Prettier's typescript parser handles both.
    filepath: path,
    plugins: plugins as never[],
    tabWidth: options?.tabSize ?? 2,
    useTabs: options ? !options.insertSpaces : false,
  })
}

function registerPrettier(monaco: MonacoNS, pathOf: (model: Monaco.editor.ITextModel) => string): Monaco.IDisposable[] {
  return Object.keys(PRETTIER).map(language =>
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      displayName: 'Prettier',
      async provideDocumentFormattingEdits(model) {
        const text = model.getValue()
        if (!prettierSupports(language, pathOf(model))) return []
        const formatted = await prettierFormat(text, language, pathOf(model), model)
        return formatted === text ? [] : [{ range: model.getFullModelRange(), text: formatted }]
      },
    }),
  )
}

// ----- Inline errors (problems at the end of their line) -----

function inlineErrors(monaco: MonacoNS, editor: Editor): Monaco.IDisposable {
  const decorations = editor.createDecorationsCollection()
  const severityClass: Record<number, string> = {
    [monaco.MarkerSeverity.Error]: 'ce-lens-error',
    [monaco.MarkerSeverity.Warning]: 'ce-lens-warning',
    [monaco.MarkerSeverity.Info]: 'ce-lens-info',
    [monaco.MarkerSeverity.Hint]: 'ce-lens-info',
  }
  const update = () => {
    const model = editor.getModel()
    if (!model) return decorations.clear()
    // The worst problem of each line.
    const byLine = new Map<number, Monaco.editor.IMarker>()
    for (const m of monaco.editor.getModelMarkers({ resource: model.uri })) {
      const seen = byLine.get(m.startLineNumber)
      if (!seen || m.severity > seen.severity) byLine.set(m.startLineNumber, m)
    }
    // The message after the line's text, and a tint over an erroring line.
    decorations.set(
      [...byLine.values()].flatMap(m => {
        const end = model.getLineMaxColumn(m.startLineNumber)
        const message: Monaco.editor.IModelDeltaDecoration = {
          range: new monaco.Range(m.startLineNumber, end, m.startLineNumber, end),
          options: { showIfCollapsed: true, after: { content: `   ${m.message.split('\n')[0]}`, inlineClassName: severityClass[m.severity] ?? 'ce-lens-info' } },
        }
        if (m.severity !== monaco.MarkerSeverity.Error) return [message]
        return [message, { range: new monaco.Range(m.startLineNumber, 1, m.startLineNumber, 1), options: { isWholeLine: true, className: 'ce-lens-line-error' } }]
      }),
    )
  }
  update()
  const a = monaco.editor.onDidChangeMarkers(update)
  const b = editor.onDidChangeModel(update)
  return { dispose: () => (a.dispose(), b.dispose(), decorations.clear()) }
}

// ----- Decorations from the text: TODO comments, rainbow indents -----

const TODO = /\b(TODO|FIXME|HACK|XXX|BUG|NOTE)\b:?/g
const MAX_DECORATED_LINES = 20000

function textDecorations(monaco: MonacoNS, editor: Editor, todo: boolean, rainbow: boolean): Monaco.IDisposable {
  const decorations = editor.createDecorationsCollection()
  let timer = 0
  const update = () => {
    const model = editor.getModel()
    if (!model || model.getLineCount() > MAX_DECORATED_LINES) return decorations.clear()
    const list: Monaco.editor.IModelDeltaDecoration[] = []
    const tab = model.getOptions().tabSize || 2
    for (let line = 1; line <= model.getLineCount(); line++) {
      const text = model.getLineContent(line)
      if (todo) {
        for (const m of text.matchAll(TODO)) {
          const kind = m[1] === 'NOTE' ? 'note' : m[1] === 'FIXME' || m[1] === 'BUG' ? 'fix' : 'todo'
          list.push({ range: new monaco.Range(line, m.index + 1, line, m.index + 1 + m[0].length), options: { inlineClassName: `ce-todo is-${kind}`, overviewRuler: { color: '#ffb02e', position: monaco.editor.OverviewRulerLane.Right } } })
        }
      }
      if (rainbow) {
        const lead = /^[ \t]*/.exec(text)![0]
        if (lead.length === text.length) continue
        // One band per indent level, the width of a tab stop.
        let col = 0
        let start = 1
        for (let i = 0; i < lead.length; i++) {
          col += lead[i] === '\t' ? tab - (col % tab) : 1
          if (col % tab === 0) {
            const level = col / tab - 1
            list.push({ range: new monaco.Range(line, start, line, i + 2), options: { inlineClassName: `ce-indent is-${level % 4}` } })
            start = i + 2
          }
        }
      }
    }
    decorations.set(list)
  }
  const soon = () => {
    clearTimeout(timer)
    timer = window.setTimeout(update, 250)
  }
  update()
  const a = editor.onDidChangeModelContent(soon)
  const b = editor.onDidChangeModel(update)
  return { dispose: () => (clearTimeout(timer), a.dispose(), b.dispose(), decorations.clear()) }
}

// ----- Path completion inside quotes -----

/** A path with its "." and ".." steps taken: /a/b/../c/. → /a/c. */
export function resolvePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return `/${out.join('/')}`
}

function pathCompletion(monaco: MonacoNS, pathOf: (model: Monaco.editor.ITextModel) => string): Monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider('*', {
    triggerCharacters: ['/', '.'],
    async provideCompletionItems(model, position) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1)
      // The path being typed in an open string: './', '../', '/'.
      const m = /(["'`])((?:\.{1,2}\/|\/)(?:[^"'`\s]*\/)?)([^"'`\s/]*)$/.exec(before)
      if (!m) return { suggestions: [] }
      const typed = m[2]
      const dir = resolvePath(typed.startsWith('/') ? typed : joinPath(parentOf(pathOf(model)), typed))
      let entries
      try {
        entries = await api.listFiles(dir)
      } catch {
        return { suggestions: [] }
      }
      const range = new monaco.Range(position.lineNumber, position.column - m[3].length, position.lineNumber, position.column)
      return {
        suggestions: entries
          .filter(e => !e.name.startsWith('.') || m[3].startsWith('.'))
          .slice(0, 200)
          .map(e => ({
            label: e.kind === 'folder' ? `${e.name}/` : e.name,
            kind: e.kind === 'folder' ? monaco.languages.CompletionItemKind.Folder : monaco.languages.CompletionItemKind.File,
            insertText: e.kind === 'folder' ? `${e.name}/` : e.name,
            range,
            // Folders come first, and choosing one asks for what's inside.
            sortText: `${e.kind === 'folder' ? 0 : 1}${e.name}`,
            command: e.kind === 'folder' ? { id: 'editor.action.triggerSuggest', title: '' } : undefined,
          })),
      }
    },
  })
}

// ----- Color swatches in any file -----

const COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)/g
// CSS, SCSS, Less and HTML have their own.
const OWN_COLORS = new Set(['css', 'scss', 'less', 'html'])

function parseColor(text: string): Monaco.languages.IColor | null {
  if (text.startsWith('#')) {
    let hex = text.slice(1)
    if (hex.length <= 4) hex = [...hex].map(c => c + c).join('')
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255
    return { red: n(0), green: n(2), blue: n(4), alpha: hex.length === 8 ? n(6) : 1 }
  }
  const parts = text.match(/[\d.]+/g)?.map(Number) ?? []
  if (parts.length < 3) return null
  return { red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts[3] ?? 1 }
}

function colorSwatches(monaco: MonacoNS): Monaco.IDisposable {
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0')
  return monaco.languages.registerColorProvider('*', {
    provideDocumentColors(model) {
      if (OWN_COLORS.has(model.getLanguageId()) || model.getLineCount() > MAX_DECORATED_LINES) return []
      const out: Monaco.languages.IColorInformation[] = []
      for (let line = 1; line <= model.getLineCount(); line++) {
        for (const m of model.getLineContent(line).matchAll(COLOR)) {
          const color = parseColor(m[0])
          if (color) out.push({ color, range: new monaco.Range(line, m.index + 1, line, m.index + 1 + m[0].length) })
        }
      }
      return out
    },
    provideColorPresentations(_model, info) {
      const { red, green, blue, alpha } = info.color
      const label = `#${hex(red)}${hex(green)}${hex(blue)}${alpha < 1 ? hex(alpha) : ''}`
      return [{ label }, { label: `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${+alpha.toFixed(2)})` }]
    },
  })
}

// ----- Turning them on -----

/** Editor options the extensions set. */
export function extensionOptions(on: ExtensionSettings): Monaco.editor.IEditorOptions {
  return {
    linkedEditing: on.renameTags,
    colorDecorators: on.colors,
    bracketPairColorization: { enabled: on.bracketColors },
    stickyScroll: { enabled: on.stickyScroll },
  }
}

/** Registers what the extensions add to the editor; the result undoes it. */
export function applyExtensions(monaco: MonacoNS, editor: Editor, on: ExtensionSettings, pathOf: (model: Monaco.editor.ITextModel) => string): Monaco.IDisposable {
  const parts: Monaco.IDisposable[] = []
  if (on.prettier) parts.push(...registerPrettier(monaco, pathOf))
  if (on.inlineErrors) parts.push(inlineErrors(monaco, editor))
  if (on.todo || on.rainbowIndent) parts.push(textDecorations(monaco, editor, on.todo, on.rainbowIndent))
  if (on.pathCompletion) parts.push(pathCompletion(monaco, pathOf))
  if (on.colors) parts.push(colorSwatches(monaco))
  return { dispose: () => parts.forEach(p => p.dispose()) }
}

// ----- Markdown preview -----

/** A Markdown file as a page (shown in a sandboxed frame, so no script in it runs). */
export async function markdownPage(text: string, dark: boolean): Promise<string> {
  const { marked } = await import('marked')
  const body = await marked.parse(text, { gfm: true })
  const fg = dark ? '#e5e5ea' : '#1c1c1e'
  const muted = dark ? '#a1a1a6' : '#6e6e73'
  const line = dark ? '#ffffff1f' : '#0000001a'
  const code = dark ? '#ffffff12' : '#0000000a'
  // A solid page: a frame over the window's glass would otherwise show white or blur it.
  const bg = dark ? '#1b1b22' : '#ffffff'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}"><base target="_blank"><style>
html{background:${bg}}
body{margin:0;padding:20px 26px 40px;font:14px/1.65 system-ui,-apple-system,'Segoe UI',sans-serif;color:${fg};background:${bg};max-width:860px}
h1,h2{border-bottom:1px solid ${line};padding-bottom:.3em}h1{font-size:1.9em}h2{font-size:1.45em}
a{color:#3b82f6}code{font:12.5px ui-monospace,Consolas,monospace;background:${code};padding:.15em .35em;border-radius:5px}
pre{background:${code};padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:${muted};border-left:3px solid ${line}}
table{border-collapse:collapse}th,td{border:1px solid ${line};padding:6px 12px}img{max-width:100%}hr{border:0;border-top:1px solid ${line}}
</style></head><body>${body}</body></html>`
}
