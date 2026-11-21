import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import MermaidRenderer from '../MermaidRenderer';

/**
 * MermaidRenderer 岛屿行为测试。
 *
 * mermaid 本体体积大且依赖真实浏览器布局，这里用 `vi.hoisted` 造一个替身：
 *   - `run` 记录被渲染节点当前的 textContent，便于验证「主题切换前先还原源码」；
 *   - 默认成功分支把节点内容替换成 `<svg>` 并打上 `data-processed`；
 *   - 失败分支由测试按用例切换。
 */
const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  run: vi.fn(),
  mode: 'success' as 'success' | 'failure',
  /** 每次 run 调用时各节点的 textContent（用于验证重渲染前已还原源码）。 */
  seenSources: [] as string[][],
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidMock.initialize,
    run: mermaidMock.run,
  },
}));

/** 每个用例重置替身行为：默认把节点替换成 `<svg>` 并打上 `data-processed`。 */
function resetMermaidMock() {
  mermaidMock.initialize.mockReset();
  mermaidMock.run.mockReset();
  mermaidMock.mode = 'success';
  mermaidMock.seenSources = [];
  mermaidMock.run.mockImplementation(async ({ nodes }: { nodes: HTMLElement[] }) => {
    mermaidMock.seenSources.push(nodes.map((node) => node.textContent ?? ''));
    if (mermaidMock.mode === 'failure') {
      nodes.forEach((node) => node.setAttribute('data-processed', 'true'));
      return;
    }
    nodes.forEach((node) => {
      node.innerHTML = '<svg data-testid="diagram"></svg>';
      node.setAttribute('data-processed', 'true');
    });
  });
}

function mountDiagram(source = 'graph TD; A-->B;'): HTMLElement {
  const node = document.createElement('div');
  node.className = 'mermaid';
  node.textContent = source;
  document.body.appendChild(node);
  return node;
}

beforeEach(() => {
  resetMermaidMock();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
});

describe('MermaidRenderer', () => {
  it('渲染正文里的 .mermaid 节点，并按当前主题初始化', async () => {
    const node = mountDiagram();

    render(<MermaidRenderer />);

    await waitFor(() => expect(node.querySelector('svg')).not.toBeNull());
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ startOnLoad: false, theme: 'default', securityLevel: 'strict' }),
    );
    expect(node.getAttribute('data-processed')).toBe('true');
    expect(node.classList.contains('mermaid-rendered')).toBe(true);
  });

  it('暗色主题下使用 dark 主题', async () => {
    document.documentElement.classList.add('dark');
    mountDiagram();

    render(<MermaidRenderer />);

    await waitFor(() => expect(mermaidMock.initialize).toHaveBeenCalled());
    expect(mermaidMock.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('渲染失败时保留源码并显示可读错误，不抛出', async () => {
    mermaidMock.mode = 'failure';
    const node = mountDiagram('graph TD; broken[[');

    render(<MermaidRenderer />);

    await waitFor(() => expect(node.querySelector('.mermaid-error')).not.toBeNull());
    // 源码仍在
    expect(node.textContent).toContain('graph TD; broken[[');
    // 可读错误提示
    expect(node.querySelector('.mermaid-error')?.textContent).toContain('图表渲染失败');
    expect(node.classList.contains('mermaid-error')).toBe(true);
  });

  it('主题切换后按新主题重渲染，且重渲染前恢复源码', async () => {
    const node = mountDiagram('graph TD; A-->B;');

    render(<MermaidRenderer />);
    await waitFor(() => expect(node.querySelector('svg')).not.toBeNull());
    expect(mermaidMock.run).toHaveBeenCalledTimes(1);

    // 模拟 BaseLayout 的主题切换
    document.documentElement.classList.add('dark');

    await waitFor(() => expect(mermaidMock.run).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mermaidMock.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));

    expect(mermaidMock.seenSources[1][0]).toBe('graph TD; A-->B;');
    // 重渲染后仍然没有重复的错误提示
    expect(node.querySelectorAll('.mermaid-error')).toHaveLength(0);
  });

  it('主题没有变化时不会重复渲染（幂等）', async () => {
    mountDiagram();

    render(<MermaidRenderer />);
    await waitFor(() => expect(mermaidMock.run).toHaveBeenCalledTimes(1));

    // 触发一次与主题无关的 html class 变化
    document.documentElement.classList.add('site-mounted');

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mermaidMock.run).toHaveBeenCalledTimes(1);
  });

  it('正文没有 .mermaid 时不加载 mermaid', async () => {
    render(<MermaidRenderer />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mermaidMock.initialize).not.toHaveBeenCalled();
    expect(mermaidMock.run).not.toHaveBeenCalled();
  });
});
