const fs = require('fs');
const base = 'H:/开发/个人博客';
const files = [
  'astro/src/components/layout/Header.tsx',
  'astro/src/components/auth/AuthPage.tsx',
  'astro/src/components/posts/PostCard.tsx',
  'astro/src/components/posts/PostList.tsx',
  'astro/src/components/search/SearchModal.tsx',
];

function fixFile(file) {
  const currentPath = `${base}/${file}`;
  const originalPath = `${base}/original-${file.replace(/\//g, '_')}`;
  let current = fs.readFileSync(currentPath, 'utf8');
  const original = fs.readFileSync(originalPath, 'utf8');

  const lines = current.split(/\r?\n/);
  let changed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/[\u4e00-\u9fff]/.test(line)) continue;
    // skip lines with ternary operators or complex expressions
    if (/\?\s*['"`]/.test(line) || /\?\s*\w/.test(line)) continue;

    const parts = line.split(/([\u4e00-\u9fff]+)/);
    let pattern = '';
    let hasChinese = false;
    for (const part of parts) {
      if (/[\u4e00-\u9fff]+/.test(part)) {
        pattern += '(.*?)';
        hasChinese = true;
      } else {
        pattern += part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
    }
    if (!hasChinese) continue;

    const regex = new RegExp(pattern, 'g');
    const matches = [...original.matchAll(regex)];
    if (matches.length === 1) {
      const match = matches[0];
      let captureIdx = 1;
      const newLine = parts.map(part => {
        if (/[\u4e00-\u9fff]+/.test(part)) {
          return match[captureIdx++];
        }
        return part;
      }).join('');

      if (newLine !== line) {
        lines[i] = newLine;
        changed++;
      }
    }
  }

  fs.writeFileSync(currentPath, lines.join('\n'), 'utf8');
  console.log(`context-fixed ${file}, ${changed} lines changed`);
}

for (const file of files) {
  fixFile(file);
}

// Specific fixes for remaining placeholders
let pl = fs.readFileSync(`${base}/astro/src/components/posts/PostList.tsx`, 'utf8');
pl = pl.replace('aria-label={`? ${page} ?`}', 'aria-label={`第 ${page} 页`}');
fs.writeFileSync(`${base}/astro/src/components/posts/PostList.tsx`, pl, 'utf8');

let sm = fs.readFileSync(`${base}/astro/src/components/search/SearchModal.tsx`, 'utf8');
sm = sm.replace('          ?K', '          ⌘K');
sm = sm.replace('<span>? 动态加载</span>', '<span>↻ 动态加载</span>');
fs.writeFileSync(`${base}/astro/src/components/search/SearchModal.tsx`, sm, 'utf8');

// Fix PostCard aria-label that generic picked from comment
let pc = fs.readFileSync(`${base}/astro/src/components/posts/PostCard.tsx`, 'utf8');
pc = pc.replace('aria-label={`文章卡片组件${post.title}`}', 'aria-label={`阅读文章：${post.title}`}');
fs.writeFileSync(`${base}/astro/src/components/posts/PostCard.tsx`, pc, 'utf8');

console.log('specific placeholders fixed');