# Changelog

What changed in each release of TemanLabsOS. The release workflow puts a version's section on its GitHub release page, so write it before pushing the tag: a heading `## <tag>` (exactly the tag, e.g. `## v0.4.0`), then its notes.

Versions with `-beta` are released like any other (the installer and Software Update offer them); the final version of the same number is offered after its beta.

## v0.4.0-beta

### New
- ZFS pools in Disk Manager, for servers moving from TrueNAS SCALE: import a pool (read-only first to look through it, then for normal use, with a snapshot taken right away), see its health and drives, scrub it, unlock encrypted datasets, and keep daily snapshots. Only TemanLabsOS's own daily snapshots are ever removed, and the pool isn't upgraded, so it can still go back to TrueNAS.
- Apps from TrueNAS 24.10 and later found on an imported pool can be installed again with their data; `/mnt/<pool>` and `/mnt/.ix-apps` keep working as they did on TrueNAS.
- A guide to moving from TrueNAS SCALE: `docs/migrate-truenas.md`.
- Routers: add the modem, routers and access points, and the server checks them every 30 seconds, along with the internet through them. See which one is down (and which are only cut off behind it), uptime and outages, and open a router's admin page. Restart one over SSH (MikroTik, OpenWrt and other Linux-based routers) or with its smart plug (Tasmota, Shelly; the plug switches itself back on), by hand or by itself after 3 minutes, at most twice in a row before it's left to be checked by hand, with the steps to check.
- Routers can be found on the network: the gateway, the household's modem on the way out, and access points (told apart by UPnP, their admin page, or MikroTik's Winbox port), added in one go with how they connect. Smart plugs found along the way can be picked when setting up restarting.

### Changed
- A new server gets the `/DATA` folders (AppData, Documents, Downloads, Gallery, Media) on its first start, as CasaOS sets them up.
- Software Update shows a release's notes as headings and lists.

### Fixed
- A ZFS pool (one from TrueNAS, say) shows as one drive in Storage and Files, not one per dataset, and the Storage widget warns when a pool isn't healthy.
- Format refuses drives that belong to a ZFS pool (even one not imported yet) or hold an encrypted volume.
- Disk health details are no longer all coloured like the verdict.
- Files no longer opens on an error on a server without `/DATA`.
- Installing the Downloader's tools installs python3-venv when the server doesn't have it.
- The screenshots on an App Center page have arrows to page through them.
- Network Tools' tabs are in the middle of the window.

## v0.3.5-beta

### New
- Remote screens work from a phone: Touchpad and Touch modes, an on-screen keyboard with Esc, Tab, Ctrl, Alt, Win/⌘ and arrow keys, and pinch or button zoom.

### Changed
- The installer uses port 80 when it's free, so the desktop opens at `http://<server-ip>`; it falls back to 7700 when something else has port 80.
- Software Update knows beta versions: a beta is offered its final release, and later betas.

### Fixed
- A freshly installed server no longer breaks windows: empty lists are always sent as lists.
- Pinch-zooming a photo keeps the spot under your fingers instead of jumping to the top left, and is smooth on a phone.
- Remote screens respond to taps and typing on a phone.
