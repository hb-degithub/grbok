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

const base = path.join('H:', '开发', '个人博客', 'astro', 'src');

// 1. Fix SettingsForm.tsx - Number(value) validation
fixFile(path.join(base, 'components', 'admin', 'SettingsForm.tsx'), [
  ['else if (typeof current === \'number\') { (s as Record<string, unknown>)[key] = Number(value); }',
   'else if (typeof current === \'number\') { const n = Number(value); (s as Record<string, unknown>)[key] = Number.isNaN(n) ? current : n; }'],
]);

// 2. Fix TagManager.tsx - as unknown as Tag
fixFile(path.join(base, 'components', 'admin', 'TagManager.tsx'), [
  ['setEditing({ id: \'\', name: \'\', slug: \'\', description: \'\' } as unknown as Tag)',
   'setEditing({ id: \'\', name: \'\', slug: \'\', description: \'\' })'],
]);

// 3. Fix PostManager.tsx - editing.id check (already fixed filter, now check id)
fixFile(path.join(base, 'components', 'admin', 'PostManager.tsx'), [
  ['if (editing.id) { await pb.collection(\'posts\').update(editing.id, data); }',
   'if (editing.id && editing.id.trim()) { await pb.collection(\'posts\').update(editing.id, data); }'],
]);

// 4. Fix CommentModerator.tsx - expand type assertion
fixFile(path.join(base, 'components', 'admin', 'CommentModerator.tsx'), [
  ['(comment.expand?.post_id as { title?: string } | undefined)?.title || comment.post_id',
   '((comment.expand?.post_id as unknown as { title?: string } | undefined)?.title) || comment.post_id'],
]);

// 5. Fix security.ts - sanitizeText regex improvement
fixFile(path.join(base, 'lib', 'security.ts'), [
  ['export function sanitizeText(text: string): string {\n  return text.replace(/<[^>]*>/g, \'\').trim();\n}',
   'export function sanitizeText(text: string): string {\n  // First pass: remove HTML tags\n  let cleaned = text.replace(/<[^>]*>/g, \'\');\n  // Second pass: decode common HTML entities\n  cleaned = cleaned.replace(/&lt;/g, \'<\').replace(/&gt;/g, \'>\').replace(/&amp;/g, \'&\').replace(/&quot;/g, \'"\');\n  return cleaned.trim();\n}'],
]);

console.log('MEDIUM fixes applied');
