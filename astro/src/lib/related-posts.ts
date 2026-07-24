/**
 * 相关文章推荐算法 -- 基于共享标签数计算文章相似度。
 *
 * 纯函数，无副作用，可被 RelatedPosts 组件或 SSR 端调用。
 * 不修改任何现有组件（遵守资产保全协议）。
 *
 * 注意：PocketBase 的 posts 表没有 tags 字段，标签通过 post_tags 关系表关联。
 * 调用方需先通过 post_tags 查询获取每篇文章的 tag slug 数组，再传入此函数。
 */

import type { Post } from '../types/pocketbase';

interface PostWithTags extends Post {
  /** 从 post_tags 关系表映射而来的 tag slug 数组 */
  tagSlugs?: string[];
}

export function computeRelatedPosts(
  current: PostWithTags,
  all: PostWithTags[],
  limit = 3
): PostWithTags[] {
  const currentTags = new Set(current.tagSlugs || []);
  if (!currentTags.size) return [];

  return all
    .filter((p) => p.id !== current.id && p.status === 'published')
    .map((p) => {
      const pTags = new Set(p.tagSlugs || []);
      const shared = [...currentTags].filter((t) => pTags.has(t)).length;
      // 时间衰减仅用于同分排序（shared 相同时近期文章优先），不影响是否入选
      const recency = p.published_at ? new Date(p.published_at).getTime() / 1e12 : 0;
      return { post: p, score: shared, recency };
    })
    // 仅推荐有共享标签的文章（shared > 0）
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.recency - a.recency)
    .slice(0, limit)
    .map((x) => x.post);
}
