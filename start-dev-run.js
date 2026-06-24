const { spawn } = require('child_process');
const path = require('path');

const astroDir = path.join('H:\\开发\\个人博客', 'astro');
const astroBin = path.join(astroDir, 'node_modules', 'astro', 'bin', 'astro.mjs');
const nodeExe = process.execPath;

process.env.ASTRO_TELEMETRY_DISABLED = '1';

const child = spawn(nodeExe, [astroBin, 'dev', '--host'], {
  cwd: astroDir,
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (err) => console.error('Spawn error:', err));
child.on('exit', (code) => console.log('Child exited with code:', code));
