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

// 1. Fix SettingsForm.tsx - Record<string, unknown>
fixFile(path.join(base, 'components', 'admin', 'SettingsForm.tsx'), [
  ['function setSettingValue(s: SiteSettings, key: keyof SiteSettings, value: string) {\n  const current = s[key];\n  if (typeof current === \'boolean\') { (s as Record<string, unknown>)[key] = value === \'true\' || value === true; }\n  else if (typeof current === \'number\') { const n = Number(value); (s as Record<string, unknown>)[key] = Number.isNaN(n) ? current : n; }\n  else { (s as Record<string, unknown>)[key] = value; }\n}',
   'function setSettingValue(s: SiteSettings, key: keyof SiteSettings, value: string) {\n  const current = s[key];\n  if (typeof current === \'boolean\') { (s as unknown as Record<string, unknown>)[key] = value === \'true\' || value === true; }\n  else if (typeof current === \'number\') { const n = Number(value); (s as unknown as Record<string, unknown>)[key] = Number.isNaN(n) ? current : n; }\n  else { (s as unknown as Record<string, unknown>)[key] = value; }\n}'],
]);

// 2. Fix MagicLinkForm.tsx - hardcoded route
fixFile(path.join(base, 'components', 'auth', 'MagicLinkForm.tsx'), [
  ['window.location.href = \'/admin\';',
   'window.location.href = import.meta.env.PUBLIC_ADMIN_ROUTE || \'/admin\';'],
]);

console.log('LOW fixes applied');
