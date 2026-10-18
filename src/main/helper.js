// Client for the long-running PowerShell helper (src/helper/host.ps1).
const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

class Helper {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = null;
    this.stopped = false;
    this.onEvent = null; // unsolicited events from the helper (e.g. 'winkey')
    this.sticky = new Map(); // switches (keyboard hook, audio loopback) replayed after a restart
    this.restarts = 0;
  }

  start() {
    if (this.ready) return this.ready;
    const script = path.join(__dirname, '..', 'helper', 'host.ps1');
    this.ready = new Promise((resolve) => {
      this.proc = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const rl = readline.createInterface({ input: this.proc.stdout });
      rl.on('line', (line) => {
        let msg;
        try {
          msg = JSON.parse(line.replace(/^﻿/, ''));
        } catch {
          return;
        }
        if (msg.ready) {
          resolve(true);
          // a restarted helper gets its switches back
          for (const [cmd, args] of this.sticky) this.call(cmd, args).catch(() => {});
          return;
        }
        if (msg.event) {
          if (this.onEvent) this.onEvent(msg.event, msg);
          return;
        }
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.data);
        else p.reject(new Error(msg.error || 'helper error'));
      });
      this.proc.stderr.on('data', (d) => console.warn('[helper]', String(d).trim()));
      this.proc.on('exit', (code) => {
        resolve(false);
        for (const p of this.pending.values()) p.reject(new Error('helper exited'));
        this.pending.clear();
        this.proc = null;
        this.ready = null;
        if (this.stopped) return;
        console.warn('[helper] exited with', code);
        // the Windows key and music reactivity live in the helper: bring it back
        if (this.restarts++ < 5) setTimeout(() => !this.stopped && this.start(), 2000 * this.restarts);
      });
    });
    return this.ready;
  }

  async call(cmd, args = {}, timeoutMs = 60000) {
    if (cmd === 'keys.enable' || cmd === 'audio.listen') this.sticky.set(cmd, args);
    const ok = await this.start();
    if (!ok || !this.proc) throw new Error('helper unavailable');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`helper timeout: ${cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, args }) + '\n');
    });
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      try {
        this.proc.stdin.end();
        this.proc.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = new Helper();
