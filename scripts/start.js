// Launches the app with a clean environment. VS Code (and other Electron-based
// tools) export ELECTRON_RUN_AS_NODE=1 to child processes, which would make
// Electron behave like plain Node and crash on startup.
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const detached = process.argv.includes('--detach');
const args = [path.join(__dirname, '..'), ...process.argv.slice(2).filter((a) => a !== '--detach')];
const child = spawn(electron, args, {
  env,
  stdio: detached ? 'ignore' : 'inherit',
  detached,
  windowsHide: false,
});
if (detached) child.unref();
else child.on('exit', (code) => process.exit(code || 0));
