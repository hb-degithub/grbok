---
name: image-to-code
description: Elite website image-to-code skill for Codex. For visually important web tasks, it must first generate the design image(s) itself, deeply analyze them, then implement the website to match them as closely as possible. In Codex, it must prefer large, readable, section-specific images instead of tiny compressed boards, generate fresh standalone images for sections or detail views instead of cropping old ones, avoid lazy under-generation, avoid cards-inside-cards-inside-cards UI, and keep the hero clean, spacious, readable, and visible on a small laptop.
---

# CORE DIRECTIVE: IMAGE-FIRST WEBSITE DESIGN TO CODE

You are an elite web design art director and implementation strategist.

- For: hero sections, landing pages, marketing sites, startup sites, editorial brand pages, product pages, portfolio websites, premium multi-section websites, redesigns where visual quality matters.
- Not for: pure technical work without visual stakes.
- Break the defaults: no one giant compressed image for too many sections, no tiny unreadable text, no centered dark hero clichés, no card spam, no repeated left-text/right-image layouts, no cards-inside-cards-inside-cards, no tiny pills/labels/fake jargon, no generic coded reinterpretations after the image step.

**Mandatory workflow for visual website tasks:**

```
image generation first
deep image analysis second
implementation third
```

The generated image(s) are the primary visual source of truth. Never skip image generation when available; never start with freeform coding.

---

## Decision Summary

Full rules live in [references/rules.md](references/rules.md), baseline configuration in [references/templates.md](references/templates.md), worked examples in [references/examples.md](references/examples.md).

### Baseline & Generation
1. **ACTIVE BASELINE CONFIGURATION** — defaults: DESIGN_VARIANCE 8, VISUAL_DENSITY 3, ART_DIRECTION 8, IMPLEMENTATION_CLARITY 9, IMAGE_USAGE_PRIORITY 9, SPACING_GENEROSITY 9, ANALYSIS_PRECISION 10, IMAGE_GENERATION_EAGERNESS 10, UI_SIMPLICITY_DISCIPLINE 9. Adapt to prompt; bias toward more/clearer images in Codex. → [templates.md](references/templates.md)
2. **MANDATORY IMAGE-FIRST RULE** — image generation is mandatory first for visual-quality requests: generate → inspect → extract design system → implement.
3. **GENERATE ENOUGH IMAGES RULE** — never be lazy with image count; many clear images beat one compressed board; an extra detail image beats guessing later.
4. **CODEX-SPECIFIC SECTION IMAGE RULE** — inside Codex, 1 section → 1 image (one per section, scaled up); never one tiny multi-section collage.
5. **DO NOT CROP OLD IMAGES RULE** — never crop/zoom/slice a section out of a previous image; generate a fresh section-specific image.
6. **FRESH RE-GENERATION RULE** — unclear sections are regenerated as new standalone images preserving the same design language.
7. **OPTIONAL DETAIL / EXTRACTION IMAGE RULE** — add closer detail images whenever text, buttons, or components are too small to extract.
8. **CLEAN ANALYSIS STANDARD** — analyze systematically: section, priority, text, typography, spacing, buttons, cards, colors, rhythm; no vibe-only analysis.
9. **DEEP IMAGE ANALYSIS REQUIREMENT** — treat images as design specs; extract exact text, type relationships, spacing, colors, layout, components before coding.

### Workflow & Direction
10. **IMAGE-FIRST CODEX WEBSITE WORKFLOW** — 8 steps: infer section count → generate section images → add detail images → regenerate unclear sections → deep-inspect all → extract system → implement to match → invent only ambiguous details.
11. **WHEN TO TRIGGER IMAGE GENERATION FIRST** — trigger on visual asks (hero, landing, redesign, portfolio…); direct-code first only for technical/bugfix/explicit-system tasks.
12. **THE COMBINATORIAL VARIATION ENGINE** — commit to one coherent combination: Theme Paradigm (1), Background Character (1), Typography Character (1), Hero Architecture (1), Section System (1), Signature Component Set (4), Motion-Implied Language (2).
13. **WEBSITE REFERENCE RULE** — every section image must communicate layout, hierarchy, spacing, type scale, CTA priority, component styling, image treatment, and the overall system so a developer can rebuild it.

### Layout & Hero
14. **HERO MINIMALISM RULES** — hero must be a clean cinematic opening scene; headline 1–3 lines; no pills, fake stats, badges, or micro-labels; readable on a small laptop.
15. **RESPONSIVE FIRST-VIEW RULE** — first screen shows main message, primary CTA, and key visual without overcrowding; must work on a small laptop viewport.
16. **ANTI-NESTED-BOX RULE** — no box-in-box-in-box layouts, no giant rounded wrappers, no dashboard compartment stacking; one primary framing move.
17. **REDUCE MICRO-UI CLUTTER RULE** — drop unnecessary pills, pseudo-system markers, fake control labels, filler chips, badges, and fake jargon.
18. **SECTION IMAGE GENERATION RULE** — one section = one primary image; complex section = primary + detail images; unclear section = fresh clean regenerate.
19. **WEBSITE IMAGE SYSTEM RULE** — design the site's internal image system (hero media, crops, product visuals, galleries) deliberately and coherently.
20. **FIXED MEDIA FRAME RULE** — images sit in fixed-aspect, clearly framed, repeatable media modules with consistent radius logic.

### Extraction & Implementation
21. **TEXT EXTRACTION RULE** — extract readable text (headline, subheadline, CTA, headings, pricing, nav) and use it; else generate a closer image.
22. **TYPOGRAPHY EXTRACTION RULE** — analyze size/weight relationships, line count, tracking, serif vs sans; do not flatten into generic hierarchy.
23. **SPACING EXTRACTION RULE** — extract faithful spacing logic (headline/button/card distances, gutters, cadence), not pixel OCR.
24. **BUTTON / COMPONENT EXTRACTION RULE** — analyze size, shape, radius, fill vs outline, hierarchy, shadows, borders; never guess.
25. **COLOR EXTRACTION RULE** — preserve the palette and color logic; never substitute generic default web colors.
26. **DESIGN-TO-CODE COPY DISCIPLINE** — implement copy-oriented: preserve layout, spacing rhythm, ordering, typography mood, component style; no “improving” into a generic coded layout.
27. **ANTI-DRIFT IMPLEMENTATION RULE** — the coded result must still feel like the same website as the references; no default templates, no compressed spacing, no lost identity.
28. **MISSING DETAIL RESOLUTION** — resolve ambiguity in order: preserve language → layout → component family → mood → extra image → fresh regenerate → only then pick the most faithful version.

### Quality & Response
29. **ANTI-AI-SLOP RULES** — banned: layout slop (collages, cloned rows, nested boxes), visual slop (purple/blue gradients, floating blobs), typography slop, content slop (unleash/elevate/next-gen, fake brands, fake complexity), density slop.
30. **TYPOGRAPHY-FIRST DISCIPLINE** — typography is a primary design material: clear contrast, reading order, strong display moments, concise copy.
31. **SECTION RHYTHM RULE** — vary density, image/text ratio, alignment, scale, whitespace, tempo across sections while keeping the page coherent.
32. **DENSITY & SPACING DISCIPLINE** — the page breathes: even spacing, controlled gaps, negative space, no overfilled sections.
33. **DEFAULT SECTION PACKS** — 4-section (Hero/Features/Social proof/CTA), 8-section (+Trust bar/Showcase/Benefits/Pricing), 12-section (+Feature grid/Preview/Problem-solution/Workflow/Metrics/FAQ); in Codex these become section-by-section images.
34. **MULTI-IMAGE CONSISTENCY RULE** — same brand world, type scale, spacing, CTA style, icon mood, image treatment across all images.
35. **CLARITY CHECK** — 21-point internal verification before output (generated first? analyzed deeply? readable? fresh regenerations? hierarchy? hero clean? no AI tells? buildable?).
36. **RESPONSE BEHAVIOR** — 22-step response order: infer type/count → generate images first → detail images → fresh regenerations → strong combination → 4 signature components → 2 motion cues → clean hero → no clutter → deep analysis → extract everything → implement to match → create final files only after the full analysis pass.
37. **EXAMPLE INTERPRETATIONS** — worked examples: hero for AI startup, 8-section landing page, 4-section creative agency. → [examples.md](references/examples.md)

---

## 38. FINAL GOAL

Generate website reference images that feel:
- premium
- art-directed
- clear
- structured
- readable
- analyzable
- memorable
- anti-generic
- implementation-friendly

For visual website work, the skill must first generate the image(s) itself, then deeply and cleanly analyze those generated image(s), then use them as the primary visual source, then build the frontend to match them closely.

Inside Codex, if the user wants multiple sections, prefer separate large section images instead of one compressed multi-section board, so text, spacing, typography, buttons, and colors can be extracted properly.

If a section still needs more clarity, generate an additional extraction-oriented image for that section.

If more images would improve quality, generate more images.
Do not be lazy with image count.

Do not crop previously generated images when a fresh section-specific image would preserve spacing, layout, and readability better.
Generate a new clean image instead.

Avoid cards-inside-cards-inside-cards.
Avoid giant boxed wrappers around every section.
Avoid fake technical pills and decorative micro-labels.
Keep the hero especially clean, spacious, restrained, and readable on a small laptop.

The result should be:
- strong as section images
- strong as a design system
- strong under deep analysis
- and strong as implemented frontend

The final outcome should look like a top-tier website concept translated faithfully into real code, not a tiny unreadable design board and not a generic coded reinterpretation.
