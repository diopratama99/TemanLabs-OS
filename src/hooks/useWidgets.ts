import { useSettings } from '../lib/settings'
import { createWidget, defaultWidgets, type WidgetConfig, type WidgetSize, type WidgetType } from '../lib/widgets'

/** The desktop widget layout (stored in settings) and operations on it. */
export function useWidgets() {
  const { settings, update } = useSettings()
  const change = (fn: (widgets: WidgetConfig[]) => WidgetConfig[]) => update(s => ({ widgets: fn(s.widgets) }))

  return {
    widgets: settings.widgets,
    setSize: (id: string, size: WidgetSize) => change(ws => ws.map(w => (w.id === id ? { ...w, size } : w))),
    /** Merges into the widget's options; callers pass fields valid for that widget's type. */
    setOptions: (id: string, patch: Record<string, unknown>) =>
      change(ws => ws.map(w => (w.id === id ? ({ ...w, options: { ...w.options, ...patch } } as WidgetConfig) : w))),
    remove: (id: string) => change(ws => ws.filter(w => w.id !== id)),
    add: (type: WidgetType, size?: WidgetSize) => change(ws => [...ws, createWidget(type, size)]),
    /** Moves a widget to where `targetId` currently is. */
    move: (id: string, targetId: string) =>
      change(ws => {
        const from = ws.findIndex(w => w.id === id)
        const to = ws.findIndex(w => w.id === targetId)
        if (from < 0 || to < 0 || from === to) return ws
        const next = [...ws]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return next
      }),
    reset: () => change(() => defaultWidgets()),
  }
}
