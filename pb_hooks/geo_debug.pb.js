/// <reference path="../pb_data/types.d.ts" />

// 临时诊断端点：回显 ESA 边缘注入的访客相关请求头。
// 用于确认地理头名称（国家/省份/城市）后再定数据模型，验证后删除。
// 不返回原始 IP，只看头名与地理值。

routerAdd('GET', '/api/geo-debug', function (e) {
  var names = [
    'ali-real-client-ip',
    'x-real-ip', 'x-forwarded-for',
    'ali-client-ip-country', 'ali-client-ip-province', 'ali-client-ip-city',
    'x-country-code', 'x-province-code', 'x-city-code',
    'cf-ipcountry', 'x-geo-country', 'x-geo-region', 'x-geo-city',
    'x-appengine-country', 'x-appengine-region', 'x-appengine-city',
    'x-vercel-ip-country', 'x-vercel-ip-country-region', 'x-vercel-ip-city',
    'ali-cdn-real-ip', 'x-alicdn-da-country', 'x-alicdn-da-province', 'x-alicdn-da-city',
  ];
  var seen = {};
  var out = {};
  try {
    var h = e.request().header;
    for (var i = 0; i < names.length; i++) {
      var v = '';
      try { v = String(h.get(names[i]) || '').trim(); } catch (_) {}
      if (v) { out[names[i]] = v; seen[names[i]] = true; }
    }
  } catch (_) {}
  return e.json(200, {
    ok: true,
    detectedGeoHeaders: out,
    hint: '这个端点仅用于确认 ESA 注入的地理头名称，验证后删除 geo_debug.pb.js',
  });
});
