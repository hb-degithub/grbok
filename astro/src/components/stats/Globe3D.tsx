import React, { useState, useEffect, useRef, useCallback, useId, memo } from 'react';
import { Globe3DEngine, type GlobeGeoData } from '../../lib/globe-3d';
import { viewMaximum } from '../../lib/globe-geo';
import styles from './Globe3D.module.css';

interface Globe3DProps {
  worldData: Record<string, GlobeGeoData>;
  onFallback?: () => void;
}
interface TooltipState { data: GlobeGeoData; x: number; y: number }

function Globe3D({ worldData, onFallback }: Globe3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Globe3DEngine | null>(null);
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const instructionsId = useId();
  const handleHover = useCallback((data: GlobeGeoData | null, x: number, y: number) => {
    setTooltip(data ? { data, x, y } : null);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const handleError = () => {
      if (cancelled) return;
      if (fallbackRef.current) fallbackRef.current();
      else { setError(true); setLoading(false); }
    };
    const engine = new Globe3DEngine({
      container: containerRef.current, worldData,
      onHover: handleHover,
      onRotationChange: value => { if (!cancelled) setRotating(value); },
      onError: handleError,
    });
    engineRef.current = engine;
    engine.init().then(() => { if (!cancelled) setLoading(false); }).catch(() => {
      if (!cancelled) { engine.destroy(); handleError(); }
    });
    return () => {
      cancelled = true;
      engine.destroy();
      engineRef.current = null;
    };
    // Engine creation is mount-only; current data is synchronized below after init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleHover]);

  useEffect(() => {
    if (!loading && !error) engineRef.current?.updateData(worldData);
  }, [worldData, loading, error]);

  const maximum = viewMaximum(worldData);
  const hasVisits = Object.values(worldData).some(item => item.views > 0);
  return (
    <div className={styles.globe}>
      <div className={styles.stage}>
        <div className={styles.caption} aria-hidden="true">
          <span>世界 · 访客足迹</span>
          <span className={styles.status}><i />{rotating ? '缓慢自转' : '自由探索'}</span>
        </div>
        <div
          ref={containerRef}
          className={styles.canvas}
          role="img"
          tabIndex={0}
          aria-label="国际访客 3D 地球"
          aria-describedby={instructionsId}
          aria-busy={loading}
        />
        <span id={instructionsId} className="sr-only">拖拽旋转或使用方向键，Home 键复位。悬停或轻触地表查看数据。使用下方按钮控制自转。</span>
        {loading && !error && (
          <div className={styles.overlay} role="status" aria-label="3D 地球加载中">
            <span className={styles.loader} /><span>正在绘制访客足迹…</span>
          </div>
        )}
        {error && (
          <div className={styles.overlay} role="alert">
            <span>地球暂时无法显示</span>
            <button type="button" className={styles.control} onClick={() => window.location.reload()}>重新加载</button>
          </div>
        )}
        {tooltip && !loading && (
          <div
            role="tooltip"
            className={styles.tooltip}
            style={{
              left: 'clamp(86px, ' + (tooltip.x + 1) * 50 + '%, calc(100% - 86px))',
              top: 'clamp(98px, ' + (-tooltip.y + 1) * 50 + '%, calc(100% - 12px))',
            }}
          >
            <strong>{tooltip.data.name}</strong>
            {tooltip.data.views > 0
              ? <span><b>{tooltip.data.views.toLocaleString()}</b> 次浏览 <em>·</em> {tooltip.data.uv.toLocaleString()} 位访客</span>
              : <span>暂无访问记录</span>}
          </div>
        )}
        {!hasVisits && !loading && !error && <div className={styles.empty}>暂无访问记录</div>}
      </div>
      <div className={styles.toolbar}>
        <span className={styles.hint}>拖拽探索<span> · 悬停查看</span></span>
        <div className={styles.controls}>
          <button type="button" className={styles.control} disabled={loading || error} aria-label={rotating ? '暂停自转' : '开始自转'} onClick={() => engineRef.current?.setAutoRotate(!rotating)}>
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {rotating ? <path d="M7 5v10M13 5v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : <path d="m7 4 9 6-9 6V4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />}
            </svg>{rotating ? '暂停' : '自转'}
          </button>
          <button type="button" className={styles.control} disabled={loading || error} onClick={() => engineRef.current?.resetView()} aria-label="复位地球视角">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 8a6 6 0 1 1 0 5M4 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>复位
          </button>
        </div>
      </div>
      <div className={styles.legend} aria-label={'浏览量图例，当前区域最高 ' + maximum + ' 次'}>
        <span>浏览量</span><span className={styles.scale}><i /><i /><i /><i /><i /></span>
        <span>少 → 多</span><span className={styles.legendEnd}>{hasVisits ? '最高 ' + maximum.toLocaleString() + ' 次' : '暂无数据'}</span>
      </div>
    </div>
  );
}
export default memo(Globe3D);
