import type { HardwareInfo } from '../api/types'
import { tr } from '../lib/i18n'

/** A drawing of the kind of machine the server is, for About This Server. */
export function DeviceArt({ kind, size = 120 }: { kind: HardwareInfo['kind'] | undefined; size?: number }) {
  const props = { width: size, height: size * 0.72, viewBox: '0 0 120 86', className: 'device-art', 'aria-hidden': true }
  const shadow = <ellipse cx="60" cy="78" rx="46" ry="4" fill="rgba(0,0,0,0.22)" />
  switch (kind) {
    case 'laptop':
      return (
        <svg {...props}>
          {shadow}
          <rect x="24" y="14" width="72" height="50" rx="4" fill="#2b2d33" />
          <rect x="28" y="18" width="64" height="42" rx="1.5" fill="url(#da-screen)" />
          <path d="M12 66h96l-6 8H18z" fill="url(#da-metal)" />
          <rect x="52" y="66" width="16" height="2" rx="1" fill="rgba(0,0,0,0.18)" />
          <Defs />
        </svg>
      )
    case 'allinone':
      return (
        <svg {...props}>
          {shadow}
          <rect x="18" y="8" width="84" height="56" rx="4" fill="#2b2d33" />
          <rect x="22" y="12" width="76" height="46" rx="1.5" fill="url(#da-screen)" />
          <path d="M52 64h16l4 12H48z" fill="url(#da-metal)" />
          <Defs />
        </svg>
      )
    case 'desktop':
      return (
        <svg {...props}>
          {shadow}
          <path d="M40 10h34l8-6v66l-8 6z" fill="#24262b" />
          <rect x="38" y="10" width="36" height="66" rx="2" fill="url(#da-case)" />
          <circle cx="56" cy="20" r="3" fill="none" stroke="#9ba3ad" strokeWidth="1.2" />
          <rect x="47" y="28" width="5" height="2" rx="0.5" fill="#9ba3ad" />
          <rect x="54" y="28" width="5" height="2" rx="0.5" fill="#9ba3ad" />
          {[40, 45, 50, 55, 60, 65].map(y => (
            <rect key={y} x="44" y={y} width="24" height="1.2" rx="0.6" fill="rgba(255,255,255,0.08)" />
          ))}
          <circle cx="66" cy="20" r="1" fill="#30d158" />
          <Defs />
        </svg>
      )
    case 'server':
      return (
        <svg {...props}>
          {shadow}
          {[18, 36, 54].map(y => (
            <g key={y}>
              <rect x="14" y={y} width="92" height="16" rx="2" fill="url(#da-case)" />
              <circle cx="22" cy={y + 8} r="1.6" fill="#30d158" />
              {[34, 46, 58, 70].map(x => (
                <rect key={x} x={x} y={y + 5} width="9" height="6" rx="1" fill="rgba(255,255,255,0.1)" />
              ))}
              <rect x="86" y={y + 6} width="14" height="4" rx="1" fill="rgba(255,255,255,0.12)" />
            </g>
          ))}
          <Defs />
        </svg>
      )
    case 'virtual':
      return (
        <svg {...props}>
          {shadow}
          <path d="M36 62a16 16 0 0 1 2-31.8A22 22 0 0 1 80 26a18 18 0 0 1 4 36z" fill="url(#da-cloud)" />
          <rect x="44" y="38" width="32" height="9" rx="2" fill="rgba(255,255,255,0.9)" />
          <rect x="44" y="49" width="32" height="9" rx="2" fill="rgba(255,255,255,0.9)" />
          <circle cx="49" cy="42.5" r="1.4" fill="#30d158" />
          <circle cx="49" cy="53.5" r="1.4" fill="#30d158" />
          <Defs />
        </svg>
      )
    case 'board':
      return (
        <svg {...props}>
          {shadow}
          <rect x="16" y="20" width="88" height="54" rx="4" fill="#1f8a4c" />
          <rect x="44" y="34" width="22" height="22" rx="2" fill="#2b2d33" />
          <rect x="22" y="24" width="60" height="4" rx="1" fill="#d4af37" />
          <rect x="86" y="30" width="14" height="12" rx="1" fill="#c7ccd4" />
          <rect x="86" y="48" width="14" height="12" rx="1" fill="#c7ccd4" />
          <rect x="24" y="62" width="10" height="8" rx="1" fill="#c7ccd4" />
          <Defs />
        </svg>
      )
    default:
      // A mini PC: a small flat box, seen from the front.
      return (
        <svg {...props}>
          {shadow}
          <path d="M18 34h76l12-10H30z" fill="#4a4e57" />
          <path d="M94 34l12-10v30l-12 10z" fill="#1d1f23" />
          <rect x="18" y="34" width="76" height="30" rx="2" fill="url(#da-case)" />
          <circle cx="28" cy="49" r="3.2" fill="none" stroke="#9ba3ad" strokeWidth="1.2" />
          <circle cx="28" cy="49" r="1" fill="#30d158" />
          <rect x="38" y="45" width="7" height="3" rx="0.6" fill="#9ba3ad" />
          <rect x="38" y="51" width="7" height="3" rx="0.6" fill="#9ba3ad" />
          <circle cx="51" cy="49.5" r="1.6" fill="#9ba3ad" />
          {[62, 66, 70, 74, 78, 82, 86].map(x => (
            <rect key={x} x={x} y="40" width="1.4" height="18" rx="0.7" fill="rgba(255,255,255,0.08)" />
          ))}
          <Defs />
        </svg>
      )
  }
}

function Defs() {
  return (
    <defs>
      <linearGradient id="da-case" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#3a3d44" />
        <stop offset="1" stopColor="#202226" />
      </linearGradient>
      <linearGradient id="da-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#d9dde3" />
        <stop offset="1" stopColor="#9aa1ab" />
      </linearGradient>
      <linearGradient id="da-screen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#5ac8fa" />
        <stop offset="1" stopColor="#0a63d6" />
      </linearGradient>
      <linearGradient id="da-cloud" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7cc4ff" />
        <stop offset="1" stopColor="#2f7cf6" />
      </linearGradient>
    </defs>
  )
}

const KIND_LABEL: Record<HardwareInfo['kind'], string> = {
  mini: tr('Mini PC'),
  desktop: tr('Desktop'),
  laptop: tr('Laptop'),
  allinone: tr('All-in-one'),
  server: tr('Rack server'),
  board: tr('Single-board computer'),
  virtual: tr('Virtual server'),
  unknown: tr('Server'),
}

/** "ThinkCentre M710q" and "Mini PC, 2017 · 10MQS31W00"; a VPS is "Virtual server", by its host. */
export function deviceTitle(hw: HardwareInfo | null, hostname?: string) {
  if (!hw) return { title: hostname ?? '', subtitle: '' }
  const kind = KIND_LABEL[hw.kind]
  if (hw.kind === 'virtual') {
    return { title: hw.vendor ? `${hw.vendor} ${kind}` : kind, subtitle: hw.virtualization ? hw.virtualization.toUpperCase() : '' }
  }
  const title = hw.model ? (hw.vendor && !hw.model.toLowerCase().startsWith(hw.vendor.toLowerCase()) ? `${hw.vendor} ${hw.model}` : hw.model) : (hostname ?? kind)
  const subtitle = [[kind, hw.year].filter(Boolean).join(', '), hw.modelNumber].filter(Boolean).join(' · ')
  return { title, subtitle }
}
