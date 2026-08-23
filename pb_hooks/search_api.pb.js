/// <reference path="../pb_local/pb/pb_data/types.d.ts" />

/**
 * 全文搜索 API
 * 使用 PocketBase 的 filter 语法实现标题和内容搜索
 */
routerAdd('GET', '/api/search', (c) => {
  try {
    const query = c.queryParam('q') || '';
    const parsedLimit = parseInt(c.queryParam('limit') || '10', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 50)) : 10;
    
    if (!query || query.trim().length < 2) {
      return c.json(200, { results: [], total: 0 });
    }
    
    const searchTerm = query.trim();
    const results = [];
    
    // 搜索文章（标题、内容、摘要）
    try {
      const postsFilter = 'status="published" && (title~{:term} || content~{:term} || excerpt~{:term})';
      const posts = $app.dao().findRecordsByFilter(
        'posts',
        postsFilter,
        '-published_at',
        limit,
        0,
        { term: searchTerm }
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
      const tagsFilter = 'name~{:term} || description~{:term}';
      const tags = $app.dao().findRecordsByFilter(
        'tags',
        tagsFilter,
        '-created',
        5,
        0,
        { term: searchTerm }
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
    const query = c.queryParam('q') || '';
    const parsedLimit = parseInt(c.queryParam('limit') || '5', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 10)) : 5;
    
    if (!query || query.trim().length < 1) {
      return c.json(200, { suggestions: [] });
    }
    
    const searchTerm = query.trim();
    const suggestions = [];
    
    // 从文章标题获取建议
    try {
      const postsFilter = 'status="published" && title~{:term}';
      const posts = $app.dao().findRecordsByFilter(
        'posts',
        postsFilter,
        '-published_at',
        limit,
        0,
        { term: searchTerm }
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
      const tagsFilter = 'name~{:term}';
      const tags = $app.dao().findRecordsByFilter(
        'tags',
        tagsFilter,
        '-created',
        3,
        0,
        { term: searchTerm }
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
