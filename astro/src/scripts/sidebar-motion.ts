// 首页固定侧栏滚动视差：侧栏以低于内容的速率上移，消除「钉死」感。
// 外层 aside 负责入场动画（sidebar-rise，会写 transform），
// 所以视差作用在内层 .sidebar-parallax-* 包装上，避免变换冲突。
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

let ctx: gsap.Context | undefined;

function setup() {
  ctx?.revert();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(min-width: 1280px)').matches) return;
  if (!document.querySelector('.sidebar-parallax-left')) return;

  ctx = gsap.context(() => {
    gsap.to('.sidebar-parallax-left', {
      y: -28,
      ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'max', scrub: 0.6 },
    });
    gsap.to('.sidebar-parallax-right', {
      y: -14,
      ease: 'none',
      scrollTrigger: { trigger: document.body, start: 'top top', end: 'max', scrub: 0.6 },
    });
  });
}

setup();
document.addEventListener('astro:page-load', setup);
document.addEventListener('astro:before-swap', () => ctx?.revert());
