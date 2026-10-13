<p align="center">
  <img src="data/logo.svg" alt="GetBox" width="88" height="88" />
</p>

<h1 align="center">GetBox</h1>

<p align="center">
  <b>An app store for Windows.</b> Find a program, click Install — GetBox takes care of the rest.<br/>
  Official installers, SHA256 checks, updates and rollback in one window.
</p>

<p align="center">
  <a href="https://github.com/IncludeSpecial/GetBox/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/IncludeSpecial/GetBox?color=66c0f4"></a>
  <a href="https://github.com/IncludeSpecial/GetBox/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/IncludeSpecial/GetBox/total"></a>
  <a href="https://github.com/IncludeSpecial/GetBox/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/IncludeSpecial/GetBox/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Windows 10/11 x64" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-0078D4">
</p>

<p align="center">
  <a href="https://github.com/IncludeSpecial/GetBox/releases/latest"><b>⬇ Download GetBox</b></a>
  &nbsp;·&nbsp; <a href="#quick-start">Quick start</a>
  &nbsp;·&nbsp; <a href="#faq">FAQ</a>
  &nbsp;·&nbsp; <a href="CHANGELOG.md">Changelog</a>
  &nbsp;·&nbsp; <a href="README.md">Русский</a>
</p>

<p align="center">
  <img src="docs/screenshots/home.webp" alt="GetBox home: featured banner, “For you” picks and install profiles" width="900" />
</p>

> The interface is available in Russian and English (switch in the title bar). Screenshots show the Russian UI.

## Why

- **Installers come from official sources** — links and checksums are taken from winget manifests, not random mirrors.
- **Files are verified before they run** — HTTPS only, and the SHA256 must match or nothing is installed.
- **Silent installs** — no wizards, no bundled “offers”.
- **Updates for everything you installed**, with one-click rollback.

## Features

- **Curated catalog** by category: browsers, games, development, media, security and more; it keeps growing.
- **All packages** — thousands of winget, Scoop and Chocolatey packages in one search. GetBox sets the package managers up itself on first launch.
- **Updates tab** — update one or all, see the history by day and roll back to the previous version.
- **Install profiles** (Gaming Rig, Dev Starter, Essentials…), a “For you” feed, “Often installed together” and “Alternatives”.
- **Install queue** with progress, cancel, retry and readable errors.
- **Appearance** — five themes (including Windows 11 with Mica), custom accent color, 90–125 % scale and four list views.
- **Self-update** (1.3.0+) — downloads in the background, verifies SHA256, then shows “What's new”.

<p align="center">
  <img src="docs/screenshots/themes.webp" alt="Themes: Classic, Light, OLED, High contrast, Windows 11" width="900" /><br/>
  <sub>Classic · Light · OLED · High contrast · Windows 11</sub>
</p>

## Quick start

1. Download **`GetBox-<version>-portable.exe`** from the [latest release](https://github.com/IncludeSpecial/GetBox/releases/latest).
2. Run it. Nothing to install — it is a portable app; keep it anywhere.
3. If Windows shows **“Windows protected your PC”**, click **More info → Run anyway**. SmartScreen warns about new apps without a paid code-signing certificate; you can verify the file with its checksum (see [FAQ](#faq)).
4. The catalog opens right away. winget and Scoop are set up in the background — watch the status in the bottom-left corner.
5. Chocolatey is optional: **Allow install** (one UAC prompt) or **Skip**.

**Requirements:** Windows 10 or 11 (x64) and an internet connection. GetBox itself does not need administrator rights.

## Using GetBox

- **Install** — search at the top or browse the catalog and click **Install**. Click several programs at once: they line up in the **Queue** (top right).
- **Install a set** — pick an install profile on the home page; it queues everything you don't have yet. Star programs to add them to favorites and tune the “For you” feed.
- **Find anything else** — **All packages** searches winget, Scoop and Chocolatey together.
- **Update** — the **Updates** tab lists outdated programs from every manager. **Update all**, or roll back from the history. Turn on checks at launch / every 6 hours and silent background updates on the right.
- **Appearance** — **Advanced → Appearance**: theme, accent, scale, list view.
- **Updating GetBox** — when a new version is ready, an **Update to X** button appears in the title bar: restart now or update on exit. Channel (Stable / Beta) lives in **Advanced → GetBox**. Moving from 1.2.x to 1.3.0 is a one-time manual step: replace the old exe with the new one; settings are kept.

<p align="center"><img src="docs/screenshots/updates.webp" alt="Updates tab with history and rollback" width="760" /></p>

## FAQ

<details>
<summary><b>Is it safe? Where do programs come from?</b></summary>

Catalog programs are downloaded from the publishers' direct links listed in the official winget index (the same source `winget install` uses). GetBox downloads over HTTPS only and checks the SHA256 from the manifest before running the installer; on any mismatch it falls back to winget. Packages from “All packages” are installed by winget, Scoop and Chocolatey with their own checks.
</details>

<details>
<summary><b>How do I verify the download?</b></summary>

Each release ships a `.sha256` file next to the exe. Compare it with:

```powershell
Get-FileHash .\GetBox-1.3.0-portable.exe -Algorithm SHA256
```
</details>

<details>
<summary><b>Do I need administrator rights?</b></summary>

No. Don't run GetBox elevated all the time — the Scoop installer refuses to work in an elevated session. Individual installers ask for UAC when they need it; Chocolatey asks once when you enable it.
</details>

<details>
<summary><b>Where is data stored and how do I uninstall?</b></summary>

Everything is in `%LOCALAPPDATA%\GetBox\`. To remove GetBox completely, close it and delete the exe and that folder. Programs you installed stay; remove them in Settings → Apps as usual.
</details>

## Feedback and development

- Bugs and catalog requests — [open an issue](https://github.com/IncludeSpecial/GetBox/issues/new).
- Changes — [CHANGELOG.md](CHANGELOG.md) and [Releases](https://github.com/IncludeSpecial/GetBox/releases).
- Building from source and adding programs — [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (Russian).
