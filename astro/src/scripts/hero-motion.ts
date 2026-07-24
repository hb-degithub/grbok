// 首页 hero 视差与 section 标题入场。
// hero 内容上移淡出、粒子背景反向慢移形成双层视差；section 标题滚动到视口时上浮入场。
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let ctx: gsap.Context | undefined;

function setup() {
  ctx?.revert();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  ctx = gsap.context(() => {
    const heroContent = document.querySelector('.journal-hero-content');
    if (heroContent) {
      gsap.to(heroContent, {
        y: -56,
        opacity: 0.2,
        ease: 'none',
        scrollTrigger: { trigger: '.journal-hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    const particles = document.querySelector('.hero-particles');
    if (particles) {
      gsap.to(particles, {
        y: 64,
        ease: 'none',
        scrollTrigger: { trigger: '.journal-hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }

    // section 标题入场（移动端保持轻量，跳过）
    if (window.matchMedia('(min-width: 640px)').matches) {
      gsap.utils.toArray<HTMLElement>('.section-head').forEach((el) => {
        gsap.from(el, {
          y: 36,
          opacity: 0,
          duration: 0.7,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });
    }
  });
}

setup();
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => ctx?.revert());
