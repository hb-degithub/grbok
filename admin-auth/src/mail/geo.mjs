import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { MailError } from './errors.mjs';

// GeoLite2 离线 IP 解析：admin-auth 侧兜底通道（通道 B）。
// MMDB 文件路径由 GEO_MMDB_PATH 指定，许可原因不进 git，需手动放到服务器。
// 文件缺失或解析失败时优雅降级为 ok:true + 空地理（不阻塞访客统计）。

let readerPromise = null;
let readerResolved = null;

async function openReader(mmdbPath) {
  if (!mmdbPath) return null;
  if (!readerPromise) {
    readerPromise = (async () => {
      const maxmind = await import('maxmind');
      const buffer = await readFile(mmdbPath);
      return maxmind.open(buffer);
    })().catch(() => null);
    readerPromise.then((reader) => { readerResolved = reader; });
  }
  await readerPromise;
  return readerResolved;
}

function normalizeRegionCode(record) {
  const subdivisions = record && Array.isArray(record.subdivisions) ? record.subdivisions : [];
  const first = subdivisions[0];
  const code = first && (first.iso_code || first.geoname_id);
  return String(code || '').toLowerCase().slice(0, 32);
}

export function createGeoService({ mmdbPath } = {}) {
  const path = String(mmdbPath || '').trim();
  return {
    // 供健康检查/启动日志用：MMDB 是否可用
    async available() {
      return (await openReader(path)) !== null;
    },
    async lookup(ip) {
      const value = String(ip || '').trim();
      if (!value || !isIP(value)) {
        throw new MailError('PAYLOAD_INVALID', false);
      }
      const reader = await openReader(path);
      if (!reader) {
        // 库未就绪：返回空地理但 ok:true，调用方按未识别处理
        return { ok: true, country: '', region_code: '', city: '', degraded: true };
      }
      const record = reader.get(value);
      if (!record) {
        return { ok: true, country: '', region_code: '', city: '' };
      }
      return {
        ok: true,
        country: String(record.country?.iso_code || '').toUpperCase(),
        region_code: normalizeRegionCode(record),
        city: String(record.city?.names?.en || record.city?.names?.['zh-CN'] || '').slice(0, 100),
      };
    },
  };
}
