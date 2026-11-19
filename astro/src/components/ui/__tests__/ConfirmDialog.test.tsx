import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import ConfirmDialog from '../ConfirmDialog';

/**
 * Task B 行为契约：ConfirmDialog 的键盘与焦点必须可靠。
 *
 * 现状问题：
 * - Esc / Tab 处理挂在遮罩 div 的 onKeyDown 上，只有焦点恰好在遮罩内部时才生效；
 *   焦点跑到 document 上时 Esc 不关闭；
 * - 两个按钮没有 `type="button"`，被嵌进 <form> 时会变成隐式 submit；
 * - 关闭后没有把焦点归还给打开弹窗前的元素（元素被移除时也未做保护）。
 */

const dialog = () => screen.queryByRole('alertdialog');

function Harness({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = React.useState(initialOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开确认
      </button>
      <button type="button">外部元素</button>
      <ConfirmDialog
        open={open}
        title="确认操作"
        message="确定继续吗？"
        confirmLabel="继续"
        cancelLabel="返回"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

afterEach(cleanup);

describe('ConfirmDialog · 焦点与键盘', () => {
  it('打开后焦点进入弹窗（首个可聚焦控件），关闭后归还给触发元素', async () => {
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '打开确认' });
    trigger.focus();
    fireEvent.click(trigger);

    const cancel = await screen.findByRole('button', { name: '返回' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    fireEvent.click(cancel);
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('焦点在弹窗之外时，document 级 Esc 仍会触发取消', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '打开确认' }));
    await screen.findByRole('alertdialog');

    // 模拟焦点逃逸到 document（例如浏览器把焦点还给 body）
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('Tab / Shift+Tab 在首尾控件之间循环', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开确认' }));

    const cancel = await screen.findByRole('button', { name: '返回' });
    const confirm = await screen.findByRole('button', { name: '继续' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    // Shift+Tab：首个 → 最后一个
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    // Tab：最后一个 → 首个
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // 焦点逃逸到弹窗之外后按 Tab：拉回第一个
    const outside = screen.getByRole('button', { name: '外部元素' });
    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
  });

  it('点击遮罩取消，点击弹窗面板不取消', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开确认' }));

    const panel = await screen.findByRole('alertdialog');
    fireEvent.click(panel);
    expect(dialog()).not.toBeNull();

    fireEvent.click(panel.parentElement as HTMLElement);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  it('按钮显式 type="button"，嵌在表单里不会触发隐式提交', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ConfirmDialog
          open
          title="确认操作"
          message="确定继续吗？"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </form>,
    );

    const confirm = await screen.findByRole('button', { name: '确认' });
    const cancel = await screen.findByRole('button', { name: '取消' });
    expect(confirm.getAttribute('type')).toBe('button');
    expect(cancel.getAttribute('type')).toBe('button');

    fireEvent.click(confirm);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
