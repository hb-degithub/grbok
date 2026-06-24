const fs = require('fs');

const content = `const { spawn } = require('child_process');
const fs = require('fs');

const astroDir = 'H:\\\\开发\\\\个人博客\\\\astro';
const logFile = 'H:\\\\开发\\\\个人博客\\\\astro-dev.log';

const out = fs.openSync(logFile, 'w');
const err = fs.openSync(logFile, 'a');

const batchFile = 'H:\\\\开发\\\\个人博客\\\\start-dev.bat';

const child = spawn('cmd.exe', ['/c', batchFile], {
  detached: true,
  stdio: ['ignore', out, err],
});

child.unref();
console.log('Dev server started with PID:', child.pid);
`;

fs.writeFileSync('H:/开发/个人博客/start-dev-detached.js', content, 'utf8');
console.log('start-dev-detached.js rewritten');
