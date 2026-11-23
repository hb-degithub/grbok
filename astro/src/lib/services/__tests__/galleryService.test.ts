import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 相册上传契约（2026-11 改造）。
 *
 * 后台原本用 PB SDK `create()`，它不暴露上传进度；这里锁定新链路：
 * 1. XMLHttpRequest 直传 `POST /api/collections/gallery_items/records`；
 * 2. `Authorization: <pb.authStore.token>`（不带 Bearer 前缀，PB 接受裸 token）；
 * 3. FormData 携带 photo/status/title/album/sort_order；
 * 4. `xhr.upload.onprogress` 驱动百分比进度；
 * 5. 非 2xx 复用 PocketBase 的错误形状（status + response.data），
 *    让 describePbError / isStepUpRequired 仍然能翻译。
 */

const { pbState } = vi.hoisted(() => ({
  pbState: { token: 'token-abc' },
}));

vi.mock('../../pocketbase', () => ({
  getPocketBase: () => ({ authStore: { token: pbState.token } }),
  buildFileUrl: (collection: string, id: string, file: string, thumb?: string) =>
    thumb ? `/files/${collection}/${id}/${file}?thumb=${thumb}` : `/files/${collection}/${id}/${file}`,
}));

import { galleryService } from '../galleryService';
import { describePbError, isStepUpRequired } from '../../pb-error';

interface ProgressLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

type Handler = (() => void) | null;

class FakeXHR {
  static instances: FakeXHR[] = [];
  static response: { status: number; body: string } = { status: 200, body: '{"id":"rec1"}' };

  upload: { onprogress: ((event: ProgressLike) => void) | null } = { onprogress: null };
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = '';
  responseType = '';
  aborted = false;

  onload: Handler = null;
  onerror: Handler = null;
  ontimeout: Handler = null;
  onabort: Handler = null;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: FormData) {
    this.body = body;
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
      this.status = FakeXHR.response.status;
      this.responseText = FakeXHR.response.body;
      this.onload?.();
    });
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const originalXHR = globalThis.XMLHttpRequest;

function makeFile(name = 'photo.jpg'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });
}

beforeEach(() => {
  pbState.token = 'token-abc';
  FakeXHR.instances = [];
  FakeXHR.response = { status: 200, body: '{"id":"rec1","title":"海边","status":"show"}' };
  globalThis.XMLHttpRequest = FakeXHR as unknown as typeof XMLHttpRequest;
});

afterEach(() => {
  globalThis.XMLHttpRequest = originalXHR;
  vi.restoreAllMocks();
});

describe('galleryService.uploadWithProgress · XHR 直传', () => {
  it('POST 到 gallery_items records，并带 Authorization 裸 token', async () => {
    const record = await galleryService.uploadWithProgress(makeFile(), { title: '海边', album: '旅行' });

    const xhr = FakeXHR.instances[0];
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://localhost:8090/api/collections/gallery_items/records');
    expect(xhr.headers.Authorization).toBe('token-abc');
    expect(record).toMatchObject({ id: 'rec1', title: '海边' });
  });

  it('FormData 携带 photo/status/title/album/sort_order', async () => {
    const file = makeFile('sea.jpg');
    await galleryService.uploadWithProgress(file, { title: ' 海边 ', album: ' 旅行 ' });

    const body = FakeXHR.instances[0].body as FormData;
    expect((body.get('photo') as File).name).toBe('sea.jpg');
    expect(body.get('status')).toBe('show');
    expect(body.get('title')).toBe('海边');
    expect(body.get('album')).toBe('旅行');
    expect(body.get('sort_order')).toBe('0');
  });

  it('标题/相册为空时不写入 FormData 字段', async () => {
    await galleryService.uploadWithProgress(makeFile(), { title: '   ', album: '' });

    const body = FakeXHR.instances[0].body as FormData;
    expect(body.get('title')).toBeNull();
    expect(body.get('album')).toBeNull();
  });

  it('onprogress 收到真实百分比，结束后补 100%', async () => {
    const onProgress = vi.fn();
    await galleryService.uploadWithProgress(makeFile(), { onProgress });

    const percents = onProgress.mock.calls.map(([p]) => p.percent);
    expect(percents).toEqual([50, 100, 100]);
    expect(onProgress.mock.calls[0][0]).toMatchObject({ loaded: 50, total: 100 });
  });

  it('403 保留 PocketBase 错误形状，可被 describePbError 翻译', async () => {
    FakeXHR.response = {
      status: 403,
      body: JSON.stringify({ code: 403, message: 'ADMIN_STEP_UP_REQUIRED' }),
    };

    const error = await galleryService.uploadWithProgress(makeFile()).catch((err) => err);

    expect((error as { status?: number }).status).toBe(403);
    expect(isStepUpRequired(error)).toBe(true);
    expect(describePbError(error, '上传失败')).toContain('管理会话已过期');
  });

  it('400 校验错误把服务端 message 透出', async () => {
    FakeXHR.response = {
      status: 400,
      body: JSON.stringify({
        code: 400,
        message: 'Failed to load the submitted data.',
        data: { photo: { code: 'validation_invalid_mime_type', message: 'Unsupported mime type' } },
      }),
    };

    const error = await galleryService.uploadWithProgress(makeFile()).catch((err) => err);

    expect((error as { status?: number }).status).toBe(400);
    expect(describePbError(error, '上传失败')).toContain('内容校验未通过');
  });

  it('网络中断按 status 0 处理', async () => {
    const failing = class extends FakeXHR {
      send() {
        queueMicrotask(() => this.onerror?.());
      }
    };
    globalThis.XMLHttpRequest = failing as unknown as typeof XMLHttpRequest;

    const error = await galleryService.uploadWithProgress(makeFile()).catch((err) => err);

    expect((error as { status?: number }).status).toBe(0);
    expect(describePbError(error, '上传失败')).toContain('网络异常');
  });

  it('signal 已 abort 时直接拒绝，不发请求', async () => {
    const controller = new AbortController();
    controller.abort();

    const error = await galleryService
      .uploadWithProgress(makeFile(), { signal: controller.signal })
      .catch((err) => err);

    expect((error as Error).message).toBe('上传已取消');
    expect(FakeXHR.instances[0].body).toBeNull();
  });
});

describe('galleryService · 缩略图 URL', () => {
  const item = {
    id: 'rec1',
    photo: 'photo.jpg',
    title: '',
    description: '',
    album: '',
    sort_order: 0,
    status: 'show',
    collectionId: 'gallery_items',
    collectionName: 'gallery_items',
    created: '',
    updated: '',
  } as unknown as Parameters<typeof galleryService.getListThumbUrl>[0];

  it('列表缩略图固定 300x300，灯箱固定 1024x0', () => {
    expect(galleryService.getListThumbUrl(item)).toBe('/files/gallery_items/rec1/photo.jpg?thumb=300x300');
    expect(galleryService.getLightboxUrl(item)).toBe('/files/gallery_items/rec1/photo.jpg?thumb=1024x0');
  });
});
