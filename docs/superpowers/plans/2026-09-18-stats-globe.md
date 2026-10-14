# Stats Globe Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task. The configured Qwen custom agent is unavailable in this runtime; execute inline.

**Goal:** Deliver the approved themed data globe with clear geographic depth and useful visitor interactions.

**Architecture:** Keep the existing React / engine boundary and existing statistics API. Isolate deterministic geographic sampling and coordinate conversion from WebGL; let the engine own resources, visibility and controls, and React own accessible UI.

**Tech Stack:** Astro, React, TypeScript, existing Three.js, CSS modules, Vitest, Playwright.

## Global Constraints

- Follow the user's confirmed light/dark themes, scope and interaction choices.
- React components use default exports. No new runtime dependencies.
- Preserve unrelated worktree edits. No database, auth, or deployment changes.
- Run build and all Vitest tests as hard gates, then inspect browser screenshots.

## Tasks

- [x] Geographic helpers: write regression tests for deterministic sampling, polygon holes, coordinate round trips and country-level normalization; implement `globe-geo.ts`.
- [x] Rendering: replace transparent globe with opaque lit sphere, circular land particles, subdued borders and data markers. Load existing world asset once, cancel on destruction, guard post-await work, and clean all resources.
- [x] Interaction: implement `setAutoRotate(boolean)` and `resetView()`, front-surface region hit testing, pointer capture/cancel, keyboard rotation, theme observation, reduced motion and visibility handling.
- [x] UI: restyle `Globe3D` with local CSS, responsive canvas, constrained tooltip, legend and accessible 44px controls. Restyle `DualModeGeoMap` toolbar and local statistics panel/rankings.
- [x] Validation: run `npx vitest run`, `npm run build`, targeted type/lint checks as appropriate, then browser inspection on desktop/mobile, both themes, both regions, 2D fallback and reduced motion. Save before/after screenshots under `tmp/stats-globe-review`.

## Review cases

1. Samples are identical across invocations; holes receive no land particles.
2. Only the world asset is fetched; country-level data still includes China.
3. Dragging and pausing do not silently restart rotation; the map retains only the 2D/3D view controls.
4. Switching themes recolors the existing globe without extra map downloads.
5. At 320px the globe and controls fit their container, and touch scrolling remains available.
6. WebGL failure leads to the existing 2D view, and initialization completion after unmount creates no canvas or animation loop.

## Approved follow-up

- [x] Remove the China province view, region switch, province aggregation and province asset requests from both 2D and 3D statistics views. Preserve China as a country in the world map.
