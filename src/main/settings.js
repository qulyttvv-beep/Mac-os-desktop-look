// Persistent JSON settings with change notifications.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  dock: {
    autohide: true,
    magnify: true,
    size: 52,
    magnifyScale: 1.75,
    pinned: null, // filled with sensible defaults on first run
  },
  menubar: {
    reserve: true, // reserve screen space so maximized windows sit below it
    allDisplays: false, // false: the menu bar is on the main display only
    clock24: false,
    seconds: false,
    showDate: true,
    showBattery: true,
  },
  startMenu: {
    winKey: true, // the Windows key opens our Start menu instead of Windows'
    pinned: null, // app ids pinned to Start (null: derived from the Dock and common apps)
    recent: true, // show recently opened files under "Recommended"
  },
  appearance: {
    liquidGlass: true, // refractive "Liquid Glass" surfaces (dock, menus, Spotlight, widgets)
    widgetStyle: 'glass', // 'glass' | 'classic'
    snapWidgets: true, // widgets snap into a grid and avoid overlapping
  },
  wallpaper: {
    on: true, // live WebGL wallpaper behind the desktop icons
    scene: 'obsidian',
    span: false, // false: each display shows the scene (rendered once); true: one continuous scene
    quality: 'balanced', // low | balanced | high
    fps: 60, // 30 | 60 | 'max'
    audio: true, // react to music playing on the PC
    mouse: true, // react to the pointer and desktop clicks
  },
  hideTaskbar: true, // restored automatically on quit
  openAtLogin: true, // runs in the background from login (quit from the tray icon)
  // x/y null = default layout (top-right column), computed for the current screen.
  widgets: {
    clock: { on: true, x: null, y: null },
    weather: { on: true, x: null, y: null, city: '', units: 'auto' },
    calendar: { on: true, x: null, y: null },
    system: { on: true, x: null, y: null },
    notes: { on: true, x: null, y: null, text: '' },
  },
  // Internal bookkeeping (not shown in UI)
  _taskbar: { hiddenByUs: false, originalState: 2 },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.listeners = new Set();
    this.backup = this.file + '.bak';
    this.data = merge(DEFAULTS, {});
    this.saveTimer = null;
    // Never silently replace someone's settings: tolerate a BOM, fall back to the last
    // good backup, and set an unreadable file aside instead of overwriting it.
    const stored = this.read(this.file);
    if (stored) {
      this.data = merge(DEFAULTS, stored);
      try {
        fs.copyFileSync(this.file, this.backup);
      } catch {
        /* ignore */
      }
    } else if (fs.existsSync(this.file)) {
      const bak = this.read(this.backup);
      if (bak) this.data = merge(DEFAULTS, bak);
      try {
        fs.renameSync(this.file, this.file.replace(/\.json$/, `.unreadable-${Date.now()}.json`));
      } catch {
        /* ignore */
      }
    }
    // Scenes that no longer exist fall back to the default one.
    if (!['obsidian', 'gummy', 'flux', 'warp'].includes(this.data.wallpaper.scene)) this.data.wallpaper.scene = DEFAULTS.wallpaper.scene;
  }

  read(file) {
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
      const obj = JSON.parse(text);
      return isObj(obj) ? obj : null;
    } catch {
      return null;
    }
  }

  get(p) {
    if (!p) return this.data;
    return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  set(p, value) {
    const keys = p.split('.');
    let o = this.data;
    for (const k of keys.slice(0, -1)) {
      if (!isObj(o[k])) o[k] = {};
      o = o[k];
    }
    o[keys[keys.length - 1]] = value;
    this.scheduleSave();
    for (const fn of this.listeners) fn(p, value);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this.saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) {
      console.error('settings save failed', e);
    }
  }

  // Public view sent to renderers (no internal keys).
  publicView() {
    const { _taskbar, ...rest } = this.data;
    return rest;
  }
}

module.exports = { Settings, DEFAULTS };
