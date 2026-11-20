import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS_KEY,
} from '../../../config/feature-flags';

// 在模块层 mock PB 客户端：featureFlagService 继承的 BaseService 方法内部走模块级
// getPocketBase()，只 spy 实例方法拦不住它们（会真的打到 localhost:8090）。
const { pbState } = vi.hoisted(() => ({
  pbState: { client: null as unknown },
}));

vi.mock('../../pocketbase', () => ({
  getPocketBase: () => pbState.client,
}));

import { featureFlagService } from '../featureFlagService';

/**
 * feature_flags 存储契约（2026-11-20 生产缺陷回归）。
 *
 * 旧实现读写 PB 集合 feature_flags —— 该集合从未在迁移中创建，
 * /admin/features 每次请求 `/api/collections/feature_flags/records` 都 404。
 * 正确存储是 settings 表的一行：key="feature_flags"，value=FeatureFlags JSON。
 *
 * 这里锁定四件事：
 * 1. 无记录 → 用 DEFAULT_FEATURE_FLAGS 映射出全部开关；
 * 2. 有记录 → 映射存储值（含未知 key）并保留字段；
 * 3. setFlag / updateFlag 只改目标条目的 enabled，其他条目与条目内领域字段原样保留；
 * 4. settings 读写抛错时向上传递，绝不静默成功。
 */

interface SettingRow {
  id: string;
  key: string;
  value: unknown;
  created: string;
  updated: string;
}

const ROW_ID = 'rec_feature_flags';
const CREATED = '2026-11-19T10:00:00.000Z';
const UPDATED = '2026-11-20T06:30:00.000Z';

/** 四个已知开关的“已落库”基线，刻意给出与默认值不同的领域字段，便于断言保留。 */
const STORED_FLAGS = {
  rag_chatbot: { enabled: false, endpoint: '/api/chat-v2', faqs_json: '[{"q":"x","a":"y"}]' },
  privacy_analytics: { enabled: false, sample_rate: 0.3 },
  newsletter: { enabled: false, frequency: 'monthly' },
  ab_testing: { enabled: true, active_experiments: ['hero-layout-v2'] },
} as const;

type FlagsPayload = Record<string, Record<string, unknown>>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function storedRow(value: unknown): SettingRow {
  return { id: ROW_ID, key: FEATURE_FLAGS_KEY, value, created: CREATED, updated: UPDATED };
}

/**
 * 最小 PB mock：只实现 settings 行读取与写回用到的 API。
 * - getFirstListItem 只按 `key = "feature_flags"` 命中（其他 filter 返回 404），
 *   从而证明服务确实走 settings.feature_flags，而不是不存在的 feature_flags 集合；
 * - collection 只接受 'settings'，误用其他集合会立刻抛错。
 */
function mockPocketBase(row: SettingRow | null) {
  const getFirstListItem = vi.fn(async (filter: string) => {
    const targetsFeatureFlags = filter.includes(`"${FEATURE_FLAGS_KEY}"`);
    if (!targetsFeatureFlags || !row) {
      throw { status: 404, message: "The requested resource wasn't found." };
    }
    return clone(row);
  });

  const update = vi.fn(async (id: string, data: Record<string, unknown>) => ({
    ...clone(row ?? { key: FEATURE_FLAGS_KEY, created: CREATED, updated: UPDATED }),
    ...clone(data),
    id,
  }));

  const create = vi.fn(async (data: Record<string, unknown>) => ({
    id: 'rec_created',
    created: '2026-11-20T07:00:00.000Z',
    updated: '2026-11-20T07:00:00.000Z',
    ...clone(data),
  }));

  const collectionCalls: string[] = [];
  const collection = vi.fn((name: string) => {
    collectionCalls.push(name);
    if (name !== 'settings') throw new Error(`unexpected collection: ${name}`);
    return { getFirstListItem, update, create };
  });

  const pb = {
    // 与 PB SDK 一致的占位符替换：{:key} → "feature_flags"
    filter: (template: string, params?: Record<string, unknown>) =>
      template.replace(/\{:\w+\}/g, () => JSON.stringify(params?.key ?? '')),
    collection,
  };

  pbState.client = pb;

  return { collection, collectionCalls, getFirstListItem, update, create };
}

/** 取出写回 payload 里的 feature_flags 对象。 */
function writtenValue(call: [string, Record<string, unknown>]): FlagsPayload {
  return call[1].value as FlagsPayload;
}

afterEach(() => {
  vi.restoreAllMocks();
  pbState.client = null;
});

describe('featureFlagService.getFlags：settings feature_flags → 面板列表', () => {
  it('无记录时按 DEFAULT_FEATURE_FLAGS 列出全部已知开关，不再请求 feature_flags 集合', async () => {
    const mock = mockPocketBase(null);

    const flags = await featureFlagService.getFlags();

    expect(flags.map((flag) => flag.key)).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS));
    expect(flags).toHaveLength(Object.keys(DEFAULT_FEATURE_FLAGS).length);
    for (const flag of flags) {
      expect(flag.id).toBe(flag.key);
      expect(flag.enabled).toBe(false);
      // 没有 settings 行就没有时间戳，不伪造当前时间
      expect(flag.created).toBe('');
      expect(flag.updated).toBe('');
    }
    expect(flags[0]).toMatchObject({ key: 'rag_chatbot', name: 'RAG 助手' });
    expect(flags[2]).toMatchObject({ key: 'newsletter', name: 'Newsletter' });

    expect(mock.getFirstListItem.mock.calls[0][0]).toBe('key = "feature_flags"');
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.collectionCalls.every((name) => name === 'settings')).toBe(true);
  });

  it('有记录时映射存储值：已知开关缺条目回落默认值，未知 key 如实展示，时间戳来自记录', async () => {
    const stored = clone(DEFAULT_FEATURE_FLAGS) as unknown as Record<string, unknown>;
    stored.rag_chatbot = { enabled: true, endpoint: '/api/chat-v2', faqs_json: '[]' };
    stored.privacy_analytics = { enabled: false, sample_rate: 0.25 };
    stored.beta_search = { enabled: true, note: 'legacy flag' };
    delete stored.newsletter; // 未落库的已知开关仍应出现（用默认值）
    const mock = mockPocketBase(storedRow(stored));

    const flags = await featureFlagService.getFlags();
    const byKey = Object.fromEntries(flags.map((flag) => [flag.key, flag]));

    expect(flags.map((flag) => flag.key)).toEqual([
      'rag_chatbot',
      'privacy_analytics',
      'newsletter',
      'ab_testing',
      'beta_search',
    ]);
    expect(byKey.rag_chatbot).toMatchObject({
      id: 'rag_chatbot',
      key: 'rag_chatbot',
      enabled: true,
      name: 'RAG 助手',
      created: CREATED,
      updated: UPDATED,
    });
    expect(byKey.privacy_analytics).toMatchObject({ enabled: false, name: '隐私埋点' });
    expect(byKey.newsletter).toMatchObject({ enabled: false, name: 'Newsletter' });
    expect(byKey.beta_search).toMatchObject({
      id: 'beta_search',
      key: 'beta_search',
      name: 'beta_search',
      enabled: true,
    });
    expect(byKey.beta_search.description).toBeUndefined();

    // 读取不写回，也不污染存储中的对象
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    expect(stored.rag_chatbot).toEqual({ enabled: true, endpoint: '/api/chat-v2', faqs_json: '[]' });
  });

  it('settings.value 是 JSON 字符串时按 site-settings 同口径解析', async () => {
    mockPocketBase(storedRow(JSON.stringify({ newsletter: { enabled: true, frequency: 'biweekly' } })));

    const flags = await featureFlagService.getFlags();
    const newsletter = flags.find((flag) => flag.key === 'newsletter');

    expect(newsletter?.enabled).toBe(true);
  });

  it('settings.value 损坏（非 JSON / 非对象）时回落默认值而不是崩溃', async () => {
    mockPocketBase(storedRow('not-json'));
    const broken = await featureFlagService.getFlags();

    expect(broken.map((flag) => flag.key)).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS));
    expect(broken.every((flag) => flag.enabled === false)).toBe(true);
  });
});

describe('featureFlagService 写入：只改 enabled，保留其余条目与字段', () => {
  it('setFlag 只改目标条目的 enabled，endpoint / sample_rate / frequency / active_experiments 原样保留', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));

    await featureFlagService.setFlag('rag_chatbot', true);

    expect(mock.update).toHaveBeenCalledTimes(1);
    const call = mock.update.mock.calls[0];
    expect(call[0]).toBe(ROW_ID);
    expect(call[1]).toEqual({
      value: {
        ...STORED_FLAGS,
        rag_chatbot: { ...STORED_FLAGS.rag_chatbot, enabled: true },
      },
    });

    const written = writtenValue(call);
    expect(written.privacy_analytics).toEqual(STORED_FLAGS.privacy_analytics);
    expect(written.newsletter).toEqual(STORED_FLAGS.newsletter);
    expect(written.ab_testing).toEqual(STORED_FLAGS.ab_testing);
    // 条目内不出现派生文案字段
    expect(Object.keys(written.rag_chatbot).sort()).toEqual(['enabled', 'endpoint', 'faqs_json']);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('updateFlag(id, { enabled }) 与 setFlag 同语义：只改 enabled，不把 name/description 写进 settings', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));

    const flag = await featureFlagService.updateFlag('privacy_analytics', { enabled: true });

    expect(flag).toMatchObject({
      id: 'privacy_analytics',
      key: 'privacy_analytics',
      name: '隐私埋点',
      enabled: true,
      created: CREATED,
      updated: UPDATED,
    });
    expect(mock.update).toHaveBeenCalledTimes(1);
    const written = writtenValue(mock.update.mock.calls[0]);
    expect(written).toEqual({
      ...STORED_FLAGS,
      privacy_analytics: { ...STORED_FLAGS.privacy_analytics, enabled: true },
    });
    expect(written.rag_chatbot).not.toHaveProperty('name');
    expect(written.rag_chatbot).not.toHaveProperty('description');
  });

  it('settings 无记录时首次保存以 DEFAULT_FEATURE_FLAGS 为基线 create，其他开关不被冲掉', async () => {
    const mock = mockPocketBase(null);
    const defaultsSnapshot = clone(DEFAULT_FEATURE_FLAGS);

    await featureFlagService.setFlag('newsletter', true);

    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.create).toHaveBeenCalledWith({
      key: FEATURE_FLAGS_KEY,
      value: {
        ...defaultsSnapshot,
        newsletter: { enabled: true, frequency: 'weekly' },
      },
    });
    // 默认值常量本身绝不能被写路径原地修改
    expect(DEFAULT_FEATURE_FLAGS).toEqual(defaultsSnapshot);
  });

  it('已知开关条目在库里缺失时，写 enabled 会补齐该开关的领域字段（避免前台读不到 endpoint 等）', async () => {
    const mock = mockPocketBase(storedRow({}));

    await featureFlagService.setFlag('rag_chatbot', true);

    const written = writtenValue(mock.update.mock.calls[0]);
    expect(written.rag_chatbot).toEqual({ ...DEFAULT_FEATURE_FLAGS.rag_chatbot, enabled: true });
  });

  it('createFlag 新键为 upsert：追加条目且不影响已存条目', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));

    const created = await featureFlagService.createFlag({
      key: 'beta_search',
      name: 'Beta 搜索',
      description: '',
      enabled: true,
    });

    expect(created).toMatchObject({ id: 'beta_search', key: 'beta_search', name: 'beta_search', enabled: true });
    const written = writtenValue(mock.update.mock.calls[0]);
    expect(written).toEqual({ ...STORED_FLAGS, beta_search: { enabled: true } });
  });

  it('createFlag 对已存在的 key 只改 enabled，保留该条目的其余字段', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));

    await featureFlagService.createFlag({
      key: 'rag_chatbot',
      name: 'RAG 助手',
      description: '',
      enabled: true,
    });

    const written = writtenValue(mock.update.mock.calls[0]);
    expect(written).toEqual({
      ...STORED_FLAGS,
      rag_chatbot: { enabled: true, endpoint: '/api/chat-v2', faqs_json: '[{"q":"x","a":"y"}]' },
    });
  });

  it('createFlag 空 key 直接拒绝，不发起写请求', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));

    await expect(
      featureFlagService.createFlag({ key: '   ', name: 'x', description: '', enabled: true })
    ).rejects.toThrow('功能开关标识不能为空');
    expect(mock.getFirstListItem).not.toHaveBeenCalled();
    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('deleteFlag 只从对象里移除目标键，不影响其他开关', async () => {
    const mock = mockPocketBase(
      storedRow({
        rag_chatbot: { enabled: true, endpoint: '/api/chat-v2', faqs_json: '[]' },
        beta_search: { enabled: true },
      })
    );

    await featureFlagService.deleteFlag('beta_search');

    const written = writtenValue(mock.update.mock.calls[0]);
    expect(written).toEqual({
      rag_chatbot: { enabled: true, endpoint: '/api/chat-v2', faqs_json: '[]' },
    });
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('deleteFlag 在无记录或键不存在时不写请求', async () => {
    const mock = mockPocketBase(null);

    await featureFlagService.deleteFlag('beta_search');

    expect(mock.update).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  });
});

describe('featureFlagService.getFlag', () => {
  it('已知键未落库时回落默认值，未知键存在时如实返回，未知且不存在时返回 null', async () => {
    const mock = mockPocketBase(storedRow({ beta_search: { enabled: true } }));

    await expect(featureFlagService.getFlag('newsletter')).resolves.toMatchObject({
      key: 'newsletter',
      name: 'Newsletter',
      enabled: false,
    });
    await expect(featureFlagService.getFlag('beta_search')).resolves.toMatchObject({
      key: 'beta_search',
      name: 'beta_search',
      enabled: true,
    });
    await expect(featureFlagService.getFlag('nope')).resolves.toBeNull();
    await expect(featureFlagService.isEnabled('beta_search')).resolves.toBe(true);
    await expect(featureFlagService.isEnabled('nope')).resolves.toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
});

describe('featureFlagService 错误传播：PB 失败不静默成功', () => {
  it('读取失败（非 404）时 getFlags 抛出原错误', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));
    const failure = { status: 500, message: 'boom' };
    mock.getFirstListItem.mockRejectedValueOnce(failure);

    await expect(featureFlagService.getFlags()).rejects.toBe(failure);
  });

  it('setFlag 写入失败时抛出，且不会误走 create', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));
    const failure = { status: 403, message: 'Forbidden' };
    mock.update.mockRejectedValueOnce(failure);

    await expect(featureFlagService.setFlag('rag_chatbot', true)).rejects.toBe(failure);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('createFlag 首次保存创建失败时抛出（例如权限/校验错误）', async () => {
    const mock = mockPocketBase(null);
    const failure = { status: 400, message: 'validation failed' };
    mock.create.mockRejectedValueOnce(failure);

    await expect(
      featureFlagService.createFlag({ key: 'beta_search', name: 'Beta', description: '', enabled: true })
    ).rejects.toBe(failure);
  });

  it('updateFlag / deleteFlag 写入失败时同样抛出', async () => {
    const mock = mockPocketBase(storedRow(clone(STORED_FLAGS)));
    const failure = { status: 500, message: 'write failed' };

    mock.update.mockRejectedValueOnce(failure);
    await expect(
      featureFlagService.updateFlag('rag_chatbot', { enabled: true })
    ).rejects.toBe(failure);

    mock.update.mockRejectedValueOnce(failure);
    await expect(featureFlagService.deleteFlag('rag_chatbot')).rejects.toBe(failure);
  });
});
