import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 数据洞察容错聚合契约（2026-11 生产缺陷回归）。
 *
 * 生产实测：`reactions` 集合匿名读返回 403 Only admins。
 * 旧实现把 posts / reactions / comments 串行 await，一次 403 就让
 * getTopPosts() 整体 reject，配合 useInsights 的 Promise.all 使 stats 恒为 null，
 * 后台看板永远显示「统计数据暂不可用」。
 *
 * 新契约：
 * 1. reactions / comments 失败只把对应计数降级为 0，其余照常返回；
 * 2. reactions 403 时热门排行仍按 views 排序（score 只用 views）；
 * 3. /api/blog-stats 失败时互动排行仍可用（快照 stats=null，topPosts 保留）；
 * 4. 降级范围写进 availability，供 UI 展示「部分互动数据不可用」。
 */

const { pbState } = vi.hoisted(() => ({
  pbState: { client: null as unknown },
}));

vi.mock('../../pocketbase', () => ({
  getPocketBase: () => pbState.client,
}));

import { insightsService } from '../insightsService';

interface FakeRecord {
  id: string;
  [key: string]: unknown;
}

interface FakePbConfig {
  posts: FakeRecord[];
  reactions: FakeRecord[] | Error;
  comments: FakeRecord[] | Error;
  stats?: unknown | Error;
  publishedIds?: string[];
  /** 模拟 posts 集合整体不可读（连已发布文章 id 列表都拿不到） */
  postsFail?: boolean;
}

/** 极简 PocketBase 替身：只实现 insightsService 用到的 filter / collection.getList / send。 */
function makeFakePb(config: FakePbConfig) {
  const calls: { collection: string; page: number; perPage: number; options?: Record<string, unknown> }[] = [];

  const toResult = (items: FakeRecord[]) => ({
    page: 1,
    perPage: items.length,
    totalItems: items.length,
    totalPages: 1,
    items,
  });

  const resolveCollection = (name: string) => {
    if (name === 'posts') {
      // getTopPosts 先查已发布文章 id（fields: 'id'），再按 id 查标题/浏览量
      return (page: number, perPage: number, options?: Record<string, unknown>) => {
        calls.push({ collection: name, page, perPage, options });
        if (config.postsFail) return Promise.reject(new Error('posts down'));
        if (options?.fields === 'id') {
          const ids = config.publishedIds ?? config.posts.map((p) => p.id);
          return Promise.resolve(toResult(ids.map((id) => ({ id }))));
        }
        return Promise.resolve(toResult(config.posts));
      };
    }
    if (name === 'reactions') {
      return (page: number, perPage: number, options?: Record<string, unknown>) => {
        calls.push({ collection: name, page, perPage, options });
        return config.reactions instanceof Error
          ? Promise.reject(config.reactions)
          : Promise.resolve(toResult(config.reactions));
      };
    }
    if (name === 'comments') {
      return (page: number, perPage: number, options?: Record<string, unknown>) => {
        calls.push({ collection: name, page, perPage, options });
        return config.comments instanceof Error
          ? Promise.reject(config.comments)
          : Promise.resolve(toResult(config.comments));
      };
    }
    return () => Promise.reject(new Error(`unexpected collection: ${name}`));
  };

  return {
    calls,
    filter: (template: string, params: Record<string, unknown> = {}) =>
      template.replace(/\{:(\w+)\}/g, (_m, key: string) => String(params[key] ?? '')),
    collection: (name: string) => ({ getList: resolveCollection(name) }),
    send: () => {
      if (config.stats instanceof Error) return Promise.reject(config.stats);
      return Promise.resolve(config.stats ?? {});
    },
  };
}

const POST_A = 'aaaaaaaaaaaaaaa';
const POST_B = 'bbbbbbbbbbbbbbb';

const posts = [
  { id: POST_A, title: '低热度文章', views: 10 },
  { id: POST_B, title: '高热度文章', views: 900 },
];

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

/** 后端真实返回形态：PocketBase ClientResponseError（status 403, message 'Only admins'） */
function forbidden(): Error {
  return Object.assign(new Error('Only admins can access this collection.'), {
    status: 403,
    response: { code: 403, message: 'Only admins can access this collection.' },
  });
}

afterEach(() => {
  pbState.client = null;
  vi.restoreAllMocks();
});

describe('insightsService · reactions 403 降级', () => {
  it('reactions 拿不到时 stats 与 topPosts 仍返回，反应计数为 0', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({
      posts,
      reactions: forbidden(),
      comments: [{ id: 'c1', post_id: POST_A }],
      stats: statsPayload,
    });

    const snapshot = await insightsService.getInsightsSnapshot('7d', 10);

    expect(snapshot.stats).not.toBeNull();
    expect(snapshot.stats?.totalViews).toBe(910);
    expect(snapshot.topPosts).toHaveLength(2);
    expect(snapshot.topPosts.every((p) => p.reactions === 0)).toBe(true);
    expect(snapshot.availability.reactions).toBe(false);
    expect(snapshot.availability.stats).toBe(true);
    expect(snapshot.partial).toBe(true);
  });

  it('reactions 403 时热门排行仍按浏览量排序（score 只用 views）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({
      posts,
      reactions: forbidden(),
      comments: [],
    });

    const topPosts = await insightsService.getTopPosts(10);

    expect(topPosts.map((p) => p.title)).toEqual(['高热度文章', '低热度文章']);
    expect(topPosts[0]).toMatchObject({ views: 900, reactions: 0, comments: 0, score: 900 });
    expect(topPosts[1].score).toBe(10);
  });

  it('comments 查询失败只降级评论计数，不影响反应与浏览量', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({
      posts,
      reactions: [{ id: 'r1', post_id: POST_B }],
      comments: new Error('comments unavailable'),
      stats: statsPayload,
    });

    const snapshot = await insightsService.getInsightsSnapshot();

    expect(snapshot.topPosts[0]).toMatchObject({ title: '高热度文章', views: 900, reactions: 1, comments: 0 });
    expect(snapshot.topPosts[0].score).toBe(903);
    expect(snapshot.availability.comments).toBe(false);
    expect(snapshot.availability.reactions).toBe(true);
    // 统计接口正常渲染，页面不该因为评论计数降级就整页空白
    expect(snapshot.stats).not.toBeNull();
  });
});

describe('insightsService · 统计接口失败不拖垮互动排行', () => {
  it('/api/blog-stats 失败时 stats 为 null，topPosts 仍返回', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({
      posts,
      reactions: forbidden(),
      comments: [],
      stats: new Error('stats endpoint down'),
    });

    const snapshot = await insightsService.getInsightsSnapshot();

    expect(snapshot.stats).toBeNull();
    expect(snapshot.availability.stats).toBe(false);
    expect(snapshot.topPosts).toHaveLength(2);
    expect(snapshot.partial).toBe(true);
  });

  it('posts 主查询失败时互动排行降级为空，但不会让快照 reject', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pbState.client = makeFakePb({
      posts,
      reactions: [],
      comments: [],
      stats: statsPayload,
      postsFail: true,
    });

    const snapshot = await insightsService.getInsightsSnapshot();

    expect(snapshot.stats).not.toBeNull();
    expect(snapshot.topPosts).toEqual([]);
    expect(snapshot.availability.posts).toBe(false);
    expect(snapshot.partial).toBe(true);
  });
});
