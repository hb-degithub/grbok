const fs = require('fs');
const path = require('path');

const astroSrc = path.join('H:', '开发', '个人博客', 'astro', 'src');

function replaceInFile(filePath, map) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [oldStr, newStr] of Object.entries(map)) {
    if (content.includes(oldStr)) {
      content = content.split(oldStr).join(newStr);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('Updated: ' + filePath);
  }
}

const adminDir = path.join(astroSrc, 'components', 'admin');
const layoutDir = path.join(astroSrc, 'layouts');
const adminPageDir = path.join(astroSrc, 'pages', 'admin');

const map = {
  'holo-card': 'card',
  'glass-strong': 'card',
  'text-ink': 'text-text',
  'text-dim': 'text-text-secondary',
  'bg-space-light': 'bg-bg-soft',
  'bg-space': 'bg-bg',
  'border-line': 'border-border',
  'text-cyan': 'text-accent',
  'bg-cyan': 'bg-accent',
  'bg-cyan/10': 'bg-accent/10',
  'text-amber': 'text-warning',
  'bg-amber': 'bg-warning',
  'bg-amber/10': 'bg-warning/10',
  'text-red-400': 'text-danger',
  'bg-red-500/10': 'bg-danger/10',
  'bg-red-500/15': 'bg-danger/15',
  'text-emerald-400': 'text-success',
  'bg-emerald-500/10': 'bg-success/10',
  'bg-emerald-500/15': 'bg-success/15',
  'border-cyan': 'border-accent',
  'border-cyan/30': 'border-accent/30',
  'border-amber': 'border-warning',
  'focus:border-cyan': 'focus:border-accent',
  'focus-visible:ring-cyan/20': 'focus-visible:ring-accent/20',
  'focus-visible:ring-cyan/50': 'focus-visible:ring-accent/50',
  'bg-line/10': 'bg-bg-soft',
  'border-emerald-500/30': 'border-success/30',
  'border-amber/30': 'border-warning/30',
  'border-zinc-500/30': 'border-text-muted/30',
  'text-zinc-400': 'text-text-muted',
  'bg-zinc-500/15': 'bg-text-muted/15',
};

const files = [
  ...fs.readdirSync(adminDir).map(f => path.join(adminDir, f)),
  ...fs.readdirSync(layoutDir).map(f => path.join(layoutDir, f)),
  ...fs.readdirSync(adminPageDir).map(f => path.join(adminPageDir, f)),
];

for (const file of files) {
  if (file.endsWith('.tsx') || file.endsWith('.astro')) {
    replaceInFile(file, map);
  }
}

console.log('Admin components updated');
