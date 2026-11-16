'use strict';

// search_api.pb.js 注入 / LIKE 通配符回归测试（源码级，无外部依赖，node 直接运行）。
//
// 背景：
//   1. 搜索 API 曾把用户输入 searchTerm 直接插值进 PocketBase filter 字符串，
//      含双引号的查询可逃逸出字符串字面量、改写过滤条件（filter injection）。
//   2. 修复为 {:term} 参数绑定后仍有 #29：PB 0.22.48 的 fexpr `~` 会把绑定值
//      当作 SQL LIKE 模式（`q=%%` 返回全量），且绑定值经 strconv.Quote 二次转义，
//      **无法在参数层面转义** `%` / `_` / `\`（真实隔离实例实测）。
//   3. 现方案：在 filter 字符串内构造带引号的 LIKE 模式 `"%<escaped>%"`，
//      对 `\ % _ "` 逐字符前置反斜杠；PB 生成的 SQL 为
//      `LIKE <pattern> ESCAPE '\'`，四个字符都按字面量匹配，且不会闭合字符串。
//
// 本测试锁定上述结构，防止回退到裸插值或参数绑定通配符。

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');
var source = fs.readFileSync(path.join(repoRoot, 'pb_hooks', 'search_api.pb.js'), 'utf8');

// 1. 禁止把用户输入直接拼进 filter（必须经过 escapeLikeLiteral）
assert(!/\$\{\s*searchTerm\s*\}/.test(source), 'search filters must not interpolate searchTerm');
assert(!/\+\s*searchTerm\s*\+/.test(source), 'search filters must not concatenate raw searchTerm');
assert(source.indexOf('escapeLikeLiteral(searchTerm)') !== -1, 'search terms must go through escapeLikeLiteral');

// 2. LIKE 转义必须覆盖 \\ % _ " 四个字符
var escapeChecks = [
  ["ch === '\\\\'", 'backslash'],
  ["ch === '%'", 'percent'],
  ["ch === '_'", 'underscore'],
  ["ch === '\"'", 'double quote'],
];
for (var i = 0; i < escapeChecks.length; i++) {
  assert(
    source.indexOf(escapeChecks[i][0]) !== -1,
    'escapeLikeLiteral must escape ' + escapeChecks[i][1],
  );
}

// 3. 模式必须两端自带 % 并用双引号包裹（fexpr 才不会二次包裹/转义）
assert(
  source.indexOf('const termLiteral = \'"%\' + escapeLikeLiteral(searchTerm) + \'%"\';') !== -1,
  'search literal must be built as a quoted %...% LIKE pattern',
);

// 4. 不允许回退到 {:term} 参数绑定（PB 0.22.48 无法在绑定值中转义 LIKE 通配符）。
// 注释里保留了对旧实现的说明，因此先剥离块注释再检查代码。
var code = source.replace(/\/\*[\s\S]*?\*\//g, '');
var placeholders = code.match(/\{:term\}/g) || [];
assert.strictEqual(placeholders.length, 0, 'search filters must not use {:term} LIKE binding');
assert(!/\{\s*term:\s*searchTerm\s*\}/.test(code), 'search filters must not bind searchTerm');

// 5. 每条搜索条件都必须使用 termLiteral（posts/tags/suggest）
var literalUses = source.match(/termLiteral/g) || [];
assert(literalUses.length >= 8, 'all search filters must use the escaped termLiteral');

// 6. 500 响应只能返回稳定错误码，不得泄露内部错误细节
assert(!/String\s*\(\s*error\s*\)/.test(source), 'error responses must not stringify exceptions');
assert(!/message\s*:/.test(source), 'error responses must not expose a message field');
assert(source.indexOf('SEARCH_FAILED') !== -1, 'search endpoint must return stable SEARCH_FAILED code');
assert(source.indexOf('SEARCH_SUGGESTION_FAILED') !== -1, 'suggest endpoint must return stable SEARCH_SUGGESTION_FAILED code');

// 7. limit 必须拒绝 NaN 并双向钳制（search: 1..50, suggest: 1..10）
var finiteChecks = source.match(/Number\.isFinite\(parsedLimit\)/g) || [];
assert.strictEqual(finiteChecks.length, 2, 'both endpoints must reject NaN limit');
assert(/Math\.min\(parsedLimit,\s*50\)/.test(source), 'search limit must be capped at 50');
assert(/Math\.min\(parsedLimit,\s*10\)/.test(source), 'suggest limit must be capped at 10');

process.stdout.write('PASS search filters escape LIKE wildcards without raw interpolation\n');
