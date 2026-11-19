import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

import PostCard from './PostCard';
import type { Post, PostTag } from '../../types/pocketbase';

/**
 * PostCard 回归测试：阅读路径改造后卡片收敛为「编号行 + 细线分隔」。
 *
 * 设计约束（docs/superpowers/specs/2026-11-19-orbital-log-frontend-redesign.md）：
 *   - 编号索引替代卡片网格，序号两位等宽，可跨分页连续；
 *   - 保留真实标题 / 日期 / 摘要 / 阅读时长 / 封面缩略，不虚构数据；
 *   - 整行仍是单个链接，键盘可达、有可读的 aria-label；
 *   - 标签只来自既有的 post_tags 关系（expand.tag_id），不伪造记录里不存在的字段。
 *
 * 这里锁定的都是「改造后仍必须成立」的行为契约，而不是像素级样式。
 */

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'post-1',
    title: '编号行里的真实标题',
    slug: 'numbered-row-post',
    content: 'x'.repeat(600), // 600 字 → 2 分钟阅读
    excerpt: '这是文章摘要，用于确认摘要仍然渲染。',
    cover: '',
    status: 'published',
    author: 'user-1',
    published_at: '2026-01-02T03:04:05.000Z',
    views: 0,
    created: '2026-01-02T03:04:05.000Z',
    updated: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function makeTag(name: string): PostTag {
  return {
    id: 'pt-1',
    post_id: 'post-1',
    tag_id: 'tag-1',
    created: '2026-01-02T03:04:05.000Z',
    updated: '2026-01-02T03:04:05.000Z',
    expand: {
      tag_id: {
        id: 'tag-1',
        name,
        slug: 'tag-1',
        description: '',
        created: '2026-01-02T03:04:05.000Z',
        updated: '2026-01-02T03:04:05.000Z',
      },
    },
  };
}

describe('PostCard（编号行）', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('默认按 index 生成两位编号', () => {
    render(<PostCard post={makePost()} index={0} />);
    expect(screen.getByText('01')).toBeTruthy();
  });

  it('ordinal 覆盖默认编号，供分页跨页连续编号', () => {
    render(<PostCard post={makePost()} index={0} ordinal={13} />);
    expect(screen.getByText('13')).toBeTruthy();
    expect(screen.queryByText('01')).toBeNull();
  });

  it('保留真实标题、日期与摘要', () => {
    const post = makePost();
    render(<PostCard post={post} />);

    expect(screen.getByText(post.title)).toBeTruthy();
    expect(screen.getByText(post.excerpt)).toBeTruthy();

    const time = document.querySelector('time');
    expect(time).not.toBeNull();
    expect(time?.getAttribute('datetime')).toBe(post.published_at);
  });

  it('阅读时长按正文字数计算，且至少 1 分钟', () => {
    render(<PostCard post={makePost({ content: 'x'.repeat(600) })} />);
    expect(screen.getByText('2 分钟阅读')).toBeTruthy();

    cleanup();

    render(<PostCard post={makePost({ content: '' })} />);
    expect(screen.getByText('1 分钟阅读')).toBeTruthy();
  });

  it('保留封面缩略图，无封面时不渲染图片', () => {
    render(
      <PostCard post={makePost({ cover: 'https://cdn.example.com/cover.png' })} />,
    );
    const img = screen.getByRole('img');
    expect(img.getAttribute('alt')).toBe('编号行里的真实标题');
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/cover.png');

    cleanup();

    render(<PostCard post={makePost({ cover: '' })} />);
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('整行是单个链接，带可读的 aria-label', () => {
    render(<PostCard post={makePost()} />);

    const link = screen.getByRole('link', { name: '阅读文章：编号行里的真实标题' });
    expect(link.getAttribute('href')).toBe('/posts/numbered-row-post');
  });

  it('保留标签徽标（expand.post_tags 首个标签）', () => {
    render(
      <PostCard
        post={makePost({
          expand: {
            'post_tags(post_id)': [makeTag('前端工程')],
          },
        })}
      />,
    );

    expect(screen.getByText('前端工程')).toBeTruthy();
  });

  it('按 post_tags 关系展示全部关联标签（不止第一个）', () => {
    render(
      <PostCard
        post={makePost({
          expand: {
            'post_tags(post_id)': [makeTag('前端工程'), makeTag('Astro')],
          },
        })}
      />,
    );

    expect(screen.getByText('前端工程')).toBeTruthy();
    expect(screen.getByText('Astro')).toBeTruthy();
  });

  it('没有 post_tags 关系数据时不渲染标签（不用记录自身 name 伪造）', () => {
    // 只有关系记录、没有 expand.tag_id：真实数据里拿不到标签名，就不能编一个。
    const relationWithoutTag: PostTag = {
      id: 'pt-1',
      post_id: 'post-1',
      tag_id: 'tag-1',
      created: '2026-01-02T03:04:05.000Z',
      updated: '2026-01-02T03:04:05.000Z',
    };

    render(
      <PostCard
        post={makePost({
          expand: {
            'post_tags(post_id)': [
              { ...relationWithoutTag, name: '伪造标签' } as unknown as PostTag,
            ],
          },
        })}
      />,
    );

    expect(screen.queryByText('伪造标签')).toBeNull();
    expect(screen.queryByText('tag-1')).toBeNull();
  });

  it('无摘要时不渲染摘要段落', () => {
    render(<PostCard post={makePost({ excerpt: '' })} />);
    expect(screen.queryByText('这是文章摘要，用于确认摘要仍然渲染。')).toBeNull();
  });

  it('序号与标题文本都被链接包裹（整行可点击）', () => {
    const { container } = render(<PostCard post={makePost()} />);
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('01');
    expect(link?.textContent).toContain('编号行里的真实标题');
  });
});
