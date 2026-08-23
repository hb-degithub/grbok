'use strict';

// search_api.pb.js 注入回归测试（源码级，无外部依赖，node 直接运行）。
// 背景：搜索 API 曾把用户输入 searchTerm 直接插值进 PocketBase filter 字符串，
// 含双引号的查询可逃逸出字符串字面量、改写过滤条件（filter injection），可能读取到
// 非 published 内容。修复后必须使用 {:term} 参数绑定。

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var repoRoot = path.resolve(__dirname, '..', '..');
var source = fs.readFileSync(path.join(repoRoot, 'pb_hooks', 'search_api.pb.js'), 'utf8');

// 1. 禁止把用户输入直接插值进任何 filter 字符串
assert(!/\$\{\s*searchTerm\s*\}/.test(source), 'search filters must not interpolate searchTerm');

// 2. 全部查询必须使用 {:term} 参数绑定（3+2+1+1 = 7 处占位符）并传入绑定参数（4 次查询）
var placeholders = source.match(/\{:term\}/g) || [];
assert.strictEqual(placeholders.length, 7, 'all search filter placeholders must use {:term} binding');
var bindings = source.match(/\{\s*term:\s*searchTerm\s*\}/g) || [];
assert.strictEqual(bindings.length, 4, 'all four findRecordsByFilter calls must pass { term: searchTerm }');

// 3. 500 响应只能返回稳定错误码，不得泄露内部错误细节
assert(!/String\s*\(\s*error\s*\)/.test(source), 'error responses must not stringify exceptions');
assert(!/message\s*:/.test(source), 'error responses must not expose a message field');
assert(source.indexOf('SEARCH_FAILED') !== -1, 'search endpoint must return stable SEARCH_FAILED code');
assert(source.indexOf('SEARCH_SUGGESTION_FAILED') !== -1, 'suggest endpoint must return stable SEARCH_SUGGESTION_FAILED code');

// 4. limit 必须拒绝 NaN 并双向钳制（search: 1..50, suggest: 1..10）
var finiteChecks = source.match(/Number\.isFinite\(parsedLimit\)/g) || [];
assert.strictEqual(finiteChecks.length, 2, 'both endpoints must reject NaN limit');
assert(/Math\.min\(parsedLimit,\s*50\)/.test(source), 'search limit must be capped at 50');
assert(/Math\.min\(parsedLimit,\s*10\)/.test(source), 'suggest limit must be capped at 10');

process.stdout.write('PASS search API filters use parameter binding and stable error codes\n');
