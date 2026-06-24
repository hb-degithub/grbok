const fs = require('fs');
const path = require('path');

function fixFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  for (const [oldStr, newStr] of replacements) {
    if (content.includes(oldStr)) {
      content = content.replace(oldStr, newStr);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('Updated: ' + filePath);
  } else {
    console.log('No changes: ' + filePath);
  }
}

const compBase = path.join('H:', '开发', '个人博客', 'astro', 'src', 'components');

// SearchModal.tsx - enhance modal with glass-overlay and glass-strong for the modal box
fixFile(path.join(compBase, 'search', 'SearchModal.tsx'), [
  ['className="absolute inset-0 bg-space/70 backdrop-blur-sm"',
   'className="absolute inset-0 glass-overlay"'],
  ['className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-space-light shadow-2xl"',
   'className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-line glass-strong shadow-2xl"'],
]);

// AuthPage.tsx - already has holo-card, enhance it
fixFile(path.join(compBase, 'auth', 'AuthPage.tsx'), [
  ['className="holo-card relative overflow-hidden rounded-3xl p-8 sm:p-10"',
   'className="holo-card relative overflow-hidden rounded-3xl p-8 sm:p-10 glass-strong"'],
]);

console.log('Non-admin components updated');
