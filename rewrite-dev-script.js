const fs = require('fs');
const path = require('path');

const content = `const { spawn } = require('child_process');
const fs = require('fs');

const astroDir = 'H:\\\\开发\\\\个人博客\\\\astro';
const logFile = 'H:\\\\开发\\\\个人博客\\\\astro-dev.log';

const out = fs.openSync(logFile, 'w');
const err = fs.openSync(logFile, 'a');

const npmCmd = process.platform === 'win32' ? 'C:\\\\Program Files\\\\nodejs\\\\npm.cmd' : 'npm';

const child = spawn(npmCmd, ['run', 'dev', '--', '--host'], {
  cwd: astroDir,
  env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  detached: true,
  stdio: ['ignore', out, err],
});

child.unref();
console.log('Dev server started with PID:', child.pid);
`;

fs.writeFileSync(path.join('H:/开发/个人博客', 'start-dev-detached.js'), content, 'utf8');
console.log('start-dev-detached.js rewritten');
