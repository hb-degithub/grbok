import { useSyncExternalStore } from 'react';

interface BreakpointState {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  currentBreakpoint: 'mobile' | 'tablet' | 'desktop';
  prefersReducedMotion: boolean;
}

const MOBILE_MQ = '(max-width: 639px)';
const TABLET_MQ = '(min-width: 640px) and (max-width: 1023px)';
const DESKTOP_MQ = '(min-width: 1024px)';
const REDUCED_MOTION_MQ = '(prefers-reduced-motion: reduce)';

const SERVER_SNAPSHOT: BreakpointState = {
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  currentBreakpoint: 'desktop',
  prefersReducedMotion: false,
};

// Cache the client snapshot so getSnapshot returns a stable reference until a
// media query actually changes. Returning a new object literal each call throws
// "The result of getSnapshot should be cached to avoid an infinite loop" and
// pegs the React reconciler — this was breaking the entire page (login bg, etc).
let cachedSnapshot: BreakpointState | null = null;
let cachedKey = '';

function readRaw(): BreakpointState {
  const isMobile = window.matchMedia(MOBILE_MQ).matches;
  const isTablet = window.matchMedia(TABLET_MQ).matches;
  const isDesktop = window.matchMedia(DESKTOP_MQ).matches;
  const prefersReducedMotion = window.matchMedia(REDUCED_MOTION_MQ).matches;
  const currentBreakpoint = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';
  return { isMobile, isTablet, isDesktop, currentBreakpoint, prefersReducedMotion };
}

function snapshotKey(s: BreakpointState): string {
  return `${s.isMobile}|${s.isTablet}|${s.isDesktop}|${s.currentBreakpoint}|${s.prefersReducedMotion}`;
}

function subscribe(callback: () => void) {
  const queries = [MOBILE_MQ, TABLET_MQ, DESKTOP_MQ, REDUCED_MOTION_MQ]
    .map((q) => window.matchMedia(q));
  queries.forEach((mql) => mql.addEventListener('change', callback));
  return () => queries.forEach((mql) => mql.removeEventListener('change', callback));
}

function getSnapshot(): BreakpointState {
  const raw = readRaw();
  const key = snapshotKey(raw);
  if (cachedSnapshot && key === cachedKey) return cachedSnapshot;
  cachedSnapshot = raw;
  cachedKey = key;
  return raw;
}

function getServerSnapshot(): BreakpointState {
  return SERVER_SNAPSHOT;
}

function useBreakpoint(): BreakpointState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default useBreakpoint;
