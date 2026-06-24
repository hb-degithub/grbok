const fs = require('fs');
const path = require('path');

const issues = [];

function addIssue(file, line, severity, desc, fix) {
  issues.push({ file, line, severity, desc, fix });
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

const base = path.join('H:', '开发', '个人博客', 'astro', 'src');

// 1. pocketbase.ts
const pb = readFile(path.join(base, 'lib', 'pocketbase.ts'));
if (pb) {
  if (pb.includes('as unknown as')) addIssue('lib/pocketbase.ts', null, 'MEDIUM', '使用 as unknown as 类型断言', '使用更精确的类型');
}

// 2. useAdminAuth.ts
const adminAuth = readFile(path.join(base, 'hooks', 'useAdminAuth.ts'));
if (adminAuth) {
  if (adminAuth.includes('as unknown as User')) addIssue('hooks/useAdminAuth.ts', null, 'MEDIUM', 'pb.authStore.record as unknown as User - PocketBase 类型不匹配', '使用类型守卫或扩展 PocketBase RecordModel');
  if (!adminAuth.includes('return () =>')) addIssue('hooks/useAdminAuth.ts', null, 'LOW', 'authStore.onChange 可能缺少清理', '在 useEffect cleanup 中取消订阅');
}

// 3. usePocketBase.ts
const usePB = readFile(path.join(base, 'hooks', 'usePocketBase.ts'));
if (usePB) {
  if (usePB.includes('getPosts')) {
    // Check for missing dependency in useCallback
    if (usePB.match(/useCallback\(.*\[pb\]/)) addIssue('hooks/usePocketBase.ts', null, 'LOW', 'useCallback 依赖 pb 但 pb 是每次调用新实例', 'getPocketBase() 在每次渲染都调用，应使用 useMemo 或 ref');
  }
}

// 4. useComments.ts
const useComments = readFile(path.join(base, 'hooks', 'useComments.ts'));
if (useComments) {
  if (useComments.includes('setComments(buildCommentTree(result))')) {
    // buildCommentTree is recreated on every render but in useCallback
  }
}

// 5. PostLayout.astro
const postLayout = readFile(path.join(base, 'layouts', 'PostLayout.astro'));
if (postLayout) {
  if (postLayout.includes('set:html={sanitizedContent}')) {
    if (postLayout.includes('typeof sanitizeHtml === \'function\'')) {
      addIssue('layouts/PostLayout.astro', null, 'HIGH', 'sanitizeHtml 在 SSR 环境下返回原始 HTML（DOMPurify 需要 DOM）', '使用 isomorphic-dompurify 或服务器端 sanitization');
    }
  }
  if (postLayout.includes('author.name.charAt(0)')) {
    addIssue('layouts/PostLayout.astro', null, 'MEDIUM', 'author.name 可能为 undefined，charAt(0) 会报错', '使用 author.name?.charAt(0) || "?"');
  }
}

// 6. PostManager.tsx
const postMgr = readFile(path.join(base, 'components', 'admin', 'PostManager.tsx'));
if (postMgr) {
  if (postMgr.includes('as unknown as Post')) addIssue('components/admin/PostManager.tsx', null, 'MEDIUM', 'as unknown as Post 类型断言', '定义 PostDraft 类型');
  if (postMgr.includes('editing.id ?')) {
    addIssue('components/admin/PostManager.tsx', null, 'MEDIUM', '编辑时 editing.id 可能为空字符串而非 undefined', '检查 id 的真值而非存在性');
  }
}

// 7. SettingsForm.tsx
const settings = readFile(path.join(base, 'components', 'admin', 'SettingsForm.tsx'));
if (settings) {
  if (settings.includes('as Record<string, unknown>')) addIssue('components/admin/SettingsForm.tsx', null, 'LOW', '使用 Record<string, unknown> 绕过类型检查', '使用正确的类型定义');
  if (settings.includes('Number(value)')) addIssue('components/admin/SettingsForm.tsx', null, 'MEDIUM', 'Number(value) 对空字符串返回 0，对无效字符串返回 NaN', '使用 parseInt 并验证');
}

// 8. CommentModerator.tsx
const mod = readFile(path.join(base, 'components', 'admin', 'CommentModerator.tsx'));
if (mod) {
  if (mod.includes('as { title?: string }')) addIssue('components/admin/CommentModerator.tsx', null, 'LOW', '类型断言过于宽泛', '使用正确的 expand 类型');
}

// 9. TagManager.tsx
const tagMgr = readFile(path.join(base, 'components', 'admin', 'TagManager.tsx'));
if (tagMgr) {
  if (tagMgr.includes('as unknown as Tag')) addIssue('components/admin/TagManager.tsx', null, 'MEDIUM', 'as unknown as Tag 类型断言', '定义 TagDraft 类型');
}

// 10. MagicLinkForm.tsx
const magic = readFile(path.join(base, 'components', 'auth', 'MagicLinkForm.tsx'));
if (magic) {
  if (magic.includes('window.location.href = \'/admin\'')) addIssue('components/auth/MagicLinkForm.tsx', null, 'LOW', '硬编码跳转路径', '使用配置化的路由');
}

// 11. SearchModal.tsx
const search = readFile(path.join(base, 'components', 'search', 'SearchModal.tsx'));
if (search) {
  if (search.includes('dangerouslySetInnerHTML')) {
    addIssue('components/search/SearchModal.tsx', null, 'MEDIUM', 'dangerouslySetInnerHTML 使用 DOMPurify 但需确认配置足够严格', '确认 ALLOWED_TAGS 和 ALLOWED_ATTR 限制足够');
  }
}

// 12. CursorGlow.tsx
const cursor = readFile(path.join(base, 'components', 'effects', 'CursorGlow.tsx'));
if (cursor) {
  if (cursor.includes('isVisible')) {
    addIssue('components/effects/CursorGlow.tsx', null, 'LOW', 'isVisible 在 useEffect 依赖数组中会导致频繁重新绑定事件', '使用 ref 而非 state 来跟踪可见性');
  }
}

// 13. Starfield.tsx
const star = readFile(path.join(base, 'components', 'effects', 'Starfield.tsx'));
if (star) {
  if (!star.includes('cancelAnimationFrame')) addIssue('components/effects/Starfield.tsx', null, 'HIGH', '缺少 cleanup 取消动画帧', '已在 cleanup 中 cancelAnimationFrame - OK');
}

// 14. Check for .env files
const envLocal = readFile(path.join('H:', '开发', '个人博客', '.env.local'));
if (envLocal) {
  if (envLocal.includes('PB_ENCRYPTION_KEY')) addIssue('.env.local', null, 'HIGH', '包含测试加密密钥，不应提交到版本控制', '添加到 .gitignore 并生成新的生产密钥');
}

// 15. Check Caddyfile
const caddy = readFile(path.join('H:', '开发', '个人博客', 'Caddyfile'));
if (caddy) {
  if (caddy.includes('{$ADMIN_IP}')) {
    // OK
  }
}

// 16. Check pb_hooks
const pbHook = readFile(path.join('H:', '开发', '个人博客', 'pb_hooks', 'send_email_comment.pb.js'));
if (pbHook) {
  if (pbHook.includes('escapeHtml')) {
    // Check if it handles all cases
  }
}

// 17. security.ts
const sec = readFile(path.join(base, 'lib', 'security.ts'));
if (sec) {
  if (sec.includes('typeof window === \'undefined\'')) {
    addIssue('lib/security.ts', null, 'HIGH', 'sanitizeHtml 在 SSR 时返回原始 HTML，存在 XSS 风险', '使用 isomorphic-dompurify 或服务器端库');
  }
  if (sec.includes('replace(/<[^>]*>/g, \'\')')) {
    addIssue('lib/security.ts', null, 'MEDIUM', 'sanitizeText 使用正则去除 HTML 标签，可能被绕过', '使用更健壮的 HTML 解析器或 DOMPurify');
  }
}

// 18. Check for potential SQL injection in filter strings
const files = [
  'hooks/usePocketBase.ts',
  'hooks/useComments.ts',
  'components/admin/PostManager.tsx',
  'components/admin/CommentModerator.tsx',
  'components/admin/TagManager.tsx',
  'components/admin/UserManager.tsx',
];
for (const f of files) {
  const content = readFile(path.join(base, f));
  if (content) {
    // Check for string interpolation in filter
    const matches = content.match(/filter.*\+.*\+/g);
    if (matches) {
      addIssue(f, null, 'HIGH', 'PocketBase filter 使用字符串拼接，可能存在注入风险', '使用参数化查询或严格转义用户输入');
    }
  }
}

// Output
console.log('=== Bug Scan Report ===\n');
if (issues.length === 0) {
  console.log('No issues found.');
} else {
  for (const issue of issues) {
    console.log(`[${issue.severity}] ${issue.file}`);
    console.log(`  ${issue.desc}`);
    console.log(`  Fix: ${issue.fix}`);
    console.log();
  }
  console.log(`Total: ${issues.length} issues`);
}
