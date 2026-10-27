import { useState } from 'react'
import { Copy, Cpu, Laptop, Monitor, MonitorPlay, Server } from 'lucide-react'
import type { DeviceKind, ScreenProtocol } from '../api/types'
import { copyText } from '../lib/clipboard'
import { tr } from '../lib/i18n'

// How to set up another computer so its screen can be shown in Devices, for each system and
// version, and what the server needs to do it smoothly. Shown when Devices is empty, from its
// Setup Guide button, and in the Add Device sheet (opened on the kind being added).

type GuideOS = 'windows' | 'mac' | 'linux'
type Step = { text: string; cmd?: string }
interface Variant {
  id: string
  label: string
  /** Missing when it depends on the desktop (RDP on GNOME and KDE, VNC elsewhere). */
  protocol?: Exclude<ScreenProtocol, ''>
  steps: Step[]
}

const OSES: { id: GuideOS; label: string; icon: typeof Monitor }[] = [
  { id: 'windows', label: tr('Windows'), icon: Monitor },
  { id: 'mac', label: tr('Mac'), icon: Laptop },
  { id: 'linux', label: tr('Linux'), icon: Server },
]

const ONE_SCREEN_LINUX = tr('The -clip xinerama0 part shares only the first screen (xinerama1: the second), which is lighter for both computers and the server; leave it out to share them all.')

const GUIDE: Record<GuideOS, Variant[]> = {
  windows: [
    {
      id: 'pro',
      label: tr('Pro, Enterprise or Education (x64 or ARM)'),
      protocol: 'rdp',
      steps: [
        { text: tr('Settings → System → Remote Desktop → turn Remote Desktop on.') },
        { text: tr('In Devices choose RDP (port 3389) and sign in with the Windows account. For a Microsoft account that’s its email and password, not the PIN.') },
        { text: tr('RDP draws one screen the size of this window, however many screens the PC has: the lightest way.') },
      ],
    },
    {
      id: 'home',
      label: tr('Home (x64)'),
      protocol: 'vnc',
      steps: [
        { text: tr('Install TightVNC Server from tightvnc.com (the 64-bit installer), and let it run as a service.') },
        { text: tr('Set a password for remote access when it asks, and allow it through the firewall.') },
        { text: tr('To share only the main screen (lighter for everything), run this in Command Prompt as administrator:'), cmd: '"C:\\Program Files\\TightVNC\\tvnserver.exe" -controlservice -shareprimary' },
        { text: tr('In Devices choose VNC (port 5900) and that password; leave the user name empty.') },
      ],
    },
    {
      id: 'arm',
      label: tr('Home on ARM (Snapdragon)'),
      protocol: 'vnc',
      steps: [
        { text: tr('Windows 11 on ARM runs TightVNC Server’s 64-bit installer through its built-in emulation: set it up as on Home (x64).') },
        { text: tr('Emulation costs the laptop some speed and battery. If the PC can move to Windows Pro, RDP is lighter.') },
      ],
    },
  ],
  mac: [
    {
      id: 'settings',
      label: tr('Newer Macs (System Settings)'),
      protocol: 'vnc',
      steps: [
        { text: tr('System Settings → General → Sharing → turn Screen Sharing on.') },
        { text: tr('Click ⓘ next to it, turn on “VNC viewers may control screen with password”, and set a password (only its first 8 characters count).') },
        { text: tr('In Devices choose VNC (port 5900), that password, and leave the user name empty.') },
        { text: tr('The same on Intel and M-series (ARM) Macs. A Mac shares all its screens as one picture; Devices shows one at a time.') },
      ],
    },
    {
      id: 'preferences',
      label: tr('Older Macs (System Preferences)'),
      protocol: 'vnc',
      steps: [
        { text: tr('System Preferences → Sharing → tick Screen Sharing.') },
        { text: tr('Computer Settings… → tick “VNC viewers may control screen with password” and set a password.') },
        { text: tr('In Devices choose VNC (port 5900), that password, and leave the user name empty.') },
      ],
    },
  ],
  linux: [
    {
      id: 'ubuntu',
      label: tr('Ubuntu 22.04 or later'),
      protocol: 'rdp',
      steps: [
        { text: tr('Ubuntu 24.04 and later: Settings → System → Remote Desktop → Desktop Sharing on, and Remote Control on. Ubuntu 22.04: Settings → Sharing → Remote Desktop.') },
        { text: tr('Set the user name and password under Login Details.') },
        { text: tr('In Devices choose RDP (port 3389) with that user name and password. The computer must be signed in (Desktop Sharing shares the open session).') },
      ],
    },
    {
      id: 'mint',
      label: tr('Linux Mint'),
      protocol: 'vnc',
      steps: [
        { text: tr('Install x11vnc and set its password:'), cmd: 'sudo apt install -y x11vnc && x11vnc -storepasswd' },
        { text: tr('Start it (add the same command in Startup Applications to start it at every sign-in):'), cmd: 'x11vnc -usepw -forever -shared -display :0 -clip xinerama0' },
        { text: ONE_SCREEN_LINUX },
        { text: tr('If the firewall is on, allow it:'), cmd: 'sudo ufw allow 5900/tcp' },
        { text: tr('In Devices choose VNC (port 5900) and that password.') },
      ],
    },
    {
      id: 'debian',
      label: tr('Debian'),
      steps: [
        { text: tr('With GNOME: as on Ubuntu (Settings → System → Remote Desktop, RDP). If it’s missing, install it:'), cmd: 'sudo apt install -y gnome-remote-desktop' },
        { text: tr('With another desktop (Xfce, KDE on X11, MATE…): x11vnc, as on Linux Mint:'), cmd: 'sudo apt install -y x11vnc && x11vnc -storepasswd' },
        { text: tr('Then start it:'), cmd: 'x11vnc -usepw -forever -shared -display :0 -clip xinerama0' },
        { text: ONE_SCREEN_LINUX },
      ],
    },
    {
      id: 'arch',
      label: tr('Arch Linux'),
      steps: [
        { text: tr('GNOME: install GNOME’s remote desktop, then turn it on in Settings → System → Remote Desktop (RDP):'), cmd: 'sudo pacman -S gnome-remote-desktop' },
        { text: tr('KDE Plasma 6: install KRdp, then turn it on in System Settings → Remote Desktop (RDP):'), cmd: 'sudo pacman -S krdp' },
        { text: tr('Other desktops on X11: x11vnc:'), cmd: 'sudo pacman -S x11vnc && x11vnc -storepasswd' },
        { text: tr('Then start it:'), cmd: 'x11vnc -usepw -forever -shared -display :0 -clip xinerama0' },
      ],
    },
    {
      id: 'fedora',
      label: tr('Fedora'),
      protocol: 'rdp',
      steps: [
        { text: tr('Workstation (GNOME): Settings → System → Remote Desktop → Desktop Sharing and Remote Control on, then set the login details.') },
        { text: tr('KDE: System Settings → Remote Desktop (install krdp first if it’s not there).'), cmd: 'sudo dnf install -y krdp' },
        { text: tr('In Devices choose RDP (port 3389) with that user name and password.') },
      ],
    },
  ],
}

const LINUX_NOTE = tr('x64 and ARM computers set up the same way. x11vnc needs an X11 session: on a desktop that uses Wayland, use its own Remote Desktop (RDP) instead, or choose an “Xorg” session when signing in.')

const SPECS: { label: string; text: string }[] = [
  { label: tr('Minimum'), text: tr('One screen up to 1080p: 2 CPU cores (Celeron J4125, Raspberry Pi 5 or better), 1 GB of free memory, and the server on a network cable.') },
  { label: tr('Smooth'), text: tr('1440p, or two screens at once: 4 cores (Intel N100, Core i3 8th generation or Ryzen 3 and newer) and 2 GB free.') },
  { label: tr('All screens or 4K'), text: tr('4 or more fast cores (Core i5 8th generation, Ryzen 5 or newer), and the other computer on a network cable too.') },
  { label: tr('From outside home'), text: tr('The home connection’s upload is the limit: about 5 Mbps for one 1080p screen, 10 Mbps or more for smooth use or several screens.') },
]

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className="rg-steps">
      {steps.map(s => (
        <li key={s.text + (s.cmd ?? '')}>
          {s.text}
          {s.cmd && (
            <span className="rg-cmd">
              <code>{s.cmd}</code>
              <button type="button" className="icon-btn" onClick={() => void copyText(s.cmd!)} title={tr('Copy')} aria-label={tr('Copy')}>
                <Copy size={12} />
              </button>
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

const osOf = (kind?: DeviceKind): GuideOS => (kind === 'mac' ? 'mac' : kind === 'linux' ? 'linux' : 'windows')

/** The setup guide: pick the system and version, follow the steps. */
export function RemoteGuide({ kind, compact, onProtocol }: { kind?: DeviceKind; compact?: boolean; onProtocol?: (p: Exclude<ScreenProtocol, ''>) => void }) {
  const [os, setOs] = useState<GuideOS>(() => osOf(kind))
  const [variant, setVariant] = useState<Record<GuideOS, string>>({ windows: 'pro', mac: 'settings', linux: 'ubuntu' })
  // The Add Device sheet follows the kind being added.
  const shown = compact && kind ? osOf(kind) : os
  const list = GUIDE[shown]
  const v = list.find(x => x.id === variant[shown]) ?? list[0]
  return (
    <div className={`rg ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <div className="segmented rg-os" role="tablist">
          {OSES.map(o => (
            <button key={o.id} type="button" role="tab" aria-selected={os === o.id} className={os === o.id ? 'is-active' : ''} onClick={() => setOs(o.id)}>
              <o.icon size={13} /> {o.label}
            </button>
          ))}
        </div>
      )}
      <div className="rg-variants">
        {list.map(x => (
          <button key={x.id} type="button" className={`pill-btn ${x.id === v.id ? 'is-on' : ''}`} onClick={() => setVariant(m => ({ ...m, [shown]: x.id }))}>
            {x.label}
          </button>
        ))}
      </div>
      <p className="rg-uses">
        <MonitorPlay size={13} /> {v.protocol === 'rdp' ? tr('Uses RDP') : v.protocol === 'vnc' ? tr('Uses VNC') : tr('RDP or VNC, depending on the desktop')}
        {onProtocol && v.protocol && (
          <button type="button" className="dv-link" onClick={() => onProtocol(v.protocol!)}>
            {tr('Use this')}
          </button>
        )}
      </p>
      <Steps steps={v.steps} />
      {shown === 'linux' && <p className="rg-note">{LINUX_NOTE}</p>}
      {!compact && <Screens />}
      {!compact && <ServerSpecs />}
    </div>
  )
}

/** Several screens: what Devices shows, and how to make the other computer share just one. */
function Screens() {
  const ways: Step[] = [
    { text: tr('Windows over RDP: always one screen, the size of the window. Nothing to set.') },
    { text: tr('Windows with TightVNC: share the main screen only:'), cmd: '"C:\\Program Files\\TightVNC\\tvnserver.exe" -controlservice -shareprimary' },
    { text: tr('Linux with x11vnc: add -clip xinerama0 (the first screen) or xinerama1 (the second).') },
    { text: tr('Linux over RDP (GNOME, KDE): one session screen, like Windows.') },
    { text: tr('Mac: it always shares every screen; Devices shows one of them, but all of them travel.') },
  ]
  return (
    <div className="rg-specs">
      <h4>
        <Monitor size={14} /> {tr('Computers with several screens')}
      </h4>
      <p className="rg-note">
        {tr('Devices shows one screen at a time (pick another, or all of them, at the top of the window). Over VNC the computer still sends every screen, which the server turns into images: for the lightest load on the server and the connection, let it share one screen only:')}
      </p>
      <Steps steps={ways} />
    </div>
  )
}

/** What the server needs to show other screens smoothly. */
export function ServerSpecs() {
  return (
    <div className="rg-specs">
      <h4>
        <Cpu size={14} /> {tr('What the server needs')}
      </h4>
      <p className="rg-note">{tr('The server turns the other computer’s screen into pictures for the browser; that takes processor time, more for bigger and more screens.')}</p>
      <dl>
        {SPECS.map(s => (
          <div key={s.label}>
            <dt>{s.label}</dt>
            <dd>{s.text}</dd>
          </div>
        ))}
      </dl>
      <p className="rg-note">{tr('A Raspberry Pi 4 or an older dual-core box works, but feels slow at 1080p: a lower screen resolution on the other computer helps.')}</p>
    </div>
  )
}
