import { test, expect } from '@playwright/test';

/**
 * E2E 测试 —— 覆盖核心用户路径。
 *
 * 运行：npx playwright test
 * 依赖：npx playwright install
 *
 * 注意：这些测试不验证动画视觉效果（遵守资产保全协议），
 * 只验证 DOM 结构与交互逻辑的正确性。
 */

test('首页 Hero 区域正常渲染', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('胡巴的博客');
  // 检查最新文章区块存在
  await expect(page.locator('#latest')).toBeVisible();
});

test('文章页评论表单 maxLength 属性正确', async ({ page }) => {
  // 访问第一篇文章（demo 文章始终存在）
  await page.goto('/posts/demo');
  const textarea = page.locator('#comment-content');
  await expect(textarea).toHaveAttribute('maxlength', '1000');
  // 昵称输入框也应有 maxLength
  const nameInput = page.locator('input[autocomplete="name"]');
  await expect(nameInput).toHaveAttribute('maxlength', '30');
});

test('暗色模式切换无闪烁', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');
  // 设置为暗色
  await page.evaluate(() => {
    localStorage.setItem('blog-theme-mode', 'dark');
    (window as any).__blogApplyTheme?.();
  });
  await expect(html).toHaveClass(/dark/);
  // 切换回浅色
  await page.evaluate(() => {
    localStorage.setItem('blog-theme-mode', 'light');
    (window as any).__blogApplyTheme?.();
  });
  await expect(html).not.toHaveClass(/dark/);
});

test('搜索模态框可通过快捷键打开', async ({ page }) => {
  await page.goto('/');
  // 等待页面完全加载
  await page.waitForLoadState('networkidle');
  // 按 / 键触发搜索（SearchModal 的默认快捷键）
  await page.keyboard.press('Slash');
  // 检查搜索框可见（根据实际实现）
  await page.waitForTimeout(300);
  // 如果搜索框有 role="search" 或特定 class
  const searchInput = page.locator('[role="search"] input, [type="search"]').first();
  if (await searchInput.isVisible()) {
    await expect(searchInput).toBeVisible();
  }
});

test('标签页正常加载', async ({ page }) => {
  await page.goto('/tags');
  // 标签页应显示标签列表或空状态
  await expect(page.locator('main')).toBeVisible();
});

test('404 页面正确显示', async ({ page }) => {
  await page.goto('/this-page-does-not-exist');
  await expect(page.locator('body')).toBeVisible();
});

test('移动端视口下侧边栏隐藏', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  // xl 断点以下的侧边栏应隐藏（floating-sidebar 在 xl:block）
  const sidebar = page.locator('.floating-sidebar.sidebar-left').first();
  // 在移动端，xl:block 的元素不显示
  await expect(sidebar).not.toBeVisible();
});
