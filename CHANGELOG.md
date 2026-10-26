# Changelog

What changed in each release of TemanLabsOS. The release workflow puts a version's section on its GitHub release page, so write it before pushing the tag: a heading `## <tag>` (exactly the tag, e.g. `## v0.4.0`), then its notes.

Versions with `-beta` are released like any other (the installer and Software Update offer them); the final version of the same number is offered after its beta.

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
