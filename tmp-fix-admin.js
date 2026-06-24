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

const base = path.join('H:', '开发', '个人博客', 'astro', 'src', 'components', 'admin');

// AdminGuard.tsx - loading and error panels add glass
fixFile(path.join(base, 'AdminGuard.tsx'), [
  // Loading panel - add glass-strong
  ['<div className="flex min-h-screen items-center justify-center bg-space">\n      <div className="text-center">\n        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-cyan" />\n        <p className="font-mono text-xs uppercase tracking-widest text-dim">Authenticating...</p>\n      </div>\n    </div>',
     '<div className="flex min-h-screen items-center justify-center bg-space">\n      <div className="glass-strong rounded-2xl p-10 text-center">\n        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-cyan" />\n        <p className="font-mono text-xs uppercase tracking-widest text-dim">Authenticating...</p>\n      </div>\n    </div>'],
  // Not auth panel
  ['<div className="holo-card max-w-md p-8 text-center">\n        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15">',
   '<div className="glass-strong max-w-md rounded-2xl p-8 text-center">\n        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15">'],
  // Permission panel
  ['<div className="holo-card max-w-md p-8 text-center">\n        <h2 className="mb-2 text-xl font-bold text-ink">Insufficient Permissions</h2>',
   '<div className="glass-strong max-w-md rounded-2xl p-8 text-center">\n        <h2 className="mb-2 text-xl font-bold text-ink">Insufficient Permissions</h2>'],
]);

// SettingsForm.tsx - wrap in glass panel
fixFile(path.join(base, 'SettingsForm.tsx'), [
  ['<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">',
   '<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="holo-card rounded-2xl p-6 sm:p-8 space-y-6">'],
]);

// PostManager.tsx - enhance modal overlay
fixFile(path.join(base, 'PostManager.tsx'), [
  ['className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-space/80 backdrop-blur-sm pt-20 pb-10"',
   'className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto glass-overlay pt-20 pb-10"'],
]);

// TagManager.tsx - enhance modal overlay
fixFile(path.join(base, 'TagManager.tsx'), [
  ['className="fixed inset-0 z-50 flex items-center justify-center bg-space/80 backdrop-blur-sm"',
   'className="fixed inset-0 z-50 flex items-center justify-center glass-overlay"'],
]);

// CommentModerator.tsx - already has holo-card, add glass-strong to empty state
fixFile(path.join(base, 'CommentModerator.tsx'), [
  ['<div className="holo-card rounded-xl p-12 text-center text-dim">No comments found.</div>',
   '<div className="glass-strong rounded-xl p-12 text-center text-dim">No comments found.</div>'],
]);

console.log('All admin components updated');
