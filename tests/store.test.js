// 執行方式：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/store.js');

function memoryStorage() {
  const data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    _data: data,
  };
}

function setup() {
  const db = S.emptyDB();
  db.settings.groups = ['青年組', '長輩組'];
  const a = S.addMember(db, { name: '王小明', group: '青年組' });
  const b = S.addMember(db, { name: '李小華', group: '長輩組' });
  const c = S.addMember(db, { name: '陳大同', group: '青年組' });
  const s1 = S.addService(db, { date: '2026-01-04', title: '主日一', type: '主日崇拜' });
  const s2 = S.addService(db, { date: '2026-01-11', title: '主日二', type: '主日崇拜' });
  const s3 = S.addService(db, { date: '2026-01-18', title: '主日三', type: '主日崇拜' });
  return { db, a, b, c, s1, s2, s3 };
}

test('新增成員需有姓名，空白會被拒絕', () => {
  const db = S.emptyDB();
  assert.throws(() => S.addMember(db, { name: '   ' }), /姓名不可空白/);
  const m = S.addMember(db, { name: ' 張三 ' });
  assert.equal(m.name, '張三');
  assert.equal(m.active, true);
});

test('場次日期格式需為 YYYY-MM-DD', () => {
  const db = S.emptyDB();
  assert.throws(() => S.addService(db, { date: '2026/1/4' }), /YYYY-MM-DD/);
});

test('setStatus 可設定、覆寫與清除狀態', () => {
  const { db, a, s1 } = setup();
  S.setStatus(db, s1.id, a.id, 'present');
  assert.equal(S.statusOf(db, s1.id, a.id), 'present');
  S.setStatus(db, s1.id, a.id, 'late');
  assert.equal(S.statusOf(db, s1.id, a.id), 'late');
  S.setStatus(db, s1.id, a.id, null);
  assert.equal(S.statusOf(db, s1.id, a.id), null);
  assert.throws(() => S.setStatus(db, s1.id, a.id, 'bogus'), /無效的狀態/);
});

test('markUnmarked 只標記尚未點名的啟用成員', () => {
  const { db, a, b, c, s1 } = setup();
  S.setStatus(db, s1.id, a.id, 'absent');
  const n = S.markUnmarked(db, s1.id, 'present');
  assert.equal(n, 2);
  assert.equal(S.statusOf(db, s1.id, a.id), 'absent');
  assert.equal(S.statusOf(db, s1.id, b.id), 'present');
  assert.equal(S.statusOf(db, s1.id, c.id), 'present');
});

test('serviceSummary 計算出席率（請假不計入應到）', () => {
  const { db, a, b, c, s1 } = setup();
  S.markMany(db, s1.id, [a.id], 'present');
  S.markMany(db, s1.id, [b.id], 'late');
  S.markMany(db, s1.id, [c.id], 'leave');
  const sum = S.serviceSummary(db, s1.id);
  assert.equal(sum.total, 3);
  assert.equal(sum.attended, 2);
  assert.equal(sum.leave, 1);
  assert.equal(sum.unmarked, 0);
  assert.equal(sum.rate, 1); // 2 / (3 - 1)
});

test('停用成員不計入統計', () => {
  const { db, a, b, c, s1 } = setup();
  S.updateMember(db, c.id, { active: false });
  S.markMany(db, s1.id, [a.id, b.id], 'present');
  const sum = S.serviceSummary(db, s1.id);
  assert.equal(sum.total, 2);
  assert.equal(sum.rate, 1);
});

test('memberStats 只計入已完成場次，未點名視為缺席', () => {
  const { db, a, b, s1, s2, s3 } = setup();
  S.setServiceCompleted(db, s1.id, true);
  S.setServiceCompleted(db, s2.id, true);
  // s3 未完成，不應計入
  S.markMany(db, s1.id, [a.id, b.id], 'present');
  S.markMany(db, s2.id, [a.id], 'present');
  // b 在 s2 未點名 → 缺席
  const stats = S.memberStats(db);
  const sa = stats.find((x) => x.memberId === a.id);
  const sb = stats.find((x) => x.memberId === b.id);
  assert.equal(sa.services, 2);
  assert.equal(sa.attended, 2);
  assert.equal(sa.rate, 1);
  assert.equal(sb.attended, 1);
  assert.equal(sb.absent, 1);
  assert.equal(sb.rate, 0.5);
});

test('memberStats 日期區間篩選', () => {
  const { db, a, s1, s2 } = setup();
  S.setServiceCompleted(db, s1.id, true);
  S.setServiceCompleted(db, s2.id, true);
  S.markMany(db, s1.id, [a.id], 'present');
  S.markMany(db, s2.id, [a.id], 'present');
  const sa = S.memberStats(db, { from: '2026-01-10' }).find((x) => x.memberId === a.id);
  assert.equal(sa.services, 1);
});

test('absenceStreak 連續缺席，遇到出席或請假即中斷', () => {
  const { db, a, s1, s2, s3 } = setup();
  S.setServiceCompleted(db, s1.id, true);
  S.setServiceCompleted(db, s2.id, true);
  S.setServiceCompleted(db, s3.id, true);
  S.markMany(db, s1.id, [a.id], 'present');
  S.markMany(db, s2.id, [a.id], 'absent');
  // s3 未點名 → 缺席
  assert.equal(S.absenceStreak(db, a.id), 2);
  S.setStatus(db, s3.id, a.id, 'leave');
  assert.equal(S.absenceStreak(db, a.id), 0); // 請假中斷 → 0
});

test('absenceAlerts 依門檻列出關懷名單', () => {
  const { db, a, b, c, s1, s2, s3 } = setup();
  db.settings.alertWeeks = 2;
  [s1, s2, s3].forEach((s) => S.setServiceCompleted(db, s.id, true));
  S.markMany(db, s2.id, [a.id], 'present');
  S.markMany(db, s3.id, [a.id], 'present');
  // b、c 三週皆未點名 → streak 3；a 最近兩週出席 → 不列入
  const alerts = S.absenceAlerts(db);
  assert.equal(alerts.length, 2);
  assert.deepEqual(alerts.map((x) => x.memberId).sort(), [b.id, c.id].sort());
  assert.ok(alerts.every((x) => x.streak === 3));
});

test('groupStats 依小組彙總', () => {
  const { db, a, b, c, s1 } = setup();
  S.setServiceCompleted(db, s1.id, true);
  S.markMany(db, s1.id, [a.id, c.id], 'present');
  S.markMany(db, s1.id, [b.id], 'absent');
  const gs = S.groupStats(db);
  const young = gs.find((g) => g.group === '青年組');
  const old = gs.find((g) => g.group === '長輩組');
  assert.equal(young.members, 2);
  assert.equal(young.rate, 1);
  assert.equal(old.rate, 0);
});

test('attendanceTrend 由舊到新，且只含已完成場次', () => {
  const { db, a, s1, s2, s3 } = setup();
  S.setServiceCompleted(db, s2.id, true);
  S.setServiceCompleted(db, s1.id, true);
  S.markMany(db, s1.id, [a.id], 'present');
  const trend = S.attendanceTrend(db);
  assert.equal(trend.length, 2);
  assert.equal(trend[0].date, '2026-01-04');
  assert.equal(trend[1].date, '2026-01-11');
});

test('deleteService 會連同紀錄一併刪除', () => {
  const { db, a, s1 } = setup();
  S.markMany(db, s1.id, [a.id], 'present');
  S.deleteService(db, s1.id);
  assert.equal(db.services.find((s) => s.id === s1.id), undefined);
  assert.deepEqual(Object.keys(db.records), []);
});

test('exportCSV 含 BOM、標題列與逗號引號跳脫', () => {
  const { db, a, s1 } = setup();
  S.setServiceCompleted(db, s1.id, true);
  S.updateMember(db, a.id, { name: '王, "小明"' });
  S.markMany(db, s1.id, [a.id], 'late');
  const csv = S.exportCSV(db);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('日期,場次,場次類型,小組,姓名,狀態'));
  assert.ok(csv.includes('"王, ""小明"""'));
  assert.ok(csv.includes('遲到'));
});

test('repo 存取：寫入後可重新載入，損壞資料退回空白資料庫', () => {
  const storage = memoryStorage();
  const repo = S.createRepo(storage);
  repo.update((db) => S.addMember(db, { name: '測試' }));
  const repo2 = S.createRepo(storage);
  assert.equal(repo2.get().members[0].name, '測試');

  storage._data[S.STORAGE_KEY] = '{not json';
  const repo3 = S.createRepo(storage);
  assert.equal(repo3.get().members.length, 0);
});

test('validateDB 拒絕不合格的匯入資料', () => {
  assert.throws(() => S.validateDB({ members: 'x', services: [], records: {} }), /格式錯誤/);
  assert.throws(() => S.validateDB(null), /格式錯誤/);
});
