const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const astroDir = path.join('H:\\开发\\个人博客', 'astro');
const logFile = path.join('H:\\开发\\个人博客', 'astro-dev.log');

const out = fs.openSync(logFile, 'w');
const err = fs.openSync(logFile, 'a');

const astroBin = path.join(astroDir, 'node_modules', 'astro', 'bin', 'astro.mjs');
const nodeExe = process.execPath;

const child = spawn(nodeExe, [astroBin, 'dev', '--host'], {
  cwd: astroDir,
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  detached: true,
  stdio: ['ignore', out, err],
});

child.unref();
console.log('Dev server started with PID:', child.pid);
