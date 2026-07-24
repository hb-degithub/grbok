(function () {
'use strict';

routerAdd('POST', '/api/test/stats-friend/setup', function (e) {
  var stage = 'collections';

  function fail(message) {
    throw new Error('stats_friend_fixture: ' + message);
  }

  function createFriend(dao, collection, name, url, status) {
    var record = new Record(collection);
    record.set('name', name);
    record.set('url', url);
    record.set('description', 'fixture');
    record.set('avatar', '');
    record.set('status', status);
    record.set('sort_order', 0);
    dao.saveRecord(record);
    return record;
  }

  function createView(dao, collection, path, target, created) {
    var record = new Record(collection);
    record.set('path', path);
    record.set('referrer', '');
    record.set('ua_category', 'desktop');
    record.set('visitor_hash', 'a'.repeat(64));
    record.set('event', 'link_click');
    record.set('target', target);
    dao.saveRecord(record);
    if (created) {
      dao.db().newQuery('UPDATE page_views SET created = {:created} WHERE id = {:id}')
        .bind({ created: created, id: record.id })
        .execute();
    }
    return record;
  }

  try {
    var dao = $app.dao();
    var views = dao.findCollectionByNameOrId('page_views');
    var links = dao.findCollectionByNameOrId('friend_links');

    stage = 'schema';
    var targetField = null;
    try { targetField = views.schema.getFieldByName('target'); } catch (_) {}
    if (!targetField) fail('page_views.target is missing');

    stage = 'clear';
    dao.db().newQuery('DELETE FROM page_views').execute();
    dao.db().newQuery('DELETE FROM friend_links').execute();

    var showUrl = 'https://show.friend.example/';
    var hiddenUrl = 'https://hidden.friend.example/';
    var unknownUrl = 'https://unknown.friend.example/';

    stage = 'friends';
    createFriend(dao, links, 'Show friend', showUrl, 'show');
    createFriend(dao, links, 'Hidden friend', hiddenUrl, 'hide');

    stage = 'views';
    createView(dao, views, '/seed/show-1', showUrl, '');
    createView(dao, views, '/seed/show-2', showUrl, '');
    createView(dao, views, '/seed/hidden', hiddenUrl, '');
    createView(dao, views, '/seed/unknown', unknownUrl, '');
    createView(
      dao,
      views,
      '/seed/old',
      showUrl,
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19),
    );

    return e.json(200, {
      showUrl: showUrl,
      hiddenUrl: hiddenUrl,
      unknownUrl: unknownUrl,
    });
  } catch (error) {
    return e.json(400, {
      code: 'FIXTURE_SETUP_FAILED',
      stage: stage,
      detail: String(error),
    });
  }
});

routerAdd('GET', '/api/test/stats-friend/inspect', function (e) {
  function fail(message) {
    throw new Error('stats_friend_fixture: ' + message);
  }

  function expectEqual(actual, expected, label) {
    if (actual !== expected) {
      fail(label + ' expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
    }
  }

  function expectTrue(value, label) {
    if (!value) fail(label);
  }

  function dayString(value) {
    return value.getFullYear()
      + '-' + String(value.getMonth() + 1).padStart(2, '0')
      + '-' + String(value.getDate()).padStart(2, '0');
  }

  function countViews(dao) {
    var rows = arrayOf(new DynamicModel({ c: 0 }));
    dao.db().newQuery('SELECT COUNT(*) AS c FROM page_views').all(rows);
    return Number((rows[0] && rows[0].c) || 0);
  }

  function findView(dao, path) {
    return dao.findFirstRecordByFilter('page_views', 'path = {:path}', { path: path });
  }

  var dao = $app.dao();
  var stats = require(__hooks + '/lib/stats_lib.js');
  var mailCrypto = require(__hooks + '/lib/mail_crypto.js');

  var beforeHeaderOnly = countViews(dao);
  var headerOnlyResult = stats.trackView({
    realIP: function () { return ''; },
    request: function () {
      return {
        header: {
          get: function (name) {
            return name === 'X-Forwarded-For' ? '198.51.100.44' : '';
          },
        },
        body: null,
      };
    },
    json: function (status, payload) { return { status: status, payload: payload }; },
  });
  var untrustedHeaderOnlyWriteCount = countViews(dao) - beforeHeaderOnly;
  expectEqual(headerOnlyResult.status, 503, 'header-only request fails closed');
  expectEqual(untrustedHeaderOnlyWriteCount, 0, 'untrusted header-only write count');

  var hashARecord = findView(dao, '/hash-a');
  var hashBRecord = findView(dao, '/hash-b');
  var hashA = String(hashARecord.get('visitor_hash') || '');
  var hashB = String(hashBRecord.get('visitor_hash') || '');
  expectEqual(String(hashARecord.get('target') || ''), '', 'pageview ignores target');

  var today = dayString(new Date());
  var tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  var rawIdentity = '127.0.0.1|StatsFixtureUA/1.0|' + today;
  var hashToday = mailCrypto.hashPrivate('stats-visitor-day', rawIdentity);
  var hashTodayAgain = mailCrypto.hashPrivate('stats-visitor-day', rawIdentity);
  var hashTomorrow = mailCrypto.hashPrivate(
    'stats-visitor-day',
    '127.0.0.1|StatsFixtureUA/1.0|' + dayString(tomorrowDate),
  );

  expectEqual(hashA, hashB, 'same visitor/day hash');
  expectEqual(hashA, hashToday, 'stored visitor hash is keyed');
  expectTrue(hashToday === hashTodayAgain, 'same identity hash is stable');
  expectTrue(hashToday !== hashTomorrow, 'visitor hash rotates by day');
  expectTrue(hashToday !== $security.sha256(rawIdentity), 'visitor hash is not raw sha256');

  var bucketKeys = Object.keys(globalThis.statsRateBuckets || {});
  var rateBucketKeysContainRawIp = bucketKeys.some(function (key) {
    return String(key).indexOf('127.0.0.1') !== -1;
  });
  expectEqual(rateBucketKeysContainRawIp, false, 'rate bucket hides raw ip');

  var storedReferrerForTokenUrl = String(findView(dao, '/ref-token').get('referrer') || '');
  var storedReferrerForNonHttp = String(findView(dao, '/ref-non-http').get('referrer') || '');
  var storedReferrerForUserInfo = String(findView(dao, '/ref-userinfo').get('referrer') || '');
  var storedReferrerForControlChars = String(findView(dao, '/ref-control').get('referrer') || '');
  expectEqual(storedReferrerForTokenUrl, 'https://ref.example', 'token referrer origin');
  expectEqual(storedReferrerForNonHttp, '', 'non-http referrer');
  expectEqual(storedReferrerForUserInfo, '', 'userinfo referrer');
  expectEqual(storedReferrerForControlChars, '', 'control-character referrer');

  var statsResult = stats.friendLinkStats({
    json: function (status, payload) { return { status: status, payload: payload }; },
  });
  expectEqual(statsResult.status, 200, 'friend stats status');
  expectEqual(statsResult.payload.range, '30d', 'friend stats range');
  expectEqual(statsResult.payload.top[0].target, 'https://show.friend.example/', 'top visible friend');
  expectEqual(statsResult.payload.top[0].clicks, 3, 'top visible friend clicks');
  expectEqual(JSON.stringify(statsResult.payload).indexOf('visitor_hash') !== -1, false, 'aggregate privacy');

  return e.json(200, {
    code: 'PASS',
    observed: {
      untrustedHeaderOnlyWriteCount: untrustedHeaderOnlyWriteCount,
      hashTodayEqualsAgain: hashToday === hashTodayAgain,
      hashTodayDiffersTomorrow: hashToday !== hashTomorrow,
      hashTodayDiffersRawSha256: hashToday !== $security.sha256(rawIdentity),
      rateBucketKeysContainRawIp: rateBucketKeysContainRawIp,
      storedReferrerForTokenUrl: storedReferrerForTokenUrl,
      storedReferrerForNonHttp: storedReferrerForNonHttp,
      storedReferrerForUserInfo: storedReferrerForUserInfo,
      storedReferrerForControlChars: storedReferrerForControlChars,
      range: statsResult.payload.range,
      top: statsResult.payload.top,
    },
  });
});
})();
