import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * Task B 行为契约：文章管理列表错误可重试、分页不被重置、
 * 编辑/媒体库弹窗的关闭确认、焦点进入与循环、滚动锁恢复。
 *
 * 这里使用**真实的 useAdminPosts**（只 mock 底层 service 与媒体/ai 依赖），
 * 以便同时覆盖 hook 与组件的交互，而不是只 mock hook 返回值。
 */

vi.mock('../../../components/ui/Toast', () => ({ showToast: vi.fn() }));

const adminPostService = vi.hoisted(() => ({
  getPosts: vi.fn(),
  getPostById: vi.fn(),
  createPost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  updatePostStatus: vi.fn(),
  getTags: vi.fn(),
  getPostTags: vi.fn(),
  syncPostTags: vi.fn(),
}));

vi.mock('../../../lib/services/adminPostService', () => ({ adminPostService }));

vi.mock('../../../lib/services/mediaService', () => ({
  mediaService: {
    uploadAsset: vi.fn(),
    getFileUrl: vi.fn(() => '/media/asset.png'),
  },
}));

const aiAssist = vi.hoisted(() => ({
  assisting: null as string | null,
  runMeta: vi.fn(),
  runPolish: vi.fn(),
  runContinue: vi.fn(),
}));

vi.mock('../../../hooks/domains/useAiAssist', () => ({ useAiAssist: () => aiAssist }));

vi.mock('../MediaLibrary', () => ({
  default: ({
    onSelect,
    onClose,
  }: {
    onSelect?: (url: string) => void;
    onClose?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onSelect?.('/covers/picked.png')}>
        选择这个封面
      </button>
      <button type="button" onClick={() => onClose?.()}>
        关闭媒体库
      </button>
    </div>
  ),
}));

vi.mock('../AiArticleGenerator', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>AI 生成器</div> : null),
}));

import PostManager from '../PostManager';
import { showToast } from '../../../components/ui/Toast';

const mockedShowToast = vi.mocked(showToast);

type ListResult = {
  items: Array<Record<string, unknown>>;
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

const post = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `标题 ${id}`,
  slug: `post-${id}`,
  status: 'published',
  excerpt: `摘要 ${id}`,
  content: '',
  created: '2026-01-01 00:00:00.000Z',
  updated: '2026-01-01 00:00:00.000Z',
  ...overrides,
});

const listResult = (items: Array<Record<string, unknown>>, totalPages = 1): ListResult => ({
  items,
  page: 1,
  perPage: 20,
  totalItems: items.length,
  totalPages,
});

const forbidden = {
  status: 403,
  message: 'Forbidden',
  response: { data: { message: '没有执行该操作的权限' } },
};

const editorDialog = () => screen.queryByRole('dialog');

const openNewDraft = async () => {
  fireEvent.click(screen.getByRole('button', { name: '+ 新建文章' }));
  return screen.findByRole('dialog');
};

beforeEach(() => {
  for (const fn of Object.values(adminPostService)) fn.mockReset();
  aiAssist.runMeta.mockReset();
  aiAssist.runPolish.mockReset();
  aiAssist.runContinue.mockReset();

  adminPostService.getPosts.mockResolvedValue(listResult([], 1));
  adminPostService.getTags.mockResolvedValue({
    items: [{ id: 'tag-1', name: '标签一', slug: 'tag-one' }],
  });
  adminPostService.getPostTags.mockResolvedValue({ items: [] });
  adminPostService.createPost.mockResolvedValue({ id: 'created-post' });
  adminPostService.updatePost.mockResolvedValue({ id: 'updated-post' });
  adminPostService.syncPostTags.mockResolvedValue(undefined);
  mockedShowToast.mockClear();
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('PostManager · 列表错误可重试', () => {
  it('加载失败显示可重试的错误面板，而不是伪装成空列表', async () => {
    adminPostService.getPosts.mockRejectedValueOnce(forbidden);

    render(<PostManager />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('文章列表加载失败');
    expect(alert.textContent).toContain('没有执行该操作的权限');
    expect(screen.queryByText('暂无文章')).toBeNull();

    adminPostService.getPosts.mockResolvedValueOnce(listResult([post('1')], 1));
    fireEvent.click(within(alert).getByRole('button', { name: '重试' }));

    await waitFor(() => expect(screen.getByText('标题 1')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('筛选切换失败时清掉上一筛选项的文章，不拿旧结果冒充新结果', async () => {
    adminPostService.getPosts.mockResolvedValueOnce(listResult([post('all-1')], 1));

    render(<PostManager />);
    await waitFor(() => expect(screen.getByText('标题 all-1')).toBeTruthy());

    adminPostService.getPosts.mockRejectedValueOnce(new Error('网络异常'));
    fireEvent.click(screen.getByRole('button', { name: '草稿' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('文章列表加载失败');
    expect(screen.queryByText('标题 all-1')).toBeNull();
  });

  it('加载成功且确实没有数据时才显示空态', async () => {
    render(<PostManager />);

    await waitFor(() => expect(screen.getByText('暂无文章')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('翻页请求第 2 页并停留在第 2 页', async () => {
    adminPostService.getPosts.mockImplementation(async (targetPage = 1) =>
      listResult([post(`p${targetPage}`)], 3),
    );

    render(<PostManager />);
    await waitFor(() => expect(screen.getByText('标题 p1')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(screen.getByText('标题 p2')).toBeTruthy());
    expect(screen.getByText('PAGE / 2 / 3')).toBeTruthy();
    expect(adminPostService.getPosts).toHaveBeenLastCalledWith(2, 20, expect.any(Object));
  });
});

describe('PostManager · 未保存关闭确认', () => {
  it('空草稿取消直接关闭，不弹确认', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('新建草稿时也会加载可选标签', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    expect(await screen.findByRole('button', { name: '标签一' })).toBeTruthy();
  });

  it('有实质内容的草稿取消时弹确认；确认框取消可继续编辑；Esc 可再打开；确认后丢弃', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    const newButton = screen.getByRole('button', { name: '+ 新建文章' });
    newButton.focus();
    await openNewDraft();

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '未保存标题' } });

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('当前编辑有未保存的内容，关闭后这些修改会丢失。')).toBeTruthy();

    // 取消确认：回到编辑，内容还在
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(editorDialog()).not.toBeNull();
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('未保存标题');

    // Esc：再次弹确认
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('alertdialog');

    // 确认放弃：编辑器关闭，焦点回到打开编辑器前的「新建文章」
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(editorDialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(newButton));
  });

  it('点击编辑遮罩与取消一致：有内容时先确认', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '正文内容' } });
    const panel = screen.getByRole('dialog');
    fireEvent.click(panel.parentElement as HTMLElement);

    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    await waitFor(() => expect(editorDialog()).toBeNull());
  });

  it('空草稿按 Esc 直接关闭，不弹确认', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('PostManager · 弹窗焦点与滚动锁', () => {
  it('编辑弹窗打开后焦点进入，Tab 在首尾循环，关闭后归还给触发按钮', async () => {
    adminPostService.getPosts.mockResolvedValueOnce(listResult([post('1')], 1));

    render(<PostManager />);
    await waitFor(() => expect(screen.getByText('标题 1')).toBeTruthy());

    const editButton = screen.getByRole('button', { name: '编辑' });
    editButton.focus();
    fireEvent.click(editButton);

    await screen.findByRole('dialog');
    await waitFor(() =>
      expect(document.activeElement?.id).toBe('post-manager-title-field'),
    );
    expect(document.body.style.overflow).toBe('hidden');

    // 最后一个可聚焦控件是「保存文章」，Tab 回到第一个（AI 工具条按钮）
    const save = screen.getByRole('button', { name: '保存文章' });
    save.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement?.textContent).toContain('AI 标题/摘要/标签');

    // Shift+Tab 从第一个回到最后一个
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);

    // 无改动关闭：直接关闭并把焦点还给「编辑」
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(editorDialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(editButton));
    expect(document.body.style.overflow).toBe('');
  });

  it('媒体库弹窗焦点进入、Tab 循环、Esc 关闭归还焦点，滚动锁按层恢复', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    const selectButton = screen.getByRole('button', { name: '选择' });
    selectButton.focus();
    fireEvent.click(selectButton);

    const mediaDialog = await screen.findByRole('dialog', { name: '选择封面图片' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭'),
    );
    expect(document.body.style.overflow).toBe('hidden');

    const closeButton = within(mediaDialog).getByRole('button', { name: '关闭' });
    const lastButton = within(mediaDialog).getByRole('button', { name: '关闭媒体库' });
    lastButton.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(closeButton);

    // Esc 关闭媒体库：编辑弹窗仍在，焦点归还给「选择」
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '选择封面图片' })).toBeNull(),
    );
    expect(document.body.style.overflow).toBe('hidden');
    await waitFor(() => expect(document.activeElement).toBe(selectButton));

    // 关闭编辑弹窗后滚动锁恢复原值
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(document.body.style.overflow).toBe('');
  });

  it('媒体库选择仍会回填封面并标记未保存', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    await screen.findByRole('dialog', { name: '选择封面图片' });
    fireEvent.click(screen.getByRole('button', { name: '选择这个封面' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '选择封面图片' })).toBeNull(),
    );
    expect((screen.getByLabelText('封面') as HTMLInputElement).value).toBe('/covers/picked.png');

    // 已有封面内容 → 关闭需要确认
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await screen.findByRole('alertdialog');
  });
});

describe('PostManager · 保留保存与 AI', () => {
  it('保存按钮在同一时刻只提交一次', async () => {
    vi.spyOn(adminPostService, 'getPosts').mockResolvedValue(listResult([], 1));
    let resolveCreate: (value: never) => void = () => {};
    adminPostService.createPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (value: never) => void;
        }),
    );

    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '保存标题' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '保存正文' } });

    const saveButton = screen.getByRole('button', { name: '保存文章' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(adminPostService.createPost).toHaveBeenCalledTimes(1));
    const busy = screen.getByRole('button', { name: '保存中...' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      resolveCreate({ id: 'created-post' } as never);
    });
    await waitFor(() => expect(editorDialog()).toBeNull());
  });

  it('AI 标题建议仍可回填到编辑表单', async () => {
    aiAssist.runMeta.mockResolvedValue({
      titles: ['AI 建议标题'],
      excerpt: 'AI 摘要',
      tag_names: ['标签一'],
      seo_description: 'AI SEO',
    });

    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '原标题' } });
    fireEvent.click(screen.getByRole('button', { name: 'AI 标题/摘要/标签' }));

    const suggestion = await screen.findByRole('button', { name: 'AI 建议标题' });
    fireEvent.click(suggestion);

    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('AI 建议标题');
  });
});

describe('PostManager · 顶层弹窗不抢键盘', () => {
  /** 模拟 AdminGuard 常驻在页面之外的 StepUpRecoveryModal（role=dialog + aria-modal + 更高层级遮罩） */
  function mountExternalStepUp(overlayZIndex = 80) {
    const host = document.createElement('div');
    // 真实组件的 z-[80] 在 role=dialog 的父层遮罩上，dialog 自身没有 z-index
    host.innerHTML =
      `<div style="z-index: ${overlayZIndex}">` +
      '<div role="dialog" aria-modal="true" aria-label="重新验证动态口令">' +
      '<input aria-label="6 位动态码" />' +
      '<button type="button">验证</button>' +
      '</div></div>';
    document.body.appendChild(host);
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const input = within(dialog).getByLabelText('6 位动态码') as HTMLInputElement;
    return { host, dialog, input };
  }

  it('外部 step-up 在上层时，Esc / Tab 都不被 PostManager 抢走', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '编辑中的文章' } });

    const { host, dialog, input } = mountExternalStepUp();
    input.focus();
    expect(document.activeElement).toBe(input);

    // Esc：不得 preventDefault（事件要留给顶层 dialog），编辑器不得关闭/弹确认
    const escNotPrevented = fireEvent.keyDown(document, { key: 'Escape' });
    expect(escNotPrevented).toBe(true);
    expect(screen.getByRole('dialog', { name: '新建文章' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // Tab：不得抢焦点回编辑器，事件保持默认行为
    const tabNotPrevented = fireEvent.keyDown(document, { key: 'Tab' });
    expect(tabNotPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(dialog.contains(document.activeElement)).toBe(true);

    host.remove();
  });

  it('确认框退出动画期间不吞 Esc：PostManager 会重新接管键盘', async () => {
    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '未保存标题' } });

    // Esc 打开确认框
    fireEvent.keyDown(document, { key: 'Escape' });
    const confirm = await screen.findByRole('alertdialog');

    // 取消确认框：它开始退出动画（节点可能还在，但 document 监听已移除）
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));

    // 此时 Esc 必须被 PostManager 重新接管（preventDefault），不能让退出中的 alertdialog 把键吞掉
    const escHandled = fireEvent.keyDown(document, { key: 'Escape' });
    expect(escHandled).toBe(false);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});

describe('PostManager · 保存进行中不可关闭', () => {
  it('保存中 Esc / 取消 / 点击遮罩都被拒绝并提示，编辑内容保留', async () => {
    let resolveCreate: (value: never) => void = () => {};
    adminPostService.createPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (value: never) => void;
        }),
    );

    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '保存中的标题' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '保存中的正文' } });

    fireEvent.click(screen.getByRole('button', { name: '保存文章' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存中...' })).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    const editor = screen.getByRole('dialog', { name: '新建文章' });
    fireEvent.click(editor.parentElement as HTMLElement);

    // 三种关闭入口都被拒绝：仍在编辑、没有确认框、标题内容不丢
    expect(screen.getByRole('dialog', { name: '新建文章' })).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('保存中的标题');
    expect(mockedShowToast).toHaveBeenCalledTimes(3);
    expect(mockedShowToast).toHaveBeenCalledWith('文章保存中，完成后才能关闭', 'warning');

    // 保存完成后（仍是同一篇草稿）才真正关闭
    await act(async () => {
      resolveCreate({ id: 'created-post' } as never);
    });
    await waitFor(() => expect(editorDialog()).toBeNull());
  });

  it('保存完成时若用户已打开另一篇，不按保存结果误关新文章', async () => {
    let resolveCreate: (value: never) => void = () => {};
    adminPostService.createPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve as (value: never) => void;
        }),
    );

    render(<PostManager />);
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    await openNewDraft();

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '正在保存的文章' } });
    fireEvent.change(screen.getByLabelText('内容'), { target: { value: '正文' } });
    fireEvent.click(screen.getByRole('button', { name: '保存文章' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存中...' })).toBeTruthy());

    // 模拟保存期间用户又开了一篇新文章（例如工具栏/快捷键）
    fireEvent.click(screen.getByRole('button', { name: '+ 新建文章' }));
    await waitFor(() =>
      expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe(''),
    );

    await act(async () => {
      resolveCreate({ id: 'created-post' } as never);
    });

    // 保存结果属于上一篇：不能把当前新草稿关掉
    await waitFor(() => expect(screen.getByRole('dialog', { name: '新建文章' })).toBeTruthy());
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('');
  });
});

describe('PostManager · 翻页失败可恢复', () => {
  it('第 2 页失败时清空旧页但保留可回退分页，并可回到第 1 页恢复', async () => {
    adminPostService.getPosts.mockImplementation(async (targetPage = 1) => {
      if (targetPage === 2) throw new Error('网络异常');
      return listResult([post(`p${targetPage}`)], 3) as never;
    });

    render(<PostManager />);
    await waitFor(() => expect(screen.getByText('标题 p1')).toBeTruthy());
    expect(screen.getByText('PAGE / 1 / 3')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('文章列表加载失败');
    expect(alert.textContent).toContain('网络异常');
    // 旧页数据清掉，但分页还在：不会困在第 2 页且无路可退
    expect(screen.queryByText('标题 p1')).toBeNull();
    expect(screen.getByText('PAGE / 2 / 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: '上一页' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '上一页' }));

    await waitFor(() => expect(screen.getByText('标题 p1')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('翻页失败时错误面板提供「返回第 1 页」的安全出口', async () => {
    adminPostService.getPosts.mockImplementation(async (targetPage = 1) => {
      if (targetPage === 2) throw new Error('网络异常');
      return listResult([post(`p${targetPage}`)], 3) as never;
    });

    render(<PostManager />);
    await waitFor(() => expect(screen.getByText('标题 p1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: '返回第 1 页' }));

    await waitFor(() => expect(screen.getByText('标题 p1')).toBeTruthy());
    expect(screen.getByText('PAGE / 1 / 3')).toBeTruthy();
  });
});

/**
 * Markdown 写作台契约：编辑/预览 tab、格式化工具条、快捷键、AI 写入、
 * 媒体库插图。预览走真实的 `lib/markdown.ts` 渲染管线（marked + hljs + 净化），
 * 因此这里同时验证「预览产物与新渲染管线一致」。
 */
describe('PostManager · Markdown 写作台', () => {
  const contentBox = () => screen.getByLabelText('内容') as HTMLTextAreaElement;

  const openEditor = async () => {
    await waitFor(() => expect(adminPostService.getPosts).toHaveBeenCalled());
    return openNewDraft();
  };

  /** 用 fireEvent.change 设定正文，并把光标放到末尾（等价于用户输入完） */
  const typeContent = (value: string) => {
    fireEvent.change(contentBox(), { target: { value } });
    contentBox().setSelectionRange(0, value.length);
  };

  it('预览 tab 使用同一渲染管线输出代码块（pre > code）与标题', async () => {
    render(<PostManager />);
    await openEditor();

    const markdown = '## 预览标题\n\n```js\nconst answer = 42;\n```';
    fireEvent.change(contentBox(), { target: { value: markdown } });

    // 默认编辑 tab：预览不渲染，也不产生额外网络/保存行为
    expect(screen.getByRole('tab', { name: '编辑' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('markdown-preview')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: '预览' }));

    const preview = await screen.findByTestId('markdown-preview');
    expect(screen.getByRole('tab', { name: '预览' }).getAttribute('aria-selected')).toBe('true');
    expect(preview.querySelector('pre')).not.toBeNull();
    const code = preview.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain('const answer = 42;');
    expect(preview.querySelector('h2')?.textContent).toBe('预览标题');
    expect(adminPostService.createPost).not.toHaveBeenCalled();

    // 切回编辑：正文完全没被预览改动
    fireEvent.click(screen.getByRole('tab', { name: '编辑' }));
    expect(contentBox().value).toBe(markdown);
  });

  it('tablist 支持方向键切换：aria-selected 与焦点同步到新 tab', async () => {
    render(<PostManager />);
    await openEditor();

    fireEvent.change(contentBox(), { target: { value: '## 方向键切换' } });

    const editTab = screen.getByRole('tab', { name: '编辑' });
    editTab.focus();
    fireEvent.keyDown(editTab, { key: 'ArrowRight' });

    const previewTab = screen.getByRole('tab', { name: '预览' });
    expect(previewTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(previewTab);
    expect(screen.getByTestId('markdown-preview').querySelector('h2')?.textContent).toBe('方向键切换');

    fireEvent.keyDown(previewTab, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '编辑' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '编辑' }));
  });

  it('预览不改变 dirty：无改动文章切到预览后直接关闭，不弹放弃确认', async () => {
    adminPostService.getPosts.mockResolvedValueOnce(
      listResult([post('preview-1', { content: '```js\nconst a = 1;\n```' })], 1),
    );

    render(<PostManager />);
    await waitFor(() => expect(screen.getByText('标题 preview-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('tab', { name: '预览' }));
    const preview = await screen.findByTestId('markdown-preview');
    expect(preview.querySelector('pre code')?.textContent).toContain('const a = 1;');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('工具条：加粗包裹选区，代码块按所选语言插入围栏', async () => {
    render(<PostManager />);
    await openEditor();

    fireEvent.change(contentBox(), { target: { value: 'hello world' } });
    contentBox().setSelectionRange(6, 11);
    fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(contentBox().value).toBe('hello **world**');
    // 选区落在包裹内部，继续输入可替换原文
    expect(contentBox().selectionStart).toBe(8);
    expect(contentBox().selectionEnd).toBe(13);

    // 代码块：默认语言 text，切换语言后写进围栏
    fireEvent.change(contentBox(), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('代码块语言'), { target: { value: 'python' } });
    fireEvent.click(screen.getByRole('button', { name: '代码块' }));
    expect(contentBox().value).toBe('```python\n\n```');
  });

  it('快捷键 Ctrl/Cmd+B/I/K/E 与 Shift+Enter 按选区插入 Markdown', async () => {
    render(<PostManager />);
    await openEditor();

    typeContent('abc');
    fireEvent.keyDown(contentBox(), { key: 'b', ctrlKey: true });
    expect(contentBox().value).toBe('**abc**');

    typeContent('abc');
    fireEvent.keyDown(contentBox(), { key: 'i', ctrlKey: true });
    expect(contentBox().value).toBe('*abc*');

    typeContent('abc');
    fireEvent.keyDown(contentBox(), { key: 'k', ctrlKey: true });
    expect(contentBox().value).toBe('[abc](https://)');

    typeContent('abc');
    fireEvent.keyDown(contentBox(), { key: 'e', metaKey: true });
    expect(contentBox().value).toBe('`abc`');

    typeContent('');
    fireEvent.keyDown(contentBox(), { key: 'Enter', shiftKey: true });
    expect(contentBox().value).toBe('```text\n\n```');
  });

  it('输入法组合期间不触发格式化快捷键', async () => {
    render(<PostManager />);
    await openEditor();

    typeContent('中文输入中');
    fireEvent.keyDown(contentBox(), { key: 'b', ctrlKey: true, isComposing: true });
    expect(contentBox().value).toBe('中文输入中');

    // 组合结束后的同一快捷键恢复正常
    fireEvent.keyDown(contentBox(), { key: 'b', ctrlKey: true });
    expect(contentBox().value).toBe('**中文输入中**');
  });

  it('AI 润色成功：只替换正文选区、结果选中，其它未保存字段不受影响', async () => {
    aiAssist.runPolish.mockResolvedValue({ text: '润色后的文字' });

    render(<PostManager />);
    await openEditor();

    fireEvent.change(contentBox(), { target: { value: '原始文字 保留结尾' } });
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '未保存的标题' } });
    contentBox().setSelectionRange(0, 4);

    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));

    await waitFor(() => expect(contentBox().value).toBe('润色后的文字 保留结尾'));
    expect(aiAssist.runPolish).toHaveBeenCalledWith('原始文字');
    expect((screen.getByLabelText('标题') as HTMLInputElement).value).toBe('未保存的标题');
    expect(contentBox().selectionStart).toBe(0);
    expect(contentBox().selectionEnd).toBe('润色后的文字'.length);

    // 已标记 dirty：关闭时需要确认（不会被 AI 写入重置为「干净」）
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await screen.findByRole('alertdialog');
  });

  it('AI 失败：toast 显示服务端错误（含 step-up 过期），正文保持原样', async () => {
    aiAssist.runPolish.mockRejectedValueOnce(new Error('AI 服务暂时不可用，请稍后重试'));

    render(<PostManager />);
    await openEditor();
    typeContent('保持原样的正文');
    contentBox().setSelectionRange(0, 5);

    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));

    await waitFor(() =>
      expect(mockedShowToast).toHaveBeenCalledWith('AI 服务暂时不可用，请稍后重试', 'error'),
    );
    expect(contentBox().value).toBe('保持原样的正文');

    // step-up 过期由 service 翻译成中文提示，组件原样透出
    aiAssist.runPolish.mockRejectedValueOnce(
      new Error('管理会话已过期，请在弹出的验证框中重新输入动态口令'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'AI 润色' }));

    await waitFor(() =>
      expect(mockedShowToast).toHaveBeenCalledWith(
        '管理会话已过期，请在弹出的验证框中重新输入动态口令',
        'error',
      ),
    );
    expect(contentBox().value).toBe('保持原样的正文');
  });

  it('工具条图片按钮复用媒体库，按打开前的光标位置插入 Markdown 图片', async () => {
    render(<PostManager />);
    await openEditor();

    fireEvent.change(contentBox(), { target: { value: '开头\n\n结尾' } });
    // '开头' 是 2 个字符：光标放在它后面（第一个换行之前）
    contentBox().setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole('button', { name: '图片' }));

    const picker = await screen.findByRole('dialog', { name: '选择正文图片' });
    fireEvent.click(within(picker).getByRole('button', { name: '选择这个封面' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '选择正文图片' })).toBeNull(),
    );
    // alt 从文件名回退（媒体库只回传 URL），语法与新渲染管线一致
    expect(contentBox().value).toBe('开头![picked](/covers/picked.png)\n\n结尾');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await screen.findByRole('alertdialog');
  });
});
