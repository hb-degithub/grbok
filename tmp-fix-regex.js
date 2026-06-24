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

// Fix the regex escaping issue in both files
fixFile(path.join(base, 'components', 'admin', 'CommentModerator.tsx'), [
  ['`status = "${filter.replace(/["\\]/g, "")}"`',
   '`status = "${filter.replace(/[\"\\\\]/g, "")}"`'],
]);

fixFile(path.join(base, 'components', 'admin', 'PostManager.tsx'), [
  ['`status = "${filter.replace(/["\\]/g, "")}"`',
   '`status = "${filter.replace(/[\"\\\\]/g, "")}"`'],
]);

console.log('Regex escape fixed');
