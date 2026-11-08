/**
 * 出席點名 APP — 畫面與事件處理。資料邏輯全在 store.js。
 */
(function () {
  'use strict';

  const S = window.AttendanceStore;
  const app = document.getElementById('app');
  const toastEl = document.getElementById('toast');
  const collator = new Intl.Collator('zh-Hant');

  // ---------- 儲存空間（localStorage 不可用時退回記憶體，並提示） ----------
  const storage = (function () {
    try {
      const ls = window.localStorage;
      ls.setItem('__probe__', '1');
      ls.removeItem('__probe__');
      return ls;
    } catch (err) {
      const mem = {};
      setTimeout(() => toast('瀏覽器無法使用本機儲存，資料只會保留到關閉頁面為止', 6000), 300);
      return {
        getItem: (k) => (k in mem ? mem[k] : null),
        setItem: (k, v) => {
          mem[k] = String(v);
        },
      };
    }
  })();

  const repo = S.createRepo(storage);

  const ui = {
    tab: 'rollcall',
    serviceId: null,
    group: '全部',
    query: '',
    selected: new Set(),
    memberGroup: '全部',
    statsFrom: '',
    statsTo: '',
  };

  // ---------- 工具函式 ----------
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pct(r) {
    return r === null || r === undefined ? '—' : Math.round(r * 100) + '%';
  }

  let toastTimer = null;
  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function groupOptions(db, selected, withAll) {
    const list = (withAll ? ['全部'] : []).concat(db.settings.groups);
    return list
      .map((g) => `<option value="${esc(g)}"${g === selected ? ' selected' : ''}>${esc(g)}</option>`)
      .join('');
  }

  function sortedServices(db) {
    return db.services.slice().sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  }

  function sortMembers(list) {
    return list.slice().sort((a, b) => collator.compare(a.group, b.group) || collator.compare(a.name, b.name));
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  function ensureServiceSelected(db) {
    const exists = db.services.some((s) => s.id === ui.serviceId);
    if (!exists) {
      const first = sortedServices(db)[0];
      ui.serviceId = first ? first.id : null;
      ui.selected.clear();
    }
  }

  // ---------- 頁面框架 ----------
  function render() {
    const db = repo.get();
    document.getElementById('brand').textContent = db.settings.churchName || '出席點名';
    document.querySelectorAll('#tabs .tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === ui.tab);
    });
    switch (ui.tab) {
      case 'rollcall': return renderRollcall();
      case 'services': return renderServices();
      case 'members': return renderMembers();
      case 'stats': return renderStats();
      case 'settings': return renderSettings();
    }
  }

  // ---------- 點名 ----------
  function renderRollcall() {
    const db = repo.get();
    if (db.services.length === 0) {
      app.innerHTML = `
        <div class="card empty">
          <p>尚未建立任何場次。</p>
          <button class="primary" data-tab="services">前往建立場次</button>
        </div>`;
      return;
    }
    ensureServiceSelected(db);
    const svc = db.services.find((s) => s.id === ui.serviceId);

    app.innerHTML = `
      <section class="card">
        <div class="row-flex">
          <label class="field grow">場次
            <select data-role="service-select">
              ${sortedServices(db)
                .map((s) => `<option value="${esc(s.id)}"${s.id === svc.id ? ' selected' : ''}>${esc(s.date)} ${esc(s.title)}${s.completed ? ' ✓' : ''}</option>`)
                .join('')}
            </select>
          </label>
          <label class="field">小組
            <select data-role="group-filter">${groupOptions(db, ui.group, true)}</select>
          </label>
          <label class="field grow">搜尋姓名
            <input type="search" data-role="search" placeholder="輸入姓名" value="${esc(ui.query)}" />
          </label>
        </div>
        <div class="row-flex" style="margin-top:10px">
          <span class="badge${svc.completed ? ' done' : ''}">${svc.completed ? '已完成點名（統計已計入）' : '點名進行中'}</span>
          <span class="grow"></span>
          <button data-action="toggle-complete" data-id="${esc(svc.id)}" class="${svc.completed ? '' : 'primary'}">
            ${svc.completed ? '重新開啟點名' : '完成點名'}
          </button>
        </div>
      </section>
      <div id="summary" class="summary"></div>
      <div id="list" class="list"></div>
      <div id="batch"></div>`;

    renderRollcallBody();
  }

  function renderRollcallBody() {
    const db = repo.get();
    const svc = db.services.find((s) => s.id === ui.serviceId);
    if (!svc) return;

    const sum = S.serviceSummary(db, svc.id);
    document.getElementById('summary').innerHTML = `
      <div class="stat"><div class="num">${sum.total}</div><div class="lbl">應到</div></div>
      <div class="stat present"><div class="num">${sum.present}</div><div class="lbl">出席</div></div>
      <div class="stat late"><div class="num">${sum.late}</div><div class="lbl">遲到</div></div>
      <div class="stat leave"><div class="num">${sum.leave}</div><div class="lbl">請假</div></div>
      <div class="stat absent"><div class="num">${sum.absent}</div><div class="lbl">缺席</div></div>
      <div class="stat"><div class="num">${sum.unmarked}</div><div class="lbl">未點名</div></div>
      <div class="stat"><div class="num">${pct(sum.rate)}</div><div class="lbl">出席率</div></div>`;

    const q = ui.query.trim();
    const visible = sortMembers(
      db.members.filter(
        (m) =>
          m.active &&
          (ui.group === '全部' || m.group === ui.group) &&
          (!q || m.name.includes(q))
      )
    );

    const listEl = document.getElementById('list');
    if (visible.length === 0) {
      listEl.innerHTML = '<div class="empty">沒有符合條件的成員。可到「成員」頁新增。</div>';
    } else {
      listEl.innerHTML = visible
        .map((m) => {
          const st = S.statusOf(db, svc.id, m.id);
          const checked = ui.selected.has(m.id);
          const btn = (s, label) =>
            `<button data-action="status" data-id="${esc(m.id)}" data-status="${s}" class="${st === s ? 'on' : ''}" aria-pressed="${st === s}">${label}</button>`;
          return `
            <div class="person${checked ? ' selected' : ''}">
              <input type="checkbox" data-role="select" data-id="${esc(m.id)}" ${checked ? 'checked' : ''} aria-label="勾選 ${esc(m.name)}" />
              <div class="who">
                <div class="name">${esc(m.name)}</div>
                <div class="meta">${esc(m.group)}${st ? '' : ' · 未點名'}</div>
              </div>
              <div class="btns">
                ${btn(S.STATUS.PRESENT, '出席')}
                ${btn(S.STATUS.LATE, '遲到')}
                ${btn(S.STATUS.LEAVE, '請假')}
                ${btn(S.STATUS.ABSENT, '缺席')}
              </div>
            </div>`;
        })
        .join('');
    }

    const n = ui.selected.size;
    document.getElementById('batch').innerHTML = `
      <div class="batch">
        <div class="row-flex">
          <strong>已勾選 ${n} 人</strong>
          <button class="small" data-action="select-all">全選本頁</button>
          <button class="small" data-action="clear-select">取消勾選</button>
        </div>
        <div class="row-flex" style="margin-top:8px">
          <button class="small" data-action="batch" data-status="present" ${n ? '' : 'disabled'}>勾選→出席</button>
          <button class="small" data-action="batch" data-status="late" ${n ? '' : 'disabled'}>勾選→遲到</button>
          <button class="small" data-action="batch" data-status="leave" ${n ? '' : 'disabled'}>勾選→請假</button>
          <button class="small" data-action="batch" data-status="absent" ${n ? '' : 'disabled'}>勾選→缺席</button>
          <span class="grow"></span>
          <button class="small primary" data-action="mark-rest" data-status="present">未點名者全部出席</button>
        </div>
      </div>`;
  }

  // ---------- 場次 ----------
  function renderServices() {
    const db = repo.get();
    const list = sortedServices(db);
    app.innerHTML = `
      <section class="card">
        <h2>新增場次</h2>
        <form data-form="add-service" class="row-flex">
          <label class="field">日期<input type="date" name="date" value="${todayStr()}" required /></label>
          <label class="field">類型<select name="type">${S.SERVICE_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
          <label class="field grow">標題（選填）<input name="title" placeholder="例：2026/11/08 主日崇拜" /></label>
          <button class="primary" type="submit">新增場次</button>
        </form>
      </section>
      <section class="card">
        <h2>場次列表（共 ${list.length} 場）</h2>
        ${list.length === 0 ? '<div class="empty">尚無場次</div>' : `
        <div class="list">
          ${list.map((s) => {
            const sum = S.serviceSummary(db, s.id);
            return `
            <div class="person" style="grid-template-columns:1fr">
              <div class="row-flex">
                <div class="grow">
                  <div class="name">${esc(s.date)} ${esc(s.title)}</div>
                  <div class="meta">${esc(s.type)} · 出席率 ${pct(sum.rate)}</div>
                </div>
                <span class="badge${s.completed ? ' done' : ''}">${s.completed ? '已完成' : '未完成'}</span>
              </div>
              <div class="row-flex">
                <button class="small primary" data-action="goto-service" data-id="${esc(s.id)}">點名</button>
                <button class="small" data-action="toggle-complete" data-id="${esc(s.id)}">${s.completed ? '重新開啟' : '完成'}</button>
                <span class="grow"></span>
                <button class="small danger" data-action="delete-service" data-id="${esc(s.id)}">刪除</button>
              </div>
            </div>`;
          }).join('')}
        </div>`}
      </section>`;
  }

  // ---------- 成員 ----------
  function renderMembers() {
    const db = repo.get();
    const list = sortMembers(
      db.members.filter((m) => ui.memberGroup === '全部' || m.group === ui.memberGroup)
    );
    const activeCount = db.members.filter((m) => m.active).length;
    app.innerHTML = `
      <section class="card">
        <h2>新增成員</h2>
        <form data-form="add-member" class="row-flex">
          <label class="field grow">姓名<input name="name" required maxlength="30" /></label>
          <label class="field">小組<select name="group">${groupOptions(db, db.settings.groups[0], false)}</select></label>
          <label class="field grow">電話（選填）<input name="phone" inputmode="tel" maxlength="30" /></label>
          <button class="primary" type="submit">新增</button>
        </form>
      </section>
      <section class="card">
        <div class="row-flex">
          <h2 class="grow" style="margin:0">成員名單（啟用 ${activeCount} 人，共 ${db.members.length} 人）</h2>
          <label class="field">篩選小組<select data-role="member-group">${groupOptions(db, ui.memberGroup, true)}</select></label>
        </div>
        <div class="list" style="margin-top:10px">
          ${list.length === 0 ? '<div class="empty">尚無成員</div>' : list.map((m) => `
            <div class="person" style="grid-template-columns:1fr">
              <div class="row-flex">
                <div class="grow">
                  <div class="name">${esc(m.name)} ${m.active ? '' : '<span class="badge">已停用</span>'}</div>
                  <div class="meta">${esc(m.group)}${m.phone ? ' · ' + esc(m.phone) : ''}</div>
                </div>
                <button class="small" data-action="edit-member" data-id="${esc(m.id)}">編輯</button>
                <button class="small" data-action="toggle-member" data-id="${esc(m.id)}">${m.active ? '停用' : '啟用'}</button>
              </div>
            </div>`).join('')}
        </div>
      </section>`;
  }

  // ---------- 統計 ----------
  function renderStats() {
    const db = repo.get();
    const opts = { from: ui.statsFrom || undefined, to: ui.statsTo || undefined };
    const completed = db.services
      .filter((s) => s.completed && (!opts.from || s.date >= opts.from) && (!opts.to || s.date <= opts.to))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const rates = completed.map((s) => S.serviceSummary(db, s.id).rate).filter((r) => r !== null);
    const avg = rates.length ? rates.reduce((x, y) => x + y, 0) / rates.length : null;
    const trend = S.attendanceTrend(db, 12).filter((t) => completed.some((c) => c.id === t.serviceId));
    const maxTotal = Math.max(1, ...trend.map((t) => t.total));
    const gStats = S.groupStats(db, opts);
    const mStats = S.memberStats(db, opts).sort((a, b) => {
      if (a.rate === null) return 1;
      if (b.rate === null) return -1;
      return a.rate - b.rate || collator.compare(a.name, b.name);
    });
    const alerts = S.absenceAlerts(db);

    app.innerHTML = `
      <section class="card">
        <div class="row-flex">
          <label class="field">起始日<input type="date" data-role="stat-from" value="${esc(ui.statsFrom)}" /></label>
          <label class="field">結束日<input type="date" data-role="stat-to" value="${esc(ui.statsTo)}" /></label>
          <span class="grow"></span>
          <button data-action="export-csv">匯出點名明細 CSV</button>
        </div>
        <p class="muted" style="margin:8px 0 0">統計僅計入「已完成點名」的場次；未點名的啟用成員視為缺席；請假不計入應到。</p>
      </section>

      <div class="summary">
        <div class="stat"><div class="num">${completed.length}</div><div class="lbl">已完成場次</div></div>
        <div class="stat"><div class="num">${pct(avg)}</div><div class="lbl">平均出席率</div></div>
        <div class="stat absent"><div class="num">${alerts.length}</div><div class="lbl">關懷名單</div></div>
      </div>

      <section class="card">
        <h2>近期出席趨勢（最近 12 場）</h2>
        ${trend.length === 0 ? '<div class="empty">尚無已完成的場次</div>' : `
        <div class="bars">
          ${trend.map((t) => {
            const h = Math.max(2, Math.round((t.attended / maxTotal) * 120));
            return `<div class="bar-col" title="${esc(t.date)} ${esc(t.title)}：${t.attended}/${t.total}">
              <div class="bar-val">${t.attended}</div>
              <div class="bar" style="height:${h}px"></div>
              <div class="bar-lbl">${esc(t.date.slice(5))}</div>
            </div>`;
          }).join('')}
        </div>`}
      </section>

      <section class="card">
        <h2>關懷名單（連續缺席達 ${Number(db.settings.alertWeeks) || 3} 場以上）</h2>
        ${alerts.length === 0 ? '<div class="empty">目前沒有需要關懷的成員</div>' : `
        <div class="list">
          ${alerts.map((a) => `<div class="person" style="grid-template-columns:1fr">
              <div class="row-flex"><div class="grow"><div class="name">${esc(a.name)}</div><div class="meta">${esc(a.group)}</div></div>
              <span class="badge alert">連續缺席 ${a.streak} 場</span></div></div>`).join('')}
        </div>`}
      </section>

      <section class="card">
        <h2>小組出席率</h2>
        ${gStats.length === 0 ? '<div class="empty">無資料</div>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>小組</th><th class="num">人數</th><th class="num">出席</th><th class="num">應出席</th><th class="num">出席率</th></tr></thead>
          <tbody>${gStats.map((g) => `<tr><td>${esc(g.group)}</td><td class="num">${g.members}</td><td class="num">${g.attended}</td><td class="num">${g.attendable}</td><td class="num">${pct(g.rate)}</td></tr>`).join('')}</tbody>
        </table></div>`}
      </section>

      <section class="card">
        <h2>成員出席統計（依出席率由低到高）</h2>
        ${mStats.length === 0 ? '<div class="empty">無資料</div>' : `
        <div class="table-wrap"><table>
          <thead><tr><th>姓名</th><th>小組</th><th class="num">場次</th><th class="num">出席</th><th class="num">遲到</th><th class="num">請假</th><th class="num">缺席</th><th class="num">出席率</th><th class="num">連續缺席</th></tr></thead>
          <tbody>${mStats.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.group)}</td><td class="num">${m.services}</td><td class="num">${m.attended}</td><td class="num">${m.late}</td><td class="num">${m.leave}</td><td class="num">${m.absent}</td><td class="num">${pct(m.rate)}</td><td class="num">${m.streak}</td></tr>`).join('')}</tbody>
        </table></div>`}
      </section>`;
  }

  // ---------- 設定 ----------
  function renderSettings() {
    const db = repo.get();
    app.innerHTML = `
      <section class="card">
        <h2>基本設定</h2>
        <form data-form="settings" class="row-flex" style="flex-direction:column;align-items:stretch">
          <label class="field">教會／團體名稱<input name="churchName" maxlength="40" value="${esc(db.settings.churchName)}" /></label>
          <label class="field">小組清單（以逗號或換行分隔）<textarea name="groups" rows="3">${esc(db.settings.groups.join('、'))}</textarea></label>
          <label class="field">關懷提醒門檻（連續缺席幾場）<input name="alertWeeks" type="number" min="1" max="52" value="${Number(db.settings.alertWeeks) || 3}" /></label>
          <div><button class="primary" type="submit">儲存設定</button></div>
        </form>
      </section>
      <section class="card">
        <h2>資料備份與還原</h2>
        <p class="muted">資料只存在這台裝置的瀏覽器中。換機、清除瀏覽器資料前請先匯出備份。</p>
        <div class="row-flex">
          <button data-action="export-json">匯出備份（JSON）</button>
          <button data-action="import-json">匯入備份（會覆蓋目前資料）</button>
          <button class="danger" data-action="reset-all">清除全部資料</button>
        </div>
      </section>`;
  }

  // ---------- 事件 ----------
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    ui.tab = btn.dataset.tab;
    render();
    window.scrollTo(0, 0);
  });

  app.addEventListener('click', (e) => {
    const tabLink = e.target.closest('[data-tab]');
    if (tabLink) {
      ui.tab = tabLink.dataset.tab;
      return render();
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = el.dataset.id;
    try {
      handleAction(action, id, el.dataset.status);
    } catch (err) {
      toast(err.message || '操作失敗');
    }
  });

  app.addEventListener('change', (e) => {
    const role = e.target.dataset.role;
    if (!role) return;
    if (role === 'service-select') {
      ui.serviceId = e.target.value;
      ui.selected.clear();
      return renderRollcall();
    }
    if (role === 'group-filter') {
      ui.group = e.target.value;
      return renderRollcallBody();
    }
    if (role === 'select') {
      const mid = e.target.dataset.id;
      if (e.target.checked) ui.selected.add(mid);
      else ui.selected.delete(mid);
      return renderRollcallBody();
    }
    if (role === 'member-group') {
      ui.memberGroup = e.target.value;
      return renderMembers();
    }
    if (role === 'stat-from') {
      ui.statsFrom = e.target.value;
      return renderStats();
    }
    if (role === 'stat-to') {
      ui.statsTo = e.target.value;
      return renderStats();
    }
  });

  app.addEventListener('input', (e) => {
    if (e.target.dataset.role === 'search') {
      ui.query = e.target.value;
      renderRollcallBody();
    }
  });

  app.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    try {
      switch (form.dataset.form) {
        case 'add-service': {
          let newId = null;
          repo.update((db) => {
            newId = S.addService(db, { date: fd.get('date'), type: fd.get('type'), title: fd.get('title') }).id;
          });
          ui.serviceId = newId;
          ui.tab = 'rollcall';
          toast('已新增場次');
          return render();
        }
        case 'add-member': {
          repo.update((db) => S.addMember(db, { name: fd.get('name'), group: fd.get('group'), phone: fd.get('phone') }));
          toast('已新增成員');
          return renderMembers();
        }
        case 'settings': {
          repo.update((db) => {
            db.settings.churchName = String(fd.get('churchName') || '').trim() || '出席點名';
            const groups = String(fd.get('groups') || '')
              .split(/[,，、\n]/)
              .map((g) => g.trim())
              .filter(Boolean);
            db.settings.groups = [...new Set(groups)].length ? [...new Set(groups)] : ['未分組'];
            const w = parseInt(fd.get('alertWeeks'), 10);
            db.settings.alertWeeks = w >= 1 ? w : 3;
          });
          toast('設定已儲存');
          return render();
        }
      }
    } catch (err) {
      toast(err.message || '儲存失敗');
    }
  });

  function handleAction(action, id, status) {
    switch (action) {
      case 'status': {
        repo.update((db) => {
          const cur = S.statusOf(db, ui.serviceId, id);
          S.setStatus(db, ui.serviceId, id, cur === status ? null : status);
        });
        return renderRollcallBody();
      }
      case 'select-all': {
        const db = repo.get();
        const q = ui.query.trim();
        db.members
          .filter((m) => m.active && (ui.group === '全部' || m.group === ui.group) && (!q || m.name.includes(q)))
          .forEach((m) => ui.selected.add(m.id));
        return renderRollcallBody();
      }
      case 'clear-select':
        ui.selected.clear();
        return renderRollcallBody();
      case 'batch': {
        if (!ui.selected.size) return toast('請先勾選成員');
        const n = repo.update((db) => S.markMany(db, ui.serviceId, [...ui.selected], status));
        ui.selected.clear();
        toast(`已將 ${n} 人標為「${S.STATUS_LABEL[status]}」`);
        return renderRollcallBody();
      }
      case 'mark-rest': {
        const n = repo.update((db) => S.markUnmarked(db, ui.serviceId, status));
        toast(n ? `已將 ${n} 位未點名成員標為「${S.STATUS_LABEL[status]}」` : '沒有未點名的成員');
        return renderRollcallBody();
      }
      case 'toggle-complete': {
        const svc = repo.get().services.find((s) => s.id === id);
        if (!svc) return;
        const next = !svc.completed;
        repo.update((db) => S.setServiceCompleted(db, id, next));
        toast(next ? '已完成點名，統計已更新' : '已重新開啟點名');
        return ui.tab === 'services' ? renderServices() : renderRollcall();
      }
      case 'goto-service':
        ui.serviceId = id;
        ui.selected.clear();
        ui.tab = 'rollcall';
        return render();
      case 'delete-service': {
        if (!confirm('確定刪除此場次及其所有點名紀錄？此動作無法復原。')) return;
        repo.update((db) => S.deleteService(db, id));
        if (ui.serviceId === id) ui.serviceId = null;
        toast('已刪除場次');
        return renderServices();
      }
      case 'edit-member': {
        const m = repo.get().members.find((x) => x.id === id);
        if (!m) return;
        const name = prompt('姓名', m.name);
        if (name === null) return;
        const group = prompt('小組（可用：' + repo.get().settings.groups.join('、') + '）', m.group);
        if (group === null) return;
        repo.update((db) => S.updateMember(db, id, { name, group: group.trim() || m.group }));
        toast('已更新成員');
        return renderMembers();
      }
      case 'toggle-member':
        repo.update((db) => {
          const m = db.members.find((x) => x.id === id);
          S.updateMember(db, id, { active: !m.active });
        });
        return renderMembers();
      case 'export-csv': {
        const from = ui.statsFrom || undefined;
        const to = ui.statsTo || undefined;
        download(`點名明細_${todayStr()}.csv`, S.exportCSV(repo.get(), { from, to }), 'text/csv;charset=utf-8');
        return toast('已匯出 CSV');
      }
      case 'export-json':
        download(`點名備份_${todayStr()}.json`, JSON.stringify(repo.get(), null, 2), 'application/json');
        return toast('已匯出備份');
      case 'import-json':
        return document.getElementById('importFile').click();
      case 'reset-all':
        if (!confirm('將刪除所有成員、場次與點名紀錄，且無法復原。建議先匯出備份。確定繼續？')) return;
        repo.replaceAll(S.emptyDB());
        ui.serviceId = null;
        ui.selected.clear();
        toast('已清除全部資料');
        return render();
    }
  }

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const check = S.validateDB(data);
        if (!confirm(`匯入將覆蓋目前資料（成員 ${check.members.length} 人、場次 ${check.services.length} 場）。確定繼續？`)) return;
        repo.replaceAll(check);
        ui.serviceId = null;
        ui.selected.clear();
        toast('匯入完成');
        render();
      } catch (err) {
        toast('匯入失敗：' + (err.message || '檔案格式錯誤'), 4000);
      }
    };
    reader.readAsText(file, 'utf-8');
  });

  // 啟動
  render();
})();
