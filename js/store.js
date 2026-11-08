/**
 * 出席點名 APP — 資料層與統計邏輯（純函式，不依賴 DOM，可在瀏覽器與 Node 執行）
 *
 * 資料結構（單一 JSON 文件，存於 localStorage）：
 *   {
 *     version: 1,
 *     settings: { churchName, groups: [string], alertWeeks: number },
 *     members:  [{ id, name, group, phone, active, createdAt }],
 *     services: [{ id, date: 'YYYY-MM-DD', title, type, completed, createdAt }],
 *     records:  { '<serviceId>|<memberId>': { status, time } }
 *   }
 * 狀態值：present(出席) late(遲到) leave(請假) absent(缺席)；未點名 = 無紀錄。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AttendanceStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STORAGE_KEY = 'attendance-app:v1';
  const SCHEMA_VERSION = 1;

  const STATUS = { PRESENT: 'present', LATE: 'late', LEAVE: 'leave', ABSENT: 'absent' };
  const STATUS_LABEL = { present: '出席', late: '遲到', leave: '請假', absent: '缺席' };
  const STATUS_LIST = [STATUS.PRESENT, STATUS.LATE, STATUS.LEAVE, STATUS.ABSENT];
  const SERVICE_TYPES = ['主日崇拜', '晚間聚會', '禱告會', '小組聚會', '特別聚會'];

  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function emptyDB() {
    return {
      version: SCHEMA_VERSION,
      settings: { churchName: '我的教會', groups: ['未分組'], alertWeeks: 3 },
      members: [],
      services: [],
      records: {},
    };
  }

  /** 驗證匯入或讀取的資料結構，不合格則拋出錯誤。 */
  function validateDB(db) {
    if (!db || typeof db !== 'object') throw new Error('資料格式錯誤：不是物件');
    if (!Array.isArray(db.members) || !Array.isArray(db.services)) {
      throw new Error('資料格式錯誤：缺少 members 或 services');
    }
    if (!db.records || typeof db.records !== 'object') {
      throw new Error('資料格式錯誤：缺少 records');
    }
    const base = emptyDB();
    db.settings = Object.assign(base.settings, db.settings || {});
    if (!Array.isArray(db.settings.groups) || db.settings.groups.length === 0) {
      db.settings.groups = base.settings.groups;
    }
    db.version = SCHEMA_VERSION;
    return db;
  }

  /**
   * 建立儲存庫。storage 需實作 getItem / setItem（可傳入 localStorage 或測試用物件）。
   * 所有變更透過 update(fn)：fn 接收 db 並直接修改，之後自動存檔。
   */
  function createRepo(storage) {
    let db = load();

    function load() {
      try {
        const raw = storage.getItem(STORAGE_KEY);
        return raw ? validateDB(JSON.parse(raw)) : emptyDB();
      } catch (err) {
        console.error('讀取資料失敗', err);
        return emptyDB();
      }
    }

    function save() {
      storage.setItem(STORAGE_KEY, JSON.stringify(db));
    }

    return {
      get() {
        return db;
      },
      update(fn) {
        const result = fn(db);
        save();
        return result;
      },
      replaceAll(newDb) {
        db = validateDB(newDb);
        save();
      },
      reload() {
        db = load();
        return db;
      },
    };
  }

  // ---------- 成員 ----------

  function addMember(db, { name, group, phone }) {
    const trimmed = (name || '').trim();
    if (!trimmed) throw new Error('姓名不可空白');
    const member = {
      id: uid('m'),
      name: trimmed,
      group: group || db.settings.groups[0],
      phone: (phone || '').trim(),
      active: true,
      createdAt: nowIso(),
    };
    db.members.push(member);
    return member;
  }

  function updateMember(db, memberId, patch) {
    const m = db.members.find((x) => x.id === memberId);
    if (!m) throw new Error('找不到成員');
    if (patch.name !== undefined) {
      const trimmed = String(patch.name).trim();
      if (!trimmed) throw new Error('姓名不可空白');
      m.name = trimmed;
    }
    if (patch.group !== undefined) m.group = patch.group;
    if (patch.phone !== undefined) m.phone = String(patch.phone).trim();
    if (patch.active !== undefined) m.active = !!patch.active;
    return m;
  }

  // ---------- 場次 ----------

  function addService(db, { date, title, type }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('日期格式需為 YYYY-MM-DD');
    const service = {
      id: uid('s'),
      date,
      title: (title || '').trim() || type || '聚會',
      type: type || SERVICE_TYPES[0],
      completed: false,
      createdAt: nowIso(),
    };
    db.services.push(service);
    return service;
  }

  function deleteService(db, serviceId) {
    db.services = db.services.filter((s) => s.id !== serviceId);
    Object.keys(db.records).forEach((k) => {
      if (k.startsWith(serviceId + '|')) delete db.records[k];
    });
  }

  function setServiceCompleted(db, serviceId, completed) {
    const s = db.services.find((x) => x.id === serviceId);
    if (!s) throw new Error('找不到場次');
    s.completed = !!completed;
    return s;
  }

  // ---------- 點名紀錄 ----------

  function recordKey(serviceId, memberId) {
    return serviceId + '|' + memberId;
  }

  function statusOf(db, serviceId, memberId) {
    const r = db.records[recordKey(serviceId, memberId)];
    return r ? r.status : null;
  }

  /** status 為 null 時清除該筆紀錄（回到未點名）。 */
  function setStatus(db, serviceId, memberId, status) {
    const key = recordKey(serviceId, memberId);
    if (status === null || status === undefined || status === '') {
      delete db.records[key];
      return;
    }
    if (!STATUS_LIST.includes(status)) throw new Error('無效的狀態：' + status);
    db.records[key] = { status, time: nowIso() };
  }

  /** 批次設定多位成員的狀態。 */
  function markMany(db, serviceId, memberIds, status) {
    memberIds.forEach((mid) => setStatus(db, serviceId, mid, status));
    return memberIds.length;
  }

  /** 將所有「未點名」的啟用成員標為指定狀態。 */
  function markUnmarked(db, serviceId, status) {
    const ids = db.members
      .filter((m) => m.active && statusOf(db, serviceId, m.id) === null)
      .map((m) => m.id);
    return markMany(db, serviceId, ids, status);
  }

  // ---------- 統計 ----------

  const isAttended = (st) => st === STATUS.PRESENT || st === STATUS.LATE;

  function activeMembers(db) {
    return db.members.filter((m) => m.active);
  }

  function byDateAsc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : 1;
  }

  /** 單一場次摘要。出席率 = (出席+遲到) / (應到人數 − 請假)。 */
  function serviceSummary(db, serviceId) {
    const members = activeMembers(db);
    const counts = { present: 0, late: 0, leave: 0, absent: 0, unmarked: 0 };
    members.forEach((m) => {
      const st = statusOf(db, serviceId, m.id);
      if (st === null) counts.unmarked++;
      else counts[st]++;
    });
    const attended = counts.present + counts.late;
    const attendable = members.length - counts.leave;
    return {
      total: members.length,
      ...counts,
      attended,
      rate: attendable > 0 ? attended / attendable : null,
    };
  }

  function inRange(date, from, to) {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  }

  /**
   * 成員統計（只計入已完成點名的場次）。未點名視為缺席。
   * opts: { from, to } 皆為 YYYY-MM-DD，可省略。
   */
  function memberStats(db, opts = {}) {
    const svcs = db.services
      .filter((s) => s.completed && inRange(s.date, opts.from, opts.to))
      .sort(byDateAsc);
    return activeMembers(db).map((m) => {
      let attended = 0;
      let late = 0;
      let leave = 0;
      let absent = 0;
      svcs.forEach((s) => {
        const st = statusOf(db, s.id, m.id);
        if (st === STATUS.PRESENT) attended++;
        else if (st === STATUS.LATE) {
          attended++;
          late++;
        } else if (st === STATUS.LEAVE) leave++;
        else absent++;
      });
      const attendable = svcs.length - leave;
      return {
        memberId: m.id,
        name: m.name,
        group: m.group,
        services: svcs.length,
        attended,
        late,
        leave,
        absent,
        rate: attendable > 0 ? attended / attendable : null,
        streak: absenceStreak(db, m.id),
      };
    });
  }

  /** 最近連續缺席次數（未點名或缺席計入；出席、遲到、請假會中斷）。 */
  function absenceStreak(db, memberId) {
    const svcs = db.services.filter((s) => s.completed).sort(byDateAsc).reverse();
    let n = 0;
    for (const s of svcs) {
      const st = statusOf(db, s.id, memberId);
      if (st === null || st === STATUS.ABSENT) n++;
      else break;
    }
    return n;
  }

  /** 連續缺席達到門檻的成員清單（關懷名單）。 */
  function absenceAlerts(db) {
    const threshold = Number(db.settings.alertWeeks) || 3;
    return activeMembers(db)
      .map((m) => ({ memberId: m.id, name: m.name, group: m.group, streak: absenceStreak(db, m.id) }))
      .filter((x) => x.streak >= threshold)
      .sort((a, b) => b.streak - a.streak);
  }

  /** 依小組彙總出席率。 */
  function groupStats(db, opts = {}) {
    const groups = {};
    memberStats(db, opts).forEach((ms) => {
      const g = (groups[ms.group] = groups[ms.group] || { group: ms.group, members: 0, attended: 0, attendable: 0 });
      g.members++;
      g.attended += ms.attended;
      g.attendable += ms.services - ms.leave;
    });
    return Object.values(groups)
      .map((g) => ({ ...g, rate: g.attendable > 0 ? g.attended / g.attendable : null }))
      .sort((a, b) => a.group.localeCompare(b.group, 'zh-Hant'));
  }

  /** 最近 n 個已完成場次的出席趨勢（由舊到新）。 */
  function attendanceTrend(db, n = 12) {
    return db.services
      .filter((s) => s.completed)
      .sort(byDateAsc)
      .slice(-n)
      .map((s) => {
        const sum = serviceSummary(db, s.id);
        return { serviceId: s.id, date: s.date, title: s.title, attended: sum.attended, total: sum.total, rate: sum.rate };
      });
  }

  // ---------- 匯出 ----------

  function csvCell(v) {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** 匯出點名明細 CSV（含 BOM，Excel 開啟不亂碼）。 */
  function exportCSV(db, opts = {}) {
    const header = ['日期', '場次', '場次類型', '小組', '姓名', '狀態'];
    const rows = [header];
    db.services
      .filter((s) => s.completed && inRange(s.date, opts.from, opts.to))
      .sort(byDateAsc)
      .forEach((s) => {
        activeMembers(db).forEach((m) => {
          const st = statusOf(db, s.id, m.id);
          rows.push([s.date, s.title, s.type, m.group, m.name, st ? STATUS_LABEL[st] : '缺席(未點名)']);
        });
      });
    return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  return {
    STORAGE_KEY,
    STATUS,
    STATUS_LABEL,
    STATUS_LIST,
    SERVICE_TYPES,
    emptyDB,
    validateDB,
    createRepo,
    addMember,
    updateMember,
    addService,
    deleteService,
    setServiceCompleted,
    statusOf,
    setStatus,
    markMany,
    markUnmarked,
    serviceSummary,
    memberStats,
    absenceStreak,
    absenceAlerts,
    groupStats,
    attendanceTrend,
    exportCSV,
  };
});
