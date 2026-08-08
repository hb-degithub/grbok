---
name: design-taste-frontend
description: Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right design direction, and ships interfaces that do not look templated. Real design systems when applicable, audit-first on redesigns, strict pre-flight check.
---

# tasteskill: Anti-Slop Frontend Skill

> Landing pages, portfolios, and redesigns. Not dashboards, not data tables, not multi-step product UI.
> Every rule below is **contextual**. None of it fires automatically. First read the brief, then pull only what fits.

---

## Decision Summary

Full rules live in [references/rules.md](references/rules.md), decisions and pre-flight in [references/decisions.md](references/decisions.md), install commands / canonical sources / Liquid Glass approximation in [references/templates.md](references/templates.md).

### 0. BRIEF INFERENCE (Read the Room Before Anything Else)
Read signals first (page kind, vibe words, references, audience, existing brand assets, quiet constraints). Output a one-line **"Design Read"** before generating. If ambiguous, ask exactly one question — never guess, never dump questions. Anti-Default Discipline: no AI-purple gradients, no centered dark hero, no three equal feature cards, no generic glassmorphism, no Inter + slate-900 by default. → [decisions.md](references/decisions.md)

### 1. THE THREE DIALS (Core Configuration)
Set three dials after the design read: `DESIGN_VARIANCE: 8`, `MOTION_INTENSITY: 6`, `VISUAL_DENSITY: 4` (baseline 8/6/4). Dial inference table and use-case presets drive the values. Use these exact variable names everywhere — never invent aliases. Overrides happen conversationally, never by editing the file. → [decisions.md](references/decisions.md)

### 2. BRIEF → DESIGN SYSTEM MAP
Real briefs → real design systems with **official packages** (Fluent, Material Web, Carbon, Polaris, Atlaskit, Primer, GOV.UK, USWDS, Bootstrap, Radix, shadcn/ui, Tailwind v4). Honesty rule: use the official package, one system per project, never 90%-override its tokens. Aesthetic briefs (glassmorphism, bento, brutalism, editorial, dark tech, aurora, kinetic type, Liquid Glass) → native CSS + honest comments; there is no official `liquid-glass.css` for the web — label approximations. → [decisions.md](references/decisions.md)

### 3. DEFAULT ARCHITECTURE & CONVENTIONS
React/Next.js, Server Components default; any Motion/scroll/pointer component is an isolated `"use client"` leaf. Tailwind v4 (`@tailwindcss/postcss`), Motion from `motion/react`, fonts via `next/font` (never Google Fonts `<link>`). Global state only for prop-drilling (Zustand/Jotai/context); continuous values use `useMotionValue`/`useTransform`, **never** `useState`. Icons: Phosphor/Hugeicons/Radix/Tabler priority, Lucide discouraged, never hand-roll SVGs, one family per project. Emojis discouraged by default. Layout: `min-h-[100dvh]` never `h-screen`, CSS Grid over flex math. **Dependency Verification: check `package.json` before importing anything.** → [decisions.md](references/decisions.md)

### 4. DESIGN ENGINEERING DIRECTIVES (Bias Correction) — the core rule set
- **Typography:** display `text-4xl md:text-6xl tracking-tighter leading-none`; Inter discouraged as default (Geist/Outfit/Satoshi/Cabinet Grotesk first); serif very discouraged as default — only when the brief names one or the aesthetic is genuinely editorial; `Fraunces`/`Instrument_Serif` banned; italic descenders need `leading-[1.1]` + bottom reserve.
- **Color:** max 1 accent, saturation < 80%; no AI-purple glow default; premium-consumer beige+brass+espresso palette **banned** as default (rotate: cold luxury, forest, black-and-tan, cobalt+cream, terracotta+slate, olive+brick, monochrome+pop); **color consistency lock** — one accent for the whole page; **palette rotation** — never ship the same warm-craft palette twice in a row.
- **Layout:** anti-center bias when VARIANCE > 4 (split/asymmetric/scroll-pinned); cards only when elevation communicates hierarchy; tinted shadows; **one corner-radius scale per page**; loading/empty/error states always; button contrast WCAG AA (4.5:1 / 3:1); CTA labels must not wrap, one label per intent (no duplicate CTAs); form inputs pass contrast, label above input, no placeholder-as-label.
- **Hard layout rules (failing any = broken work):** hero fits initial viewport (headline ≤ 2 lines, subtext ≤ 20 words, CTAs visible without scroll); hero top padding ≤ `pt-24`; max 4 hero text elements; logo wall lives **under** the hero; nav single-line, ≤ 80px; bento cell count must match content; each layout family at most once per page; max 2 consecutive zigzag splits; **max 1 eyebrow per 3 sections**; split-header banned as default; bento needs real visual variation in 2-3 cells; explicit mobile collapse per section.
- **Images:** image-generation tool first, real web images second, labeled placeholders last; even minimalist sites need 2-3 real images; real SVG logos (Simple Icons) with **logo-only** walls; div-based fake screenshots banned; hand-rolled SVG illustrations strongly discouraged.
- **Content:** headline ≤ 8 words + sub ≤ 25 words per section default; no data-dump sections; > 5 items needs a different UI component; spec sheets never `border-b` rows (use card grid / pills / grouped chunks / featured-vs-rest); **copy self-audit** before ship; fake-precise numbers banned; one copy register per page.
- **Quotes:** max 3 lines, name + role, typographic quotes, no em-dashes. **Page theme lock:** one theme per page, sections never invert. → [rules.md](references/rules.md)

### 5. CONTEXT-AWARE PROACTIVITY
Tools, not defaults — none fire automatically. Liquid Glass (premium consumer only) needs inner border + shadow + reduced-transparency fallback; magnetic micro-physics via motion values only; perpetual micro-interactions only when the section benefits; **"motion claimed, motion shown"** — if MOTION_INTENSITY > 4 the page must actually move, else drop the dial; **every animation needs a motivation** (hierarchy/storytelling/feedback/state transition); max 1 marquee per page; canonical skeletons: sticky-stack (`start: "top top"`, pin, scale by next card), horizontal-pan (pin wrapper, scrub track), scroll-reveal via `whileInView` not GSAP; **banned:** `window.addEventListener("scroll", ...)`, scrollY math in state, rAF touching React state. → [decisions.md](references/decisions.md)

### 6. PERFORMANCE & ACCESSIBILITY GUARDRAILS
Animate only `transform`/`opacity`; `will-change` sparingly. **Reduced motion is mandatory** above MOTION_INTENSITY > 3 (collapse infinite loops, parallax, scroll-hijack, magnetic). Dual-mode by default for consumer pages. Targets: LCP < 2.5s, INP < 200ms, CLS < 0.1, run Lighthouse. Grain/noise only on fixed `pointer-events-none` pseudo-elements. No arbitrary z-index spam. → [rules.md](references/rules.md)

### 7. DIAL DEFINITIONS (Technical Reference)
VARIANCE: 1-3 symmetric grid / 4-7 offset overlaps & varied ratios / 8-10 masonry & fractional grids — **collapse to single column below 768px** at 4-10. MOTION: 1-3 static / 4-7 fluid CSS / 8-10 advanced choreography (never scroll listeners). DENSITY: 1-3 gallery (`py-32`+), 4-7 standard (`py-16`-`py-24`), 8-10 cockpit (1px lines, mono numbers). → [decisions.md](references/decisions.md)

### 8. DARK MODE PROTOCOL
Dual-mode by default. Pick one token strategy: Tailwind `dark:` variant or CSS variables. Never prescribe specific colors — enforce contrast (WCAG AA body, AAA hero), hierarchy parity, brand fidelity, no pure `#000000`/`#ffffff`. Respect `prefers-color-scheme`; test in both modes before finishing. → [decisions.md](references/decisions.md)

### 9. AI TELLS (Forbidden Patterns)
No neon/outer glows; no default serif display type; no Inter default; no per-section eyebrows; no centered-hero-everywhere; no zigzag spam; no fake-precise numbers; no em-dash flourishes (em-dash is completely banned); no filler "trust" microcopy. Full signatures list. → [rules.md](references/rules.md)

### 10. REFERENCE VOCABULARY
Pattern names the agent should know and use (Liquid Glass, Bento, Brutalism, Editorial, Kinetic Type, Mesh Gradients, etc.) with their honest web implementations. → [rules.md](references/rules.md)

### 11. REDESIGN PROTOCOL
Audit-first: read the existing site as a design read, classify preserve vs overhaul, treat existing brand assets as starting material, never silently replace a working brand. → [rules.md](references/rules.md)

### 12. THE BLOCK LIBRARY (Contract)
Reusable section blocks land here iteratively. Each block: one file, standalone, passes Pre-Flight, 8-field contract (name, purpose, props API, code sketch with RSC/Client island, mobile fallback, motion variants per MOTION_INTENSITY band, dark-mode notes, anti-patterns, references). → [rules.md](references/rules.md)

### 13. OUT OF SCOPE
Not for dashboards, data tables, multi-step product UI, or anything the design read classifies as non-marketing surface. → [decisions.md](references/decisions.md)

### 14. FINAL PRE-FLIGHT CHECK
Mechanical gate before declaring done: eyebrow count ≤ ceil(sections/3), hero copy within limits, no wrapped CTAs, no duplicate CTA intents, one accent color, one radius scale, one theme, contrast audit passed, Lighthouse run, both modes tested, copy self-audit passed. → [decisions.md](references/decisions.md)

### APPENDICES
Install commands per design system, canonical source links, and the honest Apple Liquid Glass web approximation. → [templates.md](references/templates.md)
