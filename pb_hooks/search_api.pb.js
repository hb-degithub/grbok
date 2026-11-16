/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

/**
 * 全文搜索 API
 * 使用 PocketBase 的 filter 语法实现标题和内容搜索
 *
 * 2026-11-16 渗透测试 #29 修复：搜索词里的 `%`、`_`、`\` 此前被 fexpr 的 `~`
 * 当作 SQL LIKE 通配符/转义符（`q=%%` 返回全量、`q=%搜索%` 可跨记录命中）。
 *
 * PB 0.22.48 实测结论（真实隔离实例 + tools/search/filter.go）：
 *   - `~` 生成 `LIKE <pattern> ESCAPE '\'`，模式里的 `\%` / `\_` / `\\` 才表示字面量。
 *   - `{:param}` 绑定值在 BuildExpr 里被 Go `strconv.Quote` 重新转义后**内联**进
 *     filter 字符串：传入 `a\%b` 会变成 filter 文本 `"a\\%b"`，fexpr 只还原
 *     `\"` 不还原 `\\`，PB 的 wrapLikeParams 因此把 `%` 判为未转义通配符
 *     （实测命中 0 条或退化为 LIKE 模式），**无法在参数层面可靠转义**。
 *   - 直接把带引号的 LIKE 模式写进 filter（两端自带 `%`）时，wrapLikeParams
 *     发现未转义 `%` 就原样使用该模式，不再二次包裹；此时 `\%`/`\_`/`\\`
 *     由 SQLite 的 ESCAPE 子句按字面量处理（实测 `a%b`/`a_b`/`%`/`%%` 全部正确）。
 *
 * 因此这里不再用 `{:term}`，而是构造 `"%" + escape(term) + "%"` 的引号字面量：
 * 对 `\ % _ "` 逐字符前置反斜杠，既阻止 LIKE 通配，也阻止提前闭合 filter 字符串。
 * 模式尾部恒为 `%`，fexpr 的引号扫描不会把结尾引号误判为已转义。
 * 中文/英文正常搜索语义不变（`搜索` 仍按子串命中）。
 */

routerAdd('GET', '/api/search', (c) => {
  try {
    // JSVM 的 routerAdd 回调按源码在请求级 runtime 重新 eval，文件作用域的
    // 常量/函数对回调不可见（项目已知陷阱），因此全部定义在回调内部。
    const MAX_QUERY_LENGTH = 100;
    const query = c.queryParam('q') || '';
    const parsedLimit = parseInt(c.queryParam('limit') || '10', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 50)) : 10;

    if (!query || query.trim().length < 2) {
      return c.json(200, { results: [], total: 0 });
    }

    const searchTerm = query.trim().slice(0, MAX_QUERY_LENGTH);

    function escapeLikeLiteral(value) {
      let out = '';
      for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        if (ch === '\\' || ch === '%' || ch === '_' || ch === '"') out += '\\';
        out += ch;
      }
      return out;
    }
    // 两端自带 %：fexpr 视为完整 LIKE 模式，不再自动包裹/转义。
    const termLiteral = '"%' + escapeLikeLiteral(searchTerm) + '%"';

    const results = [];

    // 搜索文章（标题、内容、摘要）
    try {
      const postsFilter = 'status="published" && (title~' + termLiteral +
        ' || content~' + termLiteral + ' || excerpt~' + termLiteral + ')';
      const posts = $app.dao().findRecordsByFilter(
        'posts',
        postsFilter,
        '-published_at',
        limit,
        0,
        {}
      );

      posts.forEach((post) => {
        const title = post.getString('title');
        const content = post.getString('content');
        const excerpt = post.getString('excerpt') || content.slice(0, 200);

        // 简单的相关性评分：标题匹配 > 摘要匹配 > 内容匹配
        let score = 0;
        if (title.toLowerCase().includes(searchTerm.toLowerCase())) score += 10;
        if (excerpt.toLowerCase().includes(searchTerm.toLowerCase())) score += 5;
        if (content.toLowerCase().includes(searchTerm.toLowerCase())) score += 1;

        results.push({
          type: 'post',
          id: post.getString('id'),
          title: title,
          url: `/posts/${post.getString('slug')}`,
          excerpt: excerpt.slice(0, 150) + (excerpt.length > 150 ? '...' : ''),
          score: score,
          published_at: post.getString('published_at'),
        });
      });
    } catch (e) {
      console.error('搜索文章失败:', e);
    }

    // 搜索标签（名称、描述）
    try {
      const tagsFilter = 'name~' + termLiteral + ' || description~' + termLiteral;
      const tags = $app.dao().findRecordsByFilter(
        'tags',
        tagsFilter,
        '-created',
        5,
        0,
        {}
      );

      tags.forEach((tag) => {
        results.push({
          type: 'tag',
          id: tag.getString('id'),
          title: `标签: ${tag.getString('name')}`,
          url: `/tags/${tag.getString('slug')}`,
          excerpt: tag.getString('description') || '查看相关文章',
          score: 3,
        });
      });
    } catch (e) {
      console.error('搜索标签失败:', e);
    }

    // 按相关性评分排序
    results.sort((a, b) => b.score - a.score);

    return c.json(200, {
      results: results.slice(0, limit),
      total: results.length,
      query: searchTerm,
    });
  } catch (error) {
    console.error('搜索 API 错误:', error);
    return c.json(500, { error: 'SEARCH_FAILED' });
  }
});

/**
 * 搜索建议 API（自动补全）
 */
routerAdd('GET', '/api/search/suggest', (c) => {
  try {
    const MAX_QUERY_LENGTH = 100;
    const query = c.queryParam('q') || '';
    const parsedLimit = parseInt(c.queryParam('limit') || '5', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 10)) : 5;

    if (!query || query.trim().length < 1) {
      return c.json(200, { suggestions: [] });
    }

    const searchTerm = query.trim().slice(0, MAX_QUERY_LENGTH);

    function escapeLikeLiteral(value) {
      let out = '';
      for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        if (ch === '\\' || ch === '%' || ch === '_' || ch === '"') out += '\\';
        out += ch;
      }
      return out;
    }
    const termLiteral = '"%' + escapeLikeLiteral(searchTerm) + '%"';

    const suggestions = [];

    // 从文章标题获取建议
    try {
      const postsFilter = 'status="published" && title~' + termLiteral;
      const posts = $app.dao().findRecordsByFilter(
        'posts',
        postsFilter,
        '-published_at',
        limit,
        0,
        {}
      );

      posts.forEach((post) => {
        suggestions.push({
          text: post.getString('title'),
          type: 'post',
          url: `/posts/${post.getString('slug')}`,
        });
      });
    } catch (e) {
      console.error('获取文章建议失败:', e);
    }

    // 从标签名称获取建议
    try {
      const tagsFilter = 'name~' + termLiteral;
      const tags = $app.dao().findRecordsByFilter(
        'tags',
        tagsFilter,
        '-created',
        3,
        0,
        {}
      );

      tags.forEach((tag) => {
        suggestions.push({
          text: tag.getString('name'),
          type: 'tag',
          url: `/tags/${tag.getString('slug')}`,
        });
      });
    } catch (e) {
      console.error('获取标签建议失败:', e);
    }

    return c.json(200, { suggestions: suggestions.slice(0, limit) });
  } catch (error) {
    console.error('搜索建议 API 错误:', error);
    return c.json(500, { error: 'SEARCH_SUGGESTION_FAILED' });
  }
});
