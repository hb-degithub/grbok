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

// 1. Fix PostLayout.astro - author.name?.charAt(0)
fixFile(path.join(base, 'layouts', 'PostLayout.astro'), [
  ['{author.name.charAt(0)}', '{author.name?.charAt(0) || "?"}'],
]);

// 2. Fix PostManager.tsx - filter injection risk
fixFile(path.join(base, 'components', 'admin', 'PostManager.tsx'), [
  // Escape filter values
  ['const f = filter === \'all\' ? \'\' : \'status = "\' + filter + \'"\';', 
   'const f = filter === \'all\' ? \'\' : `status = "${filter.replace(/["\\]/g, "")}"`;'],
]);

// 3. Fix CommentModerator.tsx - filter injection risk
fixFile(path.join(base, 'components', 'admin', 'CommentModerator.tsx'), [
  ['const f = filter === \'all\' ? \'\' : \'status = "\' + filter + \'"\';',
   'const f = filter === \'all\' ? \'\' : `status = "${filter.replace(/["\\]/g, "")}"`;'],
]);

// 4. Fix useAdminAuth.ts - cleanup authStore.onChange
fixFile(path.join(base, 'hooks', 'useAdminAuth.ts'), [
  ['  useEffect(() => {\n    const pb = getPocketBase();\n    if (pb.authStore.isValid && pb.authStore.record) {\n      setUser(pb.authStore.record as unknown as User);\n    }\n    pb.authStore.onChange(() => {\n      if (pb.authStore.isValid && pb.authStore.record) {\n        setUser(pb.authStore.record as unknown as User);\n      } else {\n        setUser(null);\n      }\n    });\n    setIsLoading(false);\n  }, []);',
   '  useEffect(() => {\n    const pb = getPocketBase();\n    if (pb.authStore.isValid && pb.authStore.record) {\n      setUser(pb.authStore.record as unknown as User);\n    }\n    const unsubscribe = pb.authStore.onChange(() => {\n      if (pb.authStore.isValid && pb.authStore.record) {\n        setUser(pb.authStore.record as unknown as User);\n      } else {\n        setUser(null);\n      }\n    });\n    setIsLoading(false);\n    return () => { unsubscribe?.(); };\n  }, []);'],
]);

// 5. Fix CursorGlow.tsx - use ref for isVisible
fixFile(path.join(base, 'components', 'effects', 'CursorGlow.tsx'), [
  ['  const [isVisible, setIsVisible] = useState(false);',
   '  const isVisibleRef = useRef(false);\n  const [isVisible, setIsVisible] = useState(false);'],
  ['      if (!isVisible) setIsVisible(true);',
   '      if (!isVisibleRef.current) { isVisibleRef.current = true; setIsVisible(true); }'],
  ['    const handleMouseLeave = () => {\n      setIsVisible(false);\n    };',
   '    const handleMouseLeave = () => {\n      isVisibleRef.current = false;\n      setIsVisible(false);\n    };'],
]);

console.log('HIGH fixes applied');
