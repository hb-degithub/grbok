'use strict';

// 访客地理解析：优先读 ESA 边缘注入的地理头（通道 A），
// 缺失时把 ESA 提供的真实访客 IP 经内网签名请求发给 admin-auth 用 GeoLite2 解析（通道 B）。
// 隐私：只返回行政区划代码，原始 IP 不出本函数、不落库。

// ESA 回源规则里配置的地理头（用户在控制台开启后生效）
// 根据 ESA 控制台配置：
// - ali-real-client-ip: 真实客户端 IP（已在 client_ip.js 中使用）
// - ali-ip-country: 客户端 IP 地址的位置信息（国家或地区）
// - ali-geo-country/ali-geo-region/ali-geo-city: 旧版地理头（保留兼容）
var HEADER_COUNTRY = 'ali-ip-country';  // 新的国家标头
var HEADER_COUNTRY_OLD = 'ali-geo-country';  // 旧版兼容
var HEADER_REGION = 'ali-geo-region';
var HEADER_CITY = 'ali-geo-city';

function header(e, name) {
  try {
    return String(e.request().header.get(name) || '').trim();
  } catch (_) {
    return '';
  }
}

// 规范化 ESA 国家头为 ISO alpha-2（ESA 可能返回中文名或代码，统一成代码）
function normalizeCountry(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  // 已是 alpha-2 代码
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  // ESA 中文国家名映射（扩展版，覆盖更多国家和地区）
  var map = {
    // 亚洲
    '中国': 'CN', '中国香港': 'HK', '中国澳门': 'MO', '中国台湾': 'TW',
    '日本': 'JP', '韩国': 'KR', '朝鲜': 'KP', '蒙古': 'MN',
    '新加坡': 'SG', '马来西亚': 'MY', '泰国': 'TH', '越南': 'VN',
    '菲律宾': 'PH', '印度尼西亚': 'ID', '印度': 'IN', '巴基斯坦': 'PK',
    '孟加拉国': 'BD', '斯里兰卡': 'LK', '尼泊尔': 'NP', '不丹': 'BT',
    '缅甸': 'MM', '老挝': 'LA', '柬埔寨': 'KH', '文莱': 'BN',
    '哈萨克斯坦': 'KZ', '乌兹别克斯坦': 'UZ', '吉尔吉斯斯坦': 'KG',
    '塔吉克斯坦': 'TJ', '土库曼斯坦': 'TM', '阿富汗': 'AF',
    '伊朗': 'IR', '伊拉克': 'IQ', '沙特阿拉伯': 'SA', '阿联酋': 'AE',
    '卡塔尔': 'QA', '科威特': 'KW', '巴林': 'BH', '阿曼': 'OM',
    '也门': 'YE', '约旦': 'JO', '黎巴嫩': 'LB', '叙利亚': 'SY',
    '以色列': 'IL', '巴勒斯坦': 'PS', '土耳其': 'TR', '塞浦路斯': 'CY',
    '亚美尼亚': 'AM', '阿塞拜疆': 'AZ', '格鲁吉亚': 'GE',
    // 欧洲
    '英国': 'GB', '爱尔兰': 'IE', '法国': 'FR', '德国': 'DE',
    '意大利': 'IT', '西班牙': 'ES', '葡萄牙': 'PT', '荷兰': 'NL',
    '比利时': 'BE', '卢森堡': 'LU', '瑞士': 'CH', '奥地利': 'AT',
    '瑞典': 'SE', '挪威': 'NO', '丹麦': 'DK', '芬兰': 'FI',
    '冰岛': 'IS', '波兰': 'PL', '捷克': 'CZ', '斯洛伐克': 'SK',
    '匈牙利': 'HU', '罗马尼亚': 'RO', '保加利亚': 'BG', '希腊': 'GR',
    '阿尔巴尼亚': 'AL', '塞尔维亚': 'RS', '克罗地亚': 'HR', '斯洛文尼亚': 'SI',
    '波黑': 'BA', '黑山': 'ME', '北马其顿': 'MK', '科索沃': 'XK',
    '爱沙尼亚': 'EE', '拉脱维亚': 'LV', '立陶宛': 'LT',
    '白俄罗斯': 'BY', '乌克兰': 'UA', '摩尔多瓦': 'MD', '俄罗斯': 'RU',
    '马耳他': 'MT', '圣马力诺': 'SM', '梵蒂冈': 'VA', '摩纳哥': 'MC',
    '列支敦士登': 'LI', '安道尔': 'AD',
    // 北美洲
    '美国': 'US', '加拿大': 'CA', '墨西哥': 'MX', '危地马拉': 'GT',
    '伯利兹': 'BZ', '洪都拉斯': 'HN', '萨尔瓦多': 'SV', '尼加拉瓜': 'NI',
    '哥斯达黎加': 'CR', '巴拿马': 'PA', '古巴': 'CU', '牙买加': 'JM',
    '海地': 'HT', '多米尼加': 'DO', '波多黎各': 'PR', '巴哈马': 'BS',
    // 南美洲
    '巴西': 'BR', '阿根廷': 'AR', '智利': 'CL', '秘鲁': 'PE',
    '哥伦比亚': 'CO', '委内瑞拉': 'VE', '厄瓜多尔': 'EC', '玻利维亚': 'BO',
    '巴拉圭': 'PY', '乌拉圭': 'UY', '圭亚那': 'GY', '苏里南': 'SR',
    // 大洋洲
    '澳大利亚': 'AU', '新西兰': 'NZ', '斐济': 'FJ', '巴布亚新几内亚': 'PG',
    '所罗门群岛': 'SB', '瓦努阿图': 'VU', '萨摩亚': 'WS', '汤加': 'TO',
    // 非洲
    '埃及': 'EG', '利比亚': 'LY', '突尼斯': 'TN', '阿尔及利亚': 'DZ',
    '摩洛哥': 'MA', '苏丹': 'SD', '南苏丹': 'SS', '埃塞俄比亚': 'ET',
    '索马里': 'SO', '肯尼亚': 'KE', '乌干达': 'UG', '坦桑尼亚': 'TZ',
    '卢旺达': 'RW', '布隆迪': 'BI', '刚果(金)': 'CD', '刚果(布)': 'CG',
    '加蓬': 'GA', '喀麦隆': 'CM', '尼日利亚': 'NG', '尼日尔': 'NE',
    '乍得': 'TD', '中非': 'CF', '马里': 'ML', '布基纳法索': 'BF',
    '科特迪瓦': 'CI', '加纳': 'GH', '多哥': 'TG', '贝宁': 'BJ',
    '塞内加尔': 'SN', '几内亚': 'GN', '塞拉利昂': 'SL', '利比里亚': 'LR',
    '南非': 'ZA', '纳米比亚': 'NA', '博茨瓦纳': 'BW', '津巴布韦': 'ZW',
    '赞比亚': 'ZM', '马拉维': 'MW', '莫桑比克': 'MZ', '马达加斯加': 'MG',
    '毛里求斯': 'MU', '塞舌尔': 'SC', '科摩罗': 'KM',
  };
  return map[v] || '';
}

// 中国省份拼音/英文到中文名的映射（用于 GeoLite2 返回的 region_code）
var REGION_PINYIN_TO_CN = {
  'beijing': '北京', 'tianjin': '天津', 'hebei': '河北', 'shanxi': '山西', 'neimenggu': '内蒙古',
  'liaoning': '辽宁', 'jilin': '吉林', 'heilongjiang': '黑龙江', 'shanghai': '上海', 'jiangsu': '江苏',
  'zhejiang': '浙江', 'anhui': '安徽', 'fujian': '福建', 'jiangxi': '江西', 'shandong': '山东',
  'henan': '河南', 'hubei': '湖北', 'hunan': '湖南', 'guangdong': '广东', 'guangxi': '广西',
  'hainan': '海南', 'chongqing': '重庆', 'sichuan': '四川', 'guizhou': '贵州', 'yunnan': '云南',
  'xizang': '西藏', 'tibet': '西藏', 'shaanxi': '陕西', 'gansu': '甘肃', 'qinghai': '青海', 'ningxia': '宁夏',
  'xinjiang': '新疆', 'taiwan': '台湾', 'xianggang': '香港', 'hongkong': '香港', 'aomen': '澳门', 'macau': '澳门',
};

function normalizeRegion(value, country) {
  var v = String(value || '').trim();
  if (!v) return '';
  // 中国省份：尝试映射到中文名
  if (country === 'CN') {
    var lower = v.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    // 直接匹配
    if (REGION_PINYIN_TO_CN[lower]) return REGION_PINYIN_TO_CN[lower];
    // 去掉后缀 _sheng/_shi 等再匹配
    var stripped = lower.replace(/_(sheng|shi|zizhiqu|province|city)$/, '');
    if (REGION_PINYIN_TO_CN[stripped]) return REGION_PINYIN_TO_CN[stripped];
    // 已是中文则直接返回
    if (/^[\u4e00-\u9fa5]+$/.test(v)) return v.slice(0, 32);
  }
  // 非中国或未匹配：返回小写下划线格式
  return v.toLowerCase().replace(/\s+/g, '_').slice(0, 32);
}

function normalizeCity(value) {
  return String(value || '').trim().slice(0, 100);
}

// 通道 A：读 ESA 注入的地理头
function fromHeaders(e) {
  // 优先使用新的 ali-ip-country 标头，回退到旧版 ali-geo-country
  var country = normalizeCountry(header(e, HEADER_COUNTRY));
  if (!country) {
    country = normalizeCountry(header(e, HEADER_COUNTRY_OLD));
  }
  if (!country) return null;
  return {
    country: country,
    region_code: normalizeRegion(header(e, HEADER_REGION), country),
    city: normalizeCity(header(e, HEADER_CITY)),
    source: 'esa_header',
  };
}

// IP 格式校验（IPv4 和 IPv6）
function isValidIP(ip) {
  if (!ip || typeof ip !== 'string') return false;
  var v = ip.trim();
  // IPv4: 4 个 0-255 的数字，用点分隔
  var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(v)) return true;
  // IPv6: 简化校验，至少包含 :: 或 8 组十六进制
  var ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  if (ipv6Regex.test(v)) return true;
  // IPv6 压缩格式（如 ::1 或 2001:db8::）
  if (v === '::1' || v === '::') return true;
  if (v.indexOf('::') !== -1) {
    var parts = v.split('::');
    if (parts.length === 2) {
      var left = parts[0] ? parts[0].split(':').length : 0;
      var right = parts[1] ? parts[1].split(':').length : 0;
      if (left + right <= 8) return true;
    }
  }
  return false;
}

// 通道 B：经内网签名通道发给 admin-auth 的 GeoLite2 解析
// 复用 mail_gateway 的签名请求机制（同一 internalBaseUrl + HMAC 签名）。
function fromIpLookup(ip) {
  if (!ip || !isValidIP(ip)) return null;
  var path = '/internal/mail/geo/lookup';
  var body = JSON.stringify({ ip: ip });
  var timestamp = String(Math.floor(Date.now() / 1000));
  var nonce = $security.randomStringWithAlphabet(
    32,
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-',
  );
  var baseUrl;
  var signature;
  try {
    baseUrl = require('./mail_gateway.js')._internalBaseUrl();
    signature = require('./mail_crypto.js').sign('POST', path, body, timestamp, nonce);
  } catch (_) {
    return null; // 内网通道未配置则优雅降级
  }
  try {
    var response = $http.send({
      url: baseUrl + path,
      method: 'POST',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        'X-Mail-Timestamp': timestamp,
        'X-Mail-Nonce': nonce,
        'X-Mail-Signature': signature,
      },
      timeout: 3,
    });
    var json = response && response.json;
    if (json && json.ok && typeof json.country === 'string') {
      return {
        country: json.country || '',
        region_code: normalizeRegion(json.region_code, json.country),
        city: normalizeCity(json.city),
        source: 'geolite2',
      };
    }
  } catch (_) {}
  return null;
}

// 主入口：给 stats_lib.trackView 调用
// e: 请求上下文（读头），ip: 已解析的真实访客 IP（来自 client_ip.js）
function resolve(e, ip) {
  var geo = fromHeaders(e);
  if (geo && geo.country) return geo;
  return fromIpLookup(ip) || { country: '', region_code: '', city: '', source: 'none' };
}

module.exports = {
  resolve: resolve,
  _fromHeaders: fromHeaders,
  _fromIpLookup: fromIpLookup,
  _normalizeCountry: normalizeCountry,
};
