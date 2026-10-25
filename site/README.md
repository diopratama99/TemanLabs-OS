# TemanLabsOS website

The landing page, in English (`/`) and Indonesian (`/id/`). Built with [Astro](https://astro.build/) into static files and served by nginx in Docker.

```
site/
├─ src/i18n/        The words: en.ts and id.ts (same shape, types.ts)
├─ src/components/  Landing.astro (the page), Window, Devices, Wallpaper, AppIcon, Copy
├─ src/data/        The apps (icons and colors as in the desktop), version and links
├─ src/styles/      site.css
├─ src/lib/         icons, and page.ts (what runs in the browser)
├─ public/shots/    Screenshots, taken from TemanLabsOS itself
├─ public/demos/    Demo clips, recorded from it
└─ scripts/         shots.mjs and demos.mjs
```

## Develop

```bash
cd site
npm install
npm run dev        # http://localhost:4321
npm run build      # into dist/
```

## Screenshots

The screenshots come from the real desktop running with sample data (`npm run dev:mock` in the repository root), in both languages, at 2× and 1×. Retake them after the interface changes:

```bash
npm run shots                  # all of them (a few minutes)
npm run shots -- store files   # just these scenes
```

It starts the sample-data desktop by itself and needs Chrome or Chromium (`CHROME=/path/to/chrome` if it isn't found). Taking `hero` also redraws the social preview images (`public/og-*.png`).

## Demo clips

The clips on the page (the devices at the top, the Tour, the phone) are recorded from the sample-data desktop too, with a visible pointer, and turned into H.264 MP4 by ffmpeg:

```bash
npm run demos                         # all of them, both languages
npm run demos -- files phone          # just these
FFMPEG_REMOTE=user@server npm run demos   # no ffmpeg here: encode on another machine over ssh
```

## Run in Docker

```bash
docker compose up -d --build                      # http://<server>:3012
SITE_URL=https://example.org docker compose up -d --build
```

`SITE_URL` (optional) is the site's public address, for canonical links and social previews. `SITE_PORT` changes the port.
