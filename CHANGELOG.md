# Changelog

What changed in each release of TemanLabsOS. The release workflow puts a version's section on its GitHub release page, so write it before pushing the tag: a heading `## <tag>` (exactly the tag, e.g. `## v0.4.0`), then its notes.

Versions with `-beta` are released like any other (the installer and Software Update offer them); the final version of the same number is offered after its beta.

## v0.6.0-beta

### New
- Network › Speed Test: the internet's download and upload speed, ping and jitter, by hand or on a schedule (every 15 minutes to once a day), kept for 180 days. It's tested with Cloudflare (built in) or Ookla's Speedtest (installed in one click once its terms are accepted; each result gets a speedtest.net link to show the ISP, and the ping while the line is busy). See the speeds over time against your plan's, the typical and slowest speeds, how many tests fell under 80% of the plan, and the hours of the day the line slows down. The results export as CSV, and the settings show how much data a schedule uses a day and a month.
- Drives plugged in over USB show on the desktop beside DATA while they're mounted: open one, see its info, or eject it.

### Changed
- Fewer apps, with nothing taken away:
  - **Network** holds Routers, Speed Test and Network Tools, with an overview of the internet, its speed, the routers and the server's addresses.
  - **Downloader** has a Live Streams tab for what Live Recorder did.
  - **Settings › Software Update** lists the system's packages too (System Updates).
  - **System Monitor** has a Logs tab (Log Viewer).
  - **Terminal** opens Commands in a panel beside the shell.
  - The old names still find them in Quick Search and the Launcher, and old Dock pins and recent apps point to where they went.

### Fixed
- Files' sidebar picks up a drive plugged in while it's open.
- Live recordings from Kick (and other sites that send metadata with the stream) are saved as MP4 again instead of being kept as .ts; ones already kept as .ts are turned into MP4 when the server starts.
- The tabs in a window's toolbar (Downloader's) sit in the middle of the window at its usual size.

## v0.5.0-beta

### New
- Code shows files and folders with VS Code's most used icon theme (Material Icon Theme): Dart, LICENSE, JSON, Markdown, .env, Dockerfile, package.json, src, node_modules and some 1,200 more, with light-theme variants. Files are recognized the way VS Code does it (whole name first, then extensions such as .d.ts), and many more languages open with highlighting: Dart, Kotlin, Swift, C#, PowerShell, Terraform, GraphQL and others.
- An Extensions view in Code with built-in versions of popular extensions, each with a switch: Prettier (and format on save), inline errors, rename paired tags, TODO highlight, rainbow indents, path completion, color swatches, Markdown and HTML preview beside the file, bracket pair colors and sticky scroll.
- Code's layout can be adjusted like VS Code's: drag the sidebar's edge (drag it narrow to close it), drag the terminal's top, hide the minimap or turn on word wrap from the buttons at the top right, drag tabs to reorder them, and zoom the text with Ctrl (⌘) + scroll or a pinch.
- Code's title bar works like VS Code's: Back and Forward through the files you've looked at (also Alt + ← / →), the workspace's name in the middle to go to a file, and buttons to show or hide the sidebar, the terminal and the preview. The editor's buttons sit at the end of the tabs (with a … menu), double-clicking beside the tabs makes a new file, and the path above the file starts at the workspace folder: a folder in it shows in the Explorer, the file's name opens Go to Symbol.

### Changed
- The status bar shows the open file's real indentation and line endings.
- A setup guide in Devices for each system: Windows Pro, Home and on ARM; newer and older Macs (Intel and M-series); Ubuntu, Linux Mint, Debian, Arch and Fedora, with the commands to copy. It shows before the first device is added, from Setup Guide, and in Add Device (where Use this picks the right screen-sharing method).
- Remote screens of computers with several screens show one screen at a time: Screen 1 to begin with, another or all of them from the top of the window (with a warning about the bigger picture). The screens are found from the picture's size, or set by hand.
- The guide says how to make a computer share just one screen (lighter for the server and the connection), and what the server needs for smooth remote screens.

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
