const fs = require('fs');

const file = 'H:/开发/个人博客/astro/src/pages/index.astro';
let f = fs.readFileSync(file, 'utf8');

// Replace the entire stats section
const oldStats = `      <!-- Stats -->
      <div class="mt-16 flex flex-col items-center [perspective:1200px]">
        <div class="relative h-36 w-56 [transform-style:preserve-3d]">
          <!-- 底层 Articles 卡片 -->
          <div class="animate-stack-up stagger-5 holo-card absolute inset-x-0 bottom-0 z-10 rounded-xl border-cyan/20 px-8 py-5 text-center shadow-[0_10px_40px_rgba(34,211,238,0.12)] transition-all duration-300 hover:-translate-y-1">
            <div class="font-display text-3xl font-bold text-cyan">{postsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Articles</div>
          </div>
          <!-- 向上堆叠的 Tags 卡片 -->
          <div class="animate-stack-up stagger-5 holo-card absolute inset-x-0 bottom-6 z-20 rounded-xl border-amber/20 px-8 py-5 text-center shadow-[0_10px_40px_rgba(251,191,36,0.15)] transition-all duration-300 hover:-translate-y-2" style="animation-delay: 0.7s">
            <div class="font-display text-3xl font-bold text-amber">{tagsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Tags</div>
          </div>
        </div>
      </div>`;

const newStats = `      <!-- Stats - 向上堆叠卡片 -->
      <div class="mt-14 flex items-end justify-center gap-3 [perspective:1000px]">
        <!-- Articles 卡片 -->
        <div class="animate-stack-up stagger-5 group relative [transform:rotateY(3deg)] transition-all duration-500 hover:[transform:rotateY(0deg)_translateY(-8px)]">
          <div class="holo-card rounded-xl px-8 py-5 text-center border-cyan/20 shadow-[0_0_30px_rgba(34,211,238,0.10)]">
            <div class="font-display text-3xl font-bold text-cyan">{postsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Articles</div>
          </div>
        </div>
        <!-- Tags 卡片 - 向上偏移形成堆叠 -->
        <div class="animate-stack-up stagger-5 group relative -mb-3 [transform:rotateY(-3deg)] transition-all duration-500 hover:[transform:rotateY(0deg)_translateY(-8px)]" style="animation-delay: 0.7s">
          <div class="holo-card rounded-xl px-8 py-5 text-center border-amber/20 shadow-[0_0_30px_rgba(251,191,36,0.10)]">
            <div class="font-display text-3xl font-bold text-amber">{tagsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Tags</div>
          </div>
        </div>
      </div>`;

if (f.includes(oldStats)) {
  f = f.replace(oldStats, newStats);
  fs.writeFileSync(file, f, 'utf8');
  console.log('Stats section redesigned with side-by-side upward stack');
} else {
  console.log('Stats section pattern not found, trying regex...');
  // Use regex fallback
  const regex = /<!-- Stats -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/;
  if (regex.test(f)) {
    f = f.replace(regex, newStats);
    fs.writeFileSync(file, f, 'utf8');
    console.log('Stats section redesigned (regex fallback)');
  } else {
    console.log('ERROR: Could not find stats section');
  }
}
