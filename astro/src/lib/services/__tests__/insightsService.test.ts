import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 数据洞察 · 互动聚合接口契约。
 *
 * 背景（2026-11 生产缺陷回归）：`reactions` 集合匿名读返回 403 Only admins。
 * 旧实现由前端直连 posts / reactions / comments 三个集合聚合，一次 403 就让
 * getTopPosts() 整体 reject，看板永远停在「统计数据暂不可用」。
 *
 * 新契约：
 * 1. 互动排行只走公开聚合接口 `GET /api/post-engagement?limit=N`，不再请求 reactions 集合；
 * 2. 接口失败时 getTopPosts() 返回空数组（不 reject），availability.posts=false；
 * 3. 总览仍走 /api/blog-stats，两者用 Promise.allSettled 独立收敛；
 * 4. 接口字段缺失/类型异常时按 0 兜底，一条脏数据不打掉整个排行榜。
 */

const { pbState } = vi.hoisted(() => ({
  pbState: { client: null as unknown },
}));

vi.mock('../../pocketbase', () => ({
  getPocketBase: () => pbState.client,
}));

import { insightsService, mapPostEngagementFeed } from '../insightsService';

const POST_HOT = 'bbbbbbbbbbbbbbb';
const POST_COLD = 'aaaaaaaaaaaaaaa';

const statsPayload = {
  range: '7d',
  totalViews: 910,
  todayViews: 12,
  uniqueVisitors: 7,
  daily: [{ date: '2026-11-22', views: 910 }],
  topPages: [{ path: '/posts/hot', views: 900 }],
  topReferrers: [{ referrer: 'https://example.com', views: 5 }],
  detail: { uaCategories: [{ category: 'desktop', views: 900 }] },
};

const engagementPayload = {
  items: [
    { postId: POST_HOT, title: '高热度文章', views: 900, reactions: 2, comments: 1, score: 911 },
    { postId: POST_COLD, title: '低热度文章', views: 10, reactions: 0, comments: 0, score: 10 },
  ],
  generatedAt: '2026-11-22 10:00:00.000Z',
};

interface FakePbConfig {
  engagement?: unknown | Error;
  stats?: unknown | Error;
}

/** 极简 PocketBase 替身：只实现 insightsService 用到的 send；未预期的集合调用会直接失败。 */
function makeFakePb(config: FakePbConfig = {}) {
  const sent: string[] = [];
  return {
    sent,
    send: (path: string) => {
      sent.push(path);
      if (path.startsWith('/api/blog-stats')) {
        return config.stats instanceof Error ? Promise.reject(config.stats) : Promise.resolve(config.stats ?? statsPayload);
      }
      if (path.startsWith('/api/post-engagement')) {
        return config.engagement instanceof Error
          ? Promise.reject(config.engagement)
          : Promise.resolve(config.engagement ?? { items: [] });
      }
      return Promise.reject(new Error(`unexpected path: ${path}`));
    },
  };
}

afterEach(() => {
  pbState.client = null;
  vi.restoreAllMocks();
});

describe('insightsService · /api/post-engagement 对接', () => {
  it('getTopPosts 只调用公开互动接口，并映射为 PostEngagement 结构', async () => {
    const fake = makeFakePb({ engagement: engagementPayload });
    pbState.client = fake;

    const topPosts = await insightsService.getTopPosts(10);

    expect(fake.sent).toContain('/api/post-engagement?limit=10');
    expect(fake.sent.some((path) => path.startsWith('/api/blog-stats'))).toBe(false);
    expect(topPosts).toEqual([
      { postId: POST_HOT, title: '高热度文章', views: 900, reactions: 2, comments: 1, score: 911 },
      { postId: POST_COLD, title: '低热度文章', views: 10, reactions: 0, comments: 0, score: 10 },
    ]);
  });

  it('接口失败时 getTopPosts 返回空数组而不是 reject', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({ engagement: new Error('engagement endpoint down') });

    await expect(insightsService.getTopPosts(10)).resolves.toEqual([]);
  });

  it('请求条数收敛在接口上限内（避免被当成翻页参数滥用）', async () => {
    const fake = makeFakePb({ engagement: { items: [] } });
    pbState.client = fake;

    await insightsService.getTopPosts(9999);

    expect(fake.sent).toContain('/api/post-engagement?limit=50');
  });

  it('score 缺失时按 views*1 + reactions*3 + comments*5 兜底并按分数排序', async () => {
    pbState.client = makeFakePb({
      engagement: {
        items: [
          { postId: POST_COLD, title: '低热度', views: 10, reactions: 0, comments: 0 },
          { postId: POST_HOT, title: '高热度', views: 900, reactions: 2, comments: 1 },
        ],
      },
    });

    const topPosts = await insightsService.getTopPosts(10);

    expect(topPosts.map((post) => post.postId)).toEqual([POST_HOT, POST_COLD]);
    expect(topPosts[0].score).toBe(911);
    expect(topPosts[1].score).toBe(10);
  });
});

describe('insightsService · 脏数据收敛', () => {
  it('字段缺失/类型异常时按 0 处理，无 postId 的条目被丢弃', () => {
    const mapped = mapPostEngagementFeed([
      { postId: POST_HOT, title: '正常', views: '900', reactions: '2', comments: 1, score: '911' },
      { postId: POST_COLD, views: null, reactions: undefined, comments: 'abc' },
      { title: '没有 postId' },
      null,
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({ postId: POST_HOT, views: 900, reactions: 2, comments: 1, score: 911 });
    expect(mapped[1]).toMatchObject({ postId: POST_COLD, title: '（无标题）', views: 0, reactions: 0, comments: 0, score: 0 });
  });
});

describe('insightsService · 统计与互动独立失败', () => {
  it('/api/blog-stats 失败时 stats 为 null，topPosts 仍返回', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({ engagement: engagementPayload, stats: new Error('stats endpoint down') });

    const snapshot = await insightsService.getInsightsSnapshot();

    expect(snapshot.stats).toBeNull();
    expect(snapshot.availability.stats).toBe(false);
    expect(snapshot.topPosts).toHaveLength(2);
    expect(snapshot.partial).toBe(true);
  });

  it('互动接口失败时统计总览照常返回，topPosts 为空且 availability.posts=false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({ engagement: new Error('engagement endpoint down'), stats: statsPayload });

    const snapshot = await insightsService.getInsightsSnapshot();

    expect(snapshot.stats?.totalViews).toBe(910);
    expect(snapshot.topPosts).toEqual([]);
    expect(snapshot.availability.posts).toBe(false);
    expect(snapshot.availability.stats).toBe(true);
    expect(snapshot.partial).toBe(true);
  });

  it('两者都可用时 partial=false', async () => {
    pbState.client = makeFakePb({ engagement: engagementPayload, stats: statsPayload });

    const snapshot = await insightsService.getInsightsSnapshot();

    expect(snapshot.availability).toEqual({ stats: true, posts: true, reactions: true, comments: true });
    expect(snapshot.partial).toBe(false);
  });
});
