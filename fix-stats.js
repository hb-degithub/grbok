const fs = require('fs');
const path = require('path');

const file = path.join('H:/开发/个人博客', 'astro/src/pages/index.astro');
let f = fs.readFileSync(file, 'utf8');

const oldStats = `<div class="mt-16 flex flex-col items-center [perspective:1200px]">
        <div class="relative w-56 space-y-2">
          <div class="animate-stack-up stagger-5 holo-card relative z-10 origin-bottom rounded-xl border-cyan/20 px-8 py-5 text-center shadow-[0_10px_40px_rgba(34,211,238,0.12)] transition-all duration-300 hover:[transform:rotateX(0deg)_translateY(-4px)] [transform:rotateX(8deg)]">
            <div class="font-display text-3xl font-bold text-cyan">{postsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Articles</div>
          </div>
          <div class="animate-stack-up stagger-5 holo-card relative z-20 origin-bottom rounded-xl border-amber/20 px-8 py-5 text-center shadow-[0_10px_40px_rgba(251,191,36,0.15)] transition-all duration-300 hover:[transform:rotateX(0deg)_translateY(-4px)] [transform:rotateX(3deg)]" style="animation-delay: 0.7s">
            <div class="font-display text-3xl font-bold text-amber">{tagsCount}</div>
            <div class="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">Tags</div>
          </div>
        </div>
      </div>`;

const newStats = `<div class="mt-16 flex flex-col items-center [perspective:1200px]">
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

if (f.includes(oldStats)) {
  f = f.replace(oldStats, newStats);
  fs.writeFileSync(file, f, 'utf8');
  console.log('stats section updated to upward stack');
} else {
  console.log('old stats section not found, skipping');
}
