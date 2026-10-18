# Mac Desktop

A macOS-style desktop shell for Windows 11: a menu bar with a clock on top, a magnifying
auto-hide Dock at the bottom, desktop widgets, Spotlight, Launchpad, a Start menu and live
wallpapers.

## Install

1. Download **`Mac-Desktop-Setup-x.y.z.exe`** from the [Releases](../../releases/latest) page.
2. Run it. It installs for your user only (no admin rights needed), adds Desktop and Start
   menu shortcuts and starts the app.

Mac Desktop then runs in the background and starts with Windows. To quit it (which also
brings the Windows taskbar back), click the ✦ logo in the menu bar → **Quit Mac Desktop**,
or use the button at the bottom of *Desktop Settings*. Turn off starting with Windows in
**Desktop Settings → Open Mac Desktop at login**.
Uninstall from *Settings → Apps → Installed apps*.

The installer isn't code-signed, so Windows SmartScreen may warn the first time:
click *More info → Run anyway*.

## Build from source

- Run: `npm install`, then `npm start` (quit with `npm run stop`).
- Installer: `npm run dist` → `release\Mac-Desktop-Setup-<version>.exe`.
- Unpacked app only: `npm run package` → `dist\Mac Desktop-win32-x64\Mac Desktop.exe`.

## What's in it

| Part | What it does |
| --- | --- |
| **Multiple monitors** | Works with 2, 3 or more displays automatically: a menu bar on every display (each with its own reserved strip), the Dock follows you to whichever display you push the pointer against the bottom edge of (when hiding is on), widgets can be dragged to and snap on any display, Spotlight/Launchpad/menus open on the display you're using, and the live wallpaper is one seamless picture across all displays. |
| **Menu bar** | On the main display (or on every display, in Desktop Settings). App menu (sleep, restart, lock, About This PC), name of the active app, working File/Edit/View/Window/Help menus (they send the real shortcuts to the app), Finder "Go" menu, Wi-Fi/Ethernet, battery (laptops), Spotlight, Control Center, clock + calendar. Matches the wallpaper's brightness, hides for fullscreen games/videos, and reserves space so maximized windows sit below it; a window dragged or opened under it is moved just below, so its title bar and minimize / maximize / close buttons always stay reachable. |
| **Dock** | When always shown it reserves its strip like the Windows taskbar, so maximized and snapped windows stop above it. Click an app that is in front to minimize all its windows, click again to bring them back. Magnification, slides up when the pointer touches the bottom edge and back down when it leaves, bounce on launch, dots under running apps, running apps appear automatically, window list + Keep in Dock / Quit on right-click, drag to reorder, Downloads + Trash. |
| **Live wallpaper** | WebGL scenes rendered *behind the desktop icons* on every monitor — rendered once and shown on each display (light on the GPU), or optionally as one continuous scene across all of them — finished like a photograph (depth of field, bloom, film grain): **Obsidian** (black liquid in a photo studio, seen in perspective: ripples under your cursor, and drops that fall in, throw up a jet and splash back when you click the desktop or the music hits) and **Gummy Bears** (translucent jelly bears scattered along one long glossy black table that runs across all your monitors — panoramic camera, nobody sitting on a bezel — standing, lying, on their sides, casting coloured shadows; they wobble when you brush them, hop when clicked and bounce to the beat) and **Flux** (generative art: a couple of hundred thousand glowing particles carried by an ever-changing flow field across all monitors; a new random piece melts in every half minute — 13 kinds of flow (currents, galaxies, ribbons, petals, magnetic field lines, circuit traces, starbursts, curtains, glowing shapes, ring bands, an infinity loop, zigzag lightning, pulsing rings), many built around each monitor so every screen has its own centrepiece with streams running between them, in vivid or two-colour palettes where each monitor can wear its own colour; stir it with the pointer, click for a shockwave, the beat fires bursts) and **Warp** (the bridge of a starship at warp: tens of thousands of streaking stars with parallax, the warp-field glow, subspace ripples and nebula gas; every minute or two — or when you click — it drops out of warp beside a planet and then engages again with a stretch, a flash and a shockwave; the main display is the viewscreen and the others are side viewports; the pointer steers). They react to the mouse, to clicks on the desktop and to music playing on the PC (analysed locally, never recorded). A display pauses automatically while a window covers it, and the whole wallpaper stops while a fullscreen game or video is in front. Pick one in *Wallpaper…* (Apple menu, Control Center, Spotlight or the tray) or run `"Mac Desktop.exe" --scene=gummy`. |
| **Liquid Glass** | macOS Tahoe-style glass on the Dock, menus, Control Center, Spotlight and widgets, rendered live on the GPU: the moving wallpaper is refracted in real time along the rounded edges (with a hint of colour dispersion), with a lit specular rim and a highlight that follows the pointer. The menu bar goes transparent. Toggle in *Desktop Settings → Appearance*. |
| **Widgets** | Analog clock, weather (Open-Meteo, location guessed from your time zone), calendar, CPU/RAM/disk monitor, sticky note. Drag them anywhere: they lift while dragging and snap into a grid on release, moving to the nearest free spot instead of overlapping. Right-click for *Arrange Widgets*, *Snap to Grid* and *Style* (Liquid Glass / Classic). They stay on the desktop behind your windows. |
| **Start menu** | Press the **Windows key** (or pick *Start Menu* in the Apple menu, Spotlight or the tray): a search box that finds apps, Windows settings pages, recent files and the web as you type (arrow keys + Enter), pinned apps (drag to reorder, scroll for more pages), *Recommended* — the files you opened recently (can be hidden in Desktop Settings) — and *All apps* A–Z with a letter index. Your account, Documents / Downloads / Pictures, Settings and a power menu (Lock, Sleep, Sign out, Restart, Shut down) sit along the bottom. Right-click an app to pin it, move it to the front or add it to the Dock. Win+shortcuts (Win+E, Win+L…) keep working. Can be turned off in Desktop Settings. |
| **Spotlight** | `Alt+Space`: apps, settings pages, folders, power actions, a calculator (`12*(3+4)`) and web search. |
| **Launchpad** | Full-screen app grid with pages and search. Right-click an app to add it to the Dock. |
| **Control Center** | Network, real Bluetooth on/off, Dark Mode, brightness for monitors that support DDC/CI, volume with output-device switching, per-app volume mixer, microphone level and input switching (when a mic is present), Now Playing with title/artist/album art and real play/pause/skip, plus quick toggles for Dock hiding, the Windows taskbar, widgets and the live wallpaper. |

## The Windows taskbar

By default Mac Desktop hides the Windows taskbar so the Dock replaces it. It is put back
exactly as it was when you quit (menu → *Quit Mac Desktop*, the tray icon, or `npm run stop`).
Toggle it in Control Center or Desktop Settings.

If the app is ever force-killed while the taskbar is hidden, just start Mac Desktop again and quit
it, or restart Windows Explorer from Task Manager.

## Files

```
src/main/      main process: windows, settings, Win32 bindings (koffi), app index, system info
src/helper/    PowerShell helper: volume, 256px app icons, Start-menu app list, Windows-key hook,
               music levels for the wallpaper (WASAPI loopback)
src/renderer/  menubar, popup (menus/Control Center/settings), dock, widgets, spotlight, launchpad,
               start (Start menu), wallpaper (WebGL scenes)
scripts/       dev launcher and icon generator
```

Settings live in `%APPDATA%\Mac Desktop\settings.json`.
