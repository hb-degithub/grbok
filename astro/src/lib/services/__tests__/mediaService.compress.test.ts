// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 媒体库上传自动压缩回归。
 *
 * 所有上传入口（媒体库、文章粘贴/拖拽插图）都收口到 mediaService.uploadAsset，
 * 因此这里验证：默认会先压缩再上传，`{ compress: false }` 时保留原图。
 */

const compressedFile = new File([new Uint8Array(1024)], 'photo.webp', { type: 'image/webp' });
const compressImageFile = vi.fn(async (_file: File) => compressedFile);

vi.mock('../../image-compress', () => ({
  compressImageFile: (file: File) => compressImageFile(file),
}));

interface SentForm { form: FormData }
const sent: SentForm[] = [];

class FakeXHR {
  upload = { addEventListener: () => {} };
  status = 200;
  responseText = JSON.stringify({ id: 'asset1', file: 'photo.webp', size: 1024 });
  private listeners: Record<string, Array<() => void>> = {};
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  open() {}
  setRequestHeader() {}
  send(form: FormData) {
    sent.push({ form });
    setTimeout(() => (this.listeners.load || []).forEach((fn) => fn()), 0);
  }
}

(globalThis as unknown as { XMLHttpRequest: typeof FakeXHR }).XMLHttpRequest = FakeXHR;

import { mediaService } from '../mediaService';

beforeEach(() => {
  sent.length = 0;
  compressImageFile.mockClear();
});

describe('mediaService.uploadAsset · 上传自动压缩', () => {
  it('默认先压缩再上传，并使用压缩后的文件与体积', async () => {
    const original = new File([new Uint8Array(9 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    await mediaService.uploadAsset(original);

    expect(compressImageFile).toHaveBeenCalledWith(original);
    expect(sent).toHaveLength(1);
    const form = sent[0].form;
    expect(form.get('file')).toBeInstanceOf(File);
    expect((form.get('file') as File).name).toBe('photo.webp');
    expect(form.get('size')).toBe('1024');
    expect(form.get('alt')).toBe('photo.webp');
  });

  it('compress:false 时保留原图，不调用压缩', async () => {
    const original = new File([new Uint8Array(9 * 1024 * 1024)], 'raw.png', { type: 'image/png' });
    await mediaService.uploadAsset(original, undefined, { compress: false });

    expect(compressImageFile).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    const file = sent[0].form.get('file') as File;
    expect(file.name).toBe('raw.png');
    expect(sent[0].form.get('size')).toBe(String(original.size));
  });
});
