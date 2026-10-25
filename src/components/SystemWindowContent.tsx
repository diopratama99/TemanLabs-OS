import type { Device, InstalledApp, SystemStats } from '../api/types'
import type { useApps } from '../hooks/useApps'
import type { useAppUpdates } from '../hooks/useAppUpdates'
import { tr } from '../lib/i18n'
import type { MediaKind, MediaRequest } from '../lib/media'
import { AboutServer } from '../windows/AboutServer'
import { AppCenter, type StoreCategory } from '../windows/AppCenter'
import { CodeEditor, type OpenRequest } from '../windows/CodeEditor'
import { Commands } from '../windows/Commands'
import { Devices } from '../windows/Devices'
import { DiskManager } from '../windows/DiskManager'
import { Downloader } from '../windows/Downloader'
import { Files } from '../windows/Files'
import { Kubernetes } from '../windows/Kubernetes'
import { LiveRecorder } from '../windows/LiveRecorder'
import { LogViewer } from '../windows/LogViewer'
import { MusicPlayer } from '../windows/MusicPlayer'
import { NetworkTools } from '../windows/NetworkTools'
import { PhotoViewer } from '../windows/PhotoViewer'
import { Remux } from '../windows/Remux'
import { ScheduledTasks } from '../windows/ScheduledTasks'
import { Settings, type SettingsSection } from '../windows/Settings'
import { Sharing, type ShareRequest } from '../windows/Sharing'
import { SystemMonitor } from '../windows/SystemMonitor'
import { SystemUpdates } from '../windows/SystemUpdates'
import { Terminal } from '../windows/Terminal'
import { VideoPlayer } from '../windows/VideoPlayer'
import type { SystemWindowId, WindowId } from './Window'

// The built-in apps' contents, for both the desktop's windows and the phone's screens: each shell
// keeps the state and says how to open things, and the apps are the same in both.

export const SYSTEM_WINDOWS: Record<SystemWindowId, { title: string; width: number; height: number }> = {
  store: { title: tr('App Center'), width: 940, height: 600 },
  files: { title: tr('Files'), width: 820, height: 520 },
  code: { title: tr('Code'), width: 1120, height: 700 },
  settings: { title: tr('Settings'), width: 860, height: 690 },
  terminal: { title: tr('Terminal'), width: 680, height: 420 },
  activity: { title: tr('System Monitor'), width: 980, height: 600 },
  sharing: { title: tr('File Sharing'), width: 900, height: 600 },
  updates: { title: tr('System Updates'), width: 760, height: 620 },
  console: { title: tr('Log Viewer'), width: 1080, height: 660 },
  disks: { title: tr('Disk Manager'), width: 900, height: 620 },
  network: { title: tr('Network Tools'), width: 900, height: 600 },
  scheduler: { title: tr('Scheduled Tasks'), width: 860, height: 560 },
  kubernetes: { title: tr('Kubernetes'), width: 1080, height: 680 },
  music: { title: tr('Music Player'), width: 760, height: 600 },
  preview: { title: tr('Image Viewer'), width: 920, height: 640 },
  video: { title: tr('Video Player'), width: 960, height: 600 },
  remux: { title: tr('Remux'), width: 980, height: 640 },
  commands: { title: tr('Commands'), width: 1040, height: 680 },
  devices: { title: tr('Devices'), width: 900, height: 600 },
  about: { title: tr('About This Server'), width: 300, height: 430 },
  downloader: { title: tr('Downloader'), width: 820, height: 600 },
  recorder: { title: tr('Live Recorder'), width: 900, height: 640 },
}

// Windows with a source-list sidebar run it full height; Terminal gets a slim title bar.
export const WINDOW_VARIANT: Partial<Record<SystemWindowId, 'sidebar' | 'compact'>> = {
  files: 'sidebar',
  store: 'sidebar',
  settings: 'sidebar',
  sharing: 'sidebar',
  console: 'sidebar',
  disks: 'sidebar',
  scheduler: 'sidebar',
  kubernetes: 'sidebar',
  // A slim title bar for windows with nothing in it but their title.
  terminal: 'compact',
  video: 'compact',
  code: 'compact',
  music: 'compact',
  remux: 'compact',
  devices: 'compact',
  about: 'compact',
  commands: 'sidebar',
}

export type MediaWindow = 'preview' | 'video' | 'music'

export interface WindowHost {
  stats: SystemStats | null
  apps: InstalledApp[]
  appsState: Pick<ReturnType<typeof useApps>, 'busy' | 'install' | 'installCustom' | 'toggle' | 'uninstall' | 'refresh'>
  appUpdates: ReturnType<typeof useAppUpdates>
  storeCategory: StoreCategory
  setStoreCategory: (category: StoreCategory) => void
  settingsSection: SettingsSection
  setSettingsSection: (section: SettingsSection) => void
  filesOpen: { path: string; nonce: number } | null
  editorRequest: OpenRequest | null
  mediaRequests: Partial<Record<MediaWindow, MediaRequest>>
  remuxRequest: MediaRequest | null
  shareRequest: ShareRequest | null
  terminalInput: { text: string; nonce: number } | null
  openWindow: (id: WindowId) => void
  openAppWindow: (app: InstalledApp) => void
  openAppSettings: (app: InstalledApp, options?: { tab?: 'terminal'; update?: boolean }) => void
  openMedia: (path: string, kind: MediaKind) => void
  openFilesAt: (path: string) => void
  openInEditor: (path: string, kind?: OpenRequest['kind']) => void
  openSettings: (section: SettingsSection) => void
  openStore: (category: StoreCategory) => void
  openRemote: (device: Device) => void
  openShare: (path: string) => void
  openRemux: (path: string) => void
  runInTerminal: (text: string) => void
  setWindowTitle: (id: WindowId, title: string) => void
  onPower: (action: 'restart' | 'shutdown') => void
  onEditWidgets: () => void
}

export function renderSystemWindow(id: SystemWindowId, h: WindowHost) {
  const { busy, install, installCustom, toggle, uninstall, refresh } = h.appsState
  switch (id) {
    case 'store':
      return (
        <AppCenter
          apps={h.apps}
          busy={busy}
          category={h.storeCategory}
          onCategoryChange={h.setStoreCategory}
          onInstall={install}
          onInstallCustom={installCustom}
          onToggle={toggle}
          onUninstall={uninstall}
          onOpenApp={h.openAppWindow}
          onSettings={h.openAppSettings}
          onInstalled={() => void refresh()}
          updates={h.appUpdates}
        />
      )
    case 'files':
      return (
        <Files
          onOpenFile={path => h.openInEditor(path)}
          onOpenFolder={path => h.openInEditor(path, 'folder')}
          onOpenMedia={h.openMedia}
          onShareFolder={h.openShare}
          onConvert={h.openRemux}
          onGetInfo={path => h.openWindow(`info:${path}`)}
          open={h.filesOpen}
        />
      )
    case 'code':
      return <CodeEditor stats={h.stats} request={h.editorRequest} />
    case 'settings':
      return (
        <Settings
          stats={h.stats}
          section={h.settingsSection}
          onSectionChange={h.setSettingsSection}
          onOpenWindow={h.openWindow}
          onPower={h.onPower}
          onEditWidgets={h.onEditWidgets}
          appUpdates={h.appUpdates.count}
          onOpenAppUpdates={() => h.openStore('Updates')}
          apps={h.apps}
          appActions={{
            busy,
            onOpen: h.openAppWindow,
            onToggle: toggle,
            onUninstall: uninstall,
            onSettings: h.openAppSettings,
            updateAvailable: h.appUpdates.available,
            onOpenStore: () => h.openStore('All'),
            onRefresh: () => void refresh(),
          }}
        />
      )
    case 'terminal':
      return <Terminal onTitle={t => h.setWindowTitle('terminal', t)} input={h.terminalInput} onFindCommand={() => h.openWindow('commands')} />
    case 'preview':
      return <PhotoViewer request={h.mediaRequests.preview ?? null} onTitle={t => h.setWindowTitle('preview', t)} />
    case 'video':
      return <VideoPlayer request={h.mediaRequests.video ?? null} onTitle={t => h.setWindowTitle('video', t)} onConvert={h.openRemux} />
    case 'devices':
      return <Devices onConnect={h.openRemote} />
    case 'downloader':
      return <Downloader onOpenMedia={h.openMedia} onShowInFiles={h.openFilesAt} />
    case 'recorder':
      return <LiveRecorder onOpenMedia={h.openMedia} onShowInFiles={h.openFilesAt} />
    case 'about':
      return <AboutServer stats={h.stats} onMoreInfo={() => h.openSettings('about')} />
    case 'commands':
      return <Commands onRun={h.runInTerminal} />
    case 'remux':
      return <Remux request={h.remuxRequest} onPlay={h.openMedia} />
    case 'music':
      return <MusicPlayer request={h.mediaRequests.music ?? null} onTitle={t => h.setWindowTitle('music', t)} />
    case 'updates':
      return <SystemUpdates />
    case 'console':
      return <LogViewer />
    case 'disks':
      return <DiskManager />
    case 'network':
      return <NetworkTools />
    case 'scheduler':
      return <ScheduledTasks />
    case 'kubernetes':
      return <Kubernetes />
    case 'sharing':
      return <Sharing stats={h.stats} request={h.shareRequest} />
    case 'activity':
      return <SystemMonitor apps={h.apps} stats={h.stats} onOpenApp={h.openAppWindow} />
  }
}
