const fs = require('fs');
const { execSync } = require('child_process');

const base = 'H:/开发/个人博客';
const files = [
  'astro/src/pages/index.astro',
  'astro/src/components/auth/AuthPage.tsx',
  'astro/src/components/layout/Header.tsx',
  'astro/src/components/posts/PostCard.tsx',
  'astro/src/components/posts/PostList.tsx',
  'astro/src/components/search/SearchModal.tsx',
];

// Save originals if not already saved
for (const file of files) {
  const out = `${base}/original-${file.replace(/\//g, '_')}`;
  if (!fs.existsSync(out)) {
    const buf = execSync(`git show HEAD:${file}`, { cwd: base });
    fs.writeFileSync(out, buf);
  }
}

function fixGeneric(file) {
  const currentPath = `${base}/${file}`;
  const originalPath = `${base}/original-${file.replace(/\//g, '_')}`;
  const current = fs.readFileSync(currentPath, 'utf8');
  const original = fs.readFileSync(originalPath, 'utf8');

  const originalSegments = [];
  const regex = /[^\x00-\x7F]+/g;
  let m;
  while ((m = regex.exec(original)) !== null) {
    originalSegments.push(m[0]);
  }

  let idx = 0;
  const fixed = current.replace(/\?{2,}/g, (match) => {
    if (idx < originalSegments.length) {
      return originalSegments[idx++];
    }
    return match;
  });

  fs.writeFileSync(currentPath, fixed, 'utf8');
  console.log(`fixed ${file}, replaced ${idx} segments, remaining ${originalSegments.length - idx}`);
}

function fixIndex() {
  const f = `${base}/astro/src/pages/index.astro`;
  let c = fs.readFileSync(f, 'utf8');

  // Text fixes
  c = c.replace('<BaseLayout title="??" description="??????????">', '<BaseLayout title="首页" description="欢迎来到我的个人博客">');
  c = c.replace('Personal Log // ????', 'PERSONAL LOG // 持续更新中');
  c = c.replace('<h1 class="animate-reveal stagger-2 font-display text-7xl font-black tracking-tighter text-ink sm:text-8xl md:text-9xl">\n        ??\n      </h1>', '<h1 class="animate-reveal stagger-2 font-display text-7xl font-black tracking-tighter text-ink sm:text-8xl md:text-9xl">\n        个人博客\n      </h1>');
  c = c.replace('<p class="animate-reveal stagger-4 mx-auto mt-6 max-w-xl text-dim">\n        ????????????????????\n      </p>', '<p class="animate-reveal stagger-4 mx-auto mt-6 max-w-xl text-dim">\n        分享技术、思考与生活\n      </p>');
  c = c.replace('<a href="#latest" class="btn-primary inline-flex items-center gap-3">\n          ????\n          <svg', '<a href="#latest" class="btn-primary inline-flex items-center gap-3">\n          浏览文章\n          <svg');
  c = c.replace('<h2 class="font-display text-2xl font-black uppercase tracking-wide text-ink">????</h2>', '<h2 class="font-display text-2xl font-black uppercase tracking-wide text-ink">最新文章</h2>');
  c = c.replace('<p class="mt-1 text-sm text-dim">?????????</p>', '<p class="mt-1 text-sm text-dim">最近发布的技术文章和思考</p>');
  c = c.replace('????\n        <svg class="h-4 w-4 transition-transform group-hover:translate-x-1"', '查看全部\n        <svg class="h-4 w-4 transition-transform group-hover:translate-x-1"');
  c = c.replace('<h3 class="font-display text-lg font-bold uppercase tracking-wide text-ink">????</h3>\n        <p class="mt-1 text-sm text-dim">??????</p>', '<h3 class="font-display text-lg font-bold uppercase tracking-wide text-ink">所有文章</h3>\n        <p class="mt-1 text-sm text-dim">浏览所有已发布的文章</p>');
  c = c.replace('<h3 class="font-display text-lg font-bold uppercase tracking-wide text-ink">????</h3>\n        <p class="mt-1 text-sm text-dim">?????</p>', '<h3 class="font-display text-lg font-bold uppercase tracking-wide text-ink">标签分类</h3>\n        <p class="mt-1 text-sm text-dim">按标签筛选感兴趣的内容</p>');

  // Stacking effect: replace stats section
  c = c.replace(
    /<div class="animate-reveal stagger-5 mt-10 flex flex-wrap justify-center gap-4">\s*<div class="holo-card animate-scan px-7 py-4 text-center">\s*<div class="font-display text-2xl font-bold text-cyan">\{postsCount\}<\/div>\s*<div class="mt-1 font-mono text-\[10px\] uppercase tracking-widest text-muted">Articles<\/div>\s*<\/div>\s*<div class="holo-card animate-scan px-7 py-4 text-center" style="animation-delay: 0\.5s">\s*<div class="font-display text-2xl font-bold text-amber">\{tagsCount\}<\/div>\s*<div class="mt-1 font-mono text-\[10px\] uppercase tracking-widest text-muted">Tags<\/div>\s*<\/div>\s*<\/div>/,
    `<div class="mt-10 flex flex-col items-center [perspective:800px]">
        <div class="animate-stack-up stagger-5 holo-card animate-scan relative z-10 w-44 px-8 py-5 text-center shadow-[0_0_30px_rgba(34,211,238,0.15)] transition-transform hover:-translate-y-1">
          <div class="font-display text-2xl font-bold text-cyan">{postsCount}</div>
          <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Articles</div>
        </div>
        <div class="animate-stack-up stagger-5 holo-card animate-scan relative z-20 -mt-5 w-48 px-8 py-5 text-center shadow-[0_-10px_40px_rgba(251,191,36,0.2)] transition-transform hover:-translate-y-1" style="animation-delay: 0.7s">
          <div class="font-display text-2xl font-bold text-amber">{tagsCount}</div>
          <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Tags</div>
        </div>
      </div>`
  );

  fs.writeFileSync(f, c, 'utf8');
  console.log('index.astro fixed');
}

function fixSearchModal() {
  const f = `${base}/astro/src/components/search/SearchModal.tsx`;
  let c = fs.readFileSync(f, 'utf8');
  c = c.replace(/aria-label="[^"]*Ctrl \? Command \? K\?"/, 'aria-label="搜索文章（快捷键 Ctrl 或 Command 加 K）"');
  fs.writeFileSync(f, c, 'utf8');
  console.log('SearchModal specific fixes applied');
}

function addStackAnimation() {
  const f = `${base}/astro/src/styles/global.css`;
  let c = fs.readFileSync(f, 'utf8');
  if (c.includes('@keyframes stack-up')) return;
  c = c.replace(
    '@keyframes reveal-up {',
    `@keyframes stack-up {
  from {
    opacity: 0;
    transform: translateY(40px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes reveal-up {`
  );
  c = c.replace(
    '.animate-reveal {',
    `.animate-stack-up {
  animation: stack-up 0.8s var(--ease-out-expo) forwards;
  opacity: 0;
}

.animate-reveal {`
  );
  fs.writeFileSync(f, c, 'utf8');
  console.log('stack animation added');
}

fixIndex();
for (const file of files.slice(1)) {
  fixGeneric(file);
}
fixSearchModal();
addStackAnimation();