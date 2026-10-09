import * as api from './api.js';
import { esc, $, $$, kindLabel, fmtDate, fmtDateTime, fmtSize, fmtNum, emptyState, loading, errorBox, toast, withLock, friendlyError, confirmDialog } from './util.js';

const TABS = [['users', 'کاربران'], ['contents', 'محتواها'], ['categories', 'دسته‌بندی‌ها'], ['feedback', 'بازخوردها'], ['trash', 'سطل زباله'], ['files', 'فایل‌ها'], ['audit', 'گزارش اقدامات'], ['backup', 'پشتیبان‌گیری']];
const STATUS_FA = { pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده', disabled: 'غیرفعال' };
const ROLE_FA = { educator: 'مربی', admin: 'مدیر' };
const ACTION_FA = {
  content_create: 'ایجاد محتوا', content_update: 'ویرایش محتوا', content_soft_delete: 'انتقال محتوا به سطل زباله', content_restore: 'بازیابی محتوا',
  content_permanent_delete: 'حذف دائمی محتوا', category_create: 'ایجاد دسته‌بندی', category_update: 'ویرایش دسته‌بندی', category_delete: 'حذف دسته‌بندی',
  role_change: 'تغییر نقش', educator_status_change: 'تغییر وضعیت کاربر'
};

export async function admin(el, { params }) {
  if (!api.isAdmin()) {
    el.innerHTML = `<div class="wrap narrow">${emptyState('دسترسی ندارید', 'این بخش فقط برای مدیر سایت است.', '<a class="btn" href="#/">صفحهٔ اصلی</a>')}</div>`;
    return;
  }
  const tab = TABS.some(([k]) => k === params[0]) ? params[0] : 'users';
  el.innerHTML = `<div class="wrap"><div class="page-head"><h1>پنل مدیریت</h1></div>
    <nav class="tabs" aria-label="بخش‌های مدیریت">${TABS.map(([k, n]) => `<a href="#/admin/${k}" ${k === tab ? 'aria-current="true"' : ''}>${n}${k === 'users' ? '<span class="count hidden" id="pend-count"></span>' : ''}</a>`).join('')}</nav>
    <div id="tab">${loading()}</div></div>`;
  api.sb.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(({ count }) => {
    const c = $('#pend-count', el); if (c && count) { c.textContent = fmtNum(count); c.classList.remove('hidden'); }
  });
  const run = { users, contents, categories, feedback, trash, files, audit, backup }[tab];
  const box = $('#tab', el);
  try { await run(box); } catch (e) { box.innerHTML = errorBox(friendlyError(e)); $('[data-retry]', box)?.addEventListener('click', () => admin(el, { params })); }
}

const must = (r) => { if (r.error) throw r.error; return r.data; };

// ---------- کاربران ----------
async function users(box) {
  const rows = must(await api.sb.from('profiles').select('*').order('created_at', { ascending: false }));
  const me = api.state.session.user.id;
  const pend = rows.filter((r) => r.status === 'pending');
  box.innerHTML = `
    <h2>در انتظار تأیید (${fmtNum(pend.length)})</h2>
    ${pend.length ? pend.map((u) => `<div class="list-item"><div class="info"><b>${esc(u.full_name || 'بدون نام')}</b><div class="muted small ltr">${esc(u.email)}</div><div class="muted small">ثبت‌نام: ${fmtDate(u.created_at)}</div></div>
      <div class="acts"><button class="btn sm" data-u="${u.id}" data-s="approved" type="button">تأیید</button><button class="btn sm danger ghost" data-u="${u.id}" data-s="rejected" type="button">رد</button></div></div>`).join('')
      : '<p class="muted">درخواست جدیدی وجود ندارد.</p>'}
    <h2 style="margin-top:1.6rem">همهٔ کاربران</h2>
    ${rows.map((u) => `<div class="list-item"><div class="info"><b>${esc(u.full_name || 'بدون نام')}</b> <span class="chip">${ROLE_FA[u.role]}</span> <span class="chip ${u.status === 'approved' ? 'ok' : u.status === 'pending' ? 'draft' : 'off'}">${STATUS_FA[u.status]}</span>
      <div class="muted small ltr">${esc(u.email)}</div></div>
      ${u.id === me ? '<span class="muted small">حساب شما</span>' : `<div class="acts">
        <select data-role="${u.id}" aria-label="نقش"><option value="educator" ${u.role === 'educator' ? 'selected' : ''}>مربی</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>مدیر</option></select>
        <select data-status="${u.id}" aria-label="وضعیت">${Object.entries(STATUS_FA).map(([k, n]) => `<option value="${k}" ${u.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`}</div>`).join('')}`;
  const update = async (id, patch, msg) => {
    try { must(await api.sb.from('profiles').update(patch).eq('id', id)); toast(msg, 'ok'); } catch (e) { toast(friendlyError(e), 'error'); }
    users(box);
  };
  $$('[data-u]', box).forEach((b) => b.addEventListener('click', () => withLock(b, () => update(b.dataset.u, { status: b.dataset.s }, b.dataset.s === 'approved' ? 'مربی تأیید شد.' : 'درخواست رد شد.'))));
  $$('[data-role]', box).forEach((s) => s.addEventListener('change', async () => {
    const ok = await confirmDialog({ title: 'تغییر نقش', text: `<p>نقش این کاربر به «${ROLE_FA[s.value]}» تغییر کند؟ ${s.value === 'admin' ? 'مدیر به همهٔ بخش‌های سایت دسترسی کامل دارد.' : ''}</p>`, okText: 'تغییر نقش', danger: s.value === 'admin' });
    if (ok) update(s.dataset.role, { role: s.value, ...(s.value === 'admin' ? { status: 'approved' } : {}) }, 'نقش تغییر کرد.'); else users(box);
  }));
  $$('[data-status]', box).forEach((s) => s.addEventListener('change', () => update(s.dataset.status, { status: s.value }, 'وضعیت کاربر تغییر کرد.')));
}

// ---------- محتواها ----------
async function contents(box) {
  const rows = must(await api.sb.from('contents').select('id,title,kind,status,created_at,updated_at,created_by').is('deleted_at', null).order('created_at', { ascending: false }).limit(300));
  const owners = new Map(must(await api.sb.from('profiles').select('id,full_name,email')).map((p) => [p.id, p.full_name || p.email]));
  box.innerHTML = `<div class="btn-row" style="margin-bottom:1rem"><a class="btn" href="#/new">افزودن محتوای جدید</a></div>
    <div class="field"><label for="cq">جست‌وجو در عنوان‌ها</label><input id="cq" type="search"></div><div id="clist"></div>`;
  const draw = (q = '') => {
    const f = rows.filter((r) => r.title.includes(q));
    $('#clist', box).innerHTML = f.length ? f.map((c) => `<div class="list-item"><div class="info"><b>${esc(c.title)}</b><div class="muted small">
      <span class="chip">${esc(kindLabel(c.kind))}</span> <span class="chip ${c.status === 'draft' ? 'draft' : 'ok'}">${c.status === 'draft' ? 'پیش‌نویس' : 'منتشرشده'}</span>
      ${esc(owners.get(c.created_by) || '')} — ${fmtDate(c.updated_at)}</div></div>
      <div class="acts"><a class="btn sm ghost" href="#/content/${c.id}">مشاهده</a><a class="btn sm soft" href="#/edit/${c.id}">ویرایش</a>
      <button class="btn sm danger ghost" data-del="${c.id}" data-title="${esc(c.title)}" type="button">حذف</button></div></div>`).join('')
      : emptyState('محتوایی وجود ندارد', 'با «افزودن محتوای جدید» شروع کنید.');
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'انتقال به سطل زباله', text: `<p>«${esc(b.dataset.title)}» به سطل زباله منتقل شود؟ بعداً قابل بازیابی است.</p>`, okText: 'انتقال', danger: true }))) return;
      try { await api.softDelete(b.dataset.del); toast('به سطل زباله منتقل شد.', 'ok'); contents(box); } catch (e) { toast(friendlyError(e), 'error'); }
    }));
  };
  draw();
  $('#cq', box).addEventListener('input', (e) => draw(e.target.value.trim()));
}

// ---------- دسته‌بندی‌ها ----------
async function categories(box) {
  const cats = must(await api.sb.from('categories').select('*').order('sort_order').order('name'));
  const { roots, by } = api.buildTree(cats);
  const flat = api.flattenTree(roots);
  box.innerHTML = `
    <form class="panel inline-form" id="addcat">
      <div class="field"><label for="cn">نام دستهٔ جدید</label><input id="cn" type="text" maxlength="120" required></div>
      <div class="field"><label for="cp">زیرمجموعهٔ</label><select id="cp"><option value="">— دستهٔ اصلی —</option>${flat.map((c) => `<option value="${c.id}">${'— '.repeat(c.lvl)}${esc(c.name)}</option>`).join('')}</select></div>
      <button class="btn" type="submit">افزودن</button></form>
    ${flat.length ? flat.map((c) => {
      const sibs = c.parent_id ? by.get(c.parent_id).children : roots;
      const i = sibs.findIndex((s) => s.id === c.id);
      return `<div class="list-item tree-item" style="--lvl:${c.lvl}"><div class="info"><b>${esc(c.name)}</b> ${c.is_active ? '' : '<span class="chip off">غیرفعال</span>'}</div>
      <div class="acts">
        <button class="btn sm ghost" data-up="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="بالا" type="button">▲</button>
        <button class="btn sm ghost" data-down="${c.id}" ${i === sibs.length - 1 ? 'disabled' : ''} aria-label="پایین" type="button">▼</button>
        <button class="btn sm soft" data-edit="${c.id}" type="button">ویرایش</button>
        <button class="btn sm ghost" data-toggle="${c.id}" type="button">${c.is_active ? 'غیرفعال‌کردن' : 'فعال‌کردن'}</button>
        <button class="btn sm danger ghost" data-rm="${c.id}" type="button">حذف</button></div></div>`;
    }).join('') : emptyState('دسته‌بندی‌ای وجود ندارد', 'از فرم بالا یک دسته بسازید.')}`;
  const again = () => categories(box);
  $('#addcat', box).addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#cn', box).value.trim(); if (!name) return;
    const parent = $('#cp', box).value || null;
    const sibs = (parent ? by.get(parent).children : roots);
    const order = sibs.length ? Math.max(...sibs.map((s) => s.sort_order)) + 10 : 10;
    withLock($('button[type=submit]', box), async () => {
      try { must(await api.sb.from('categories').insert({ name, parent_id: parent, sort_order: order })); toast('دسته‌بندی افزوده شد.', 'ok'); again(); } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });
  const move = async (id, dir) => {
    const c = by.get(id); const sibs = c.parent_id ? by.get(c.parent_id).children : roots;
    const i = sibs.findIndex((s) => s.id === id), j = i + dir; if (j < 0 || j >= sibs.length) return;
    const ordered = [...sibs]; [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    try { for (const [k, s] of ordered.entries()) if (s.sort_order !== (k + 1) * 10) must(await api.sb.from('categories').update({ sort_order: (k + 1) * 10 }).eq('id', s.id)); } catch (e) { toast(friendlyError(e), 'error'); }
    again();
  };
  $$('[data-up]', box).forEach((b) => b.addEventListener('click', () => move(b.dataset.up, -1)));
  $$('[data-down]', box).forEach((b) => b.addEventListener('click', () => move(b.dataset.down, 1)));
  $$('[data-toggle]', box).forEach((b) => b.addEventListener('click', async () => {
    const c = by.get(b.dataset.toggle);
    try { must(await api.sb.from('categories').update({ is_active: !c.is_active }).eq('id', c.id)); toast(c.is_active ? 'دسته غیرفعال شد و در سایت نمایش داده نمی‌شود.' : 'دسته فعال شد.', 'ok'); again(); } catch (e) { toast(friendlyError(e), 'error'); }
  }));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', async () => {
    const c = by.get(b.dataset.edit);
    const root = document.getElementById('modal-root'); const back = document.createElement('div'); back.className = 'modal-back';
    const descendants = new Set(); (function walk(n) { n.children.forEach((x) => { descendants.add(x.id); walk(x); }); })(c);
    back.innerHTML = `<form class="modal" role="dialog" aria-modal="true"><h3>ویرایش دسته</h3>
      <div class="field"><label for="en">نام</label><input id="en" type="text" maxlength="120" value="${esc(c.name)}" required></div>
      <div class="field"><label for="ep">زیرمجموعهٔ</label><select id="ep"><option value="">— دستهٔ اصلی —</option>${flat.filter((x) => x.id !== c.id && !descendants.has(x.id)).map((x) => `<option value="${x.id}" ${x.id === c.parent_id ? 'selected' : ''}>${'— '.repeat(x.lvl)}${esc(x.name)}</option>`).join('')}</select></div>
      <div class="btn-row" style="justify-content:flex-end"><button class="btn ghost" type="button" data-x>انصراف</button><button class="btn" type="submit">ذخیره</button></div></form>`;
    root.appendChild(back); $('#en', back).focus();
    back.querySelector('[data-x]').onclick = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
    back.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault(); const name = $('#en', back).value.trim(); if (!name) return;
      try { must(await api.sb.from('categories').update({ name, parent_id: $('#ep', back).value || null }).eq('id', c.id)); back.remove(); toast('ذخیره شد.', 'ok'); again(); } catch (err) { toast(friendlyError(err), 'error'); }
    });
  }));
  $$('[data-rm]', box).forEach((b) => b.addEventListener('click', async () => {
    const c = by.get(b.dataset.rm);
    try {
      const { data, error } = await api.sb.rpc('category_delete_preview', { p_category: c.id }); if (error) throw error;
      const p = data[0];
      if (p.children_count) { toast('این دسته زیرمجموعه دارد. ابتدا زیرمجموعه‌ها را حذف یا منتقل کنید.', 'error'); return; }
      const ok = await confirmDialog({ title: 'حذف دسته‌بندی', danger: true, okText: 'حذف دسته',
        text: `<p>دستهٔ «${esc(c.name)}» حذف می‌شود. فقط ارتباط محتواها با این دسته پاک می‌شود و محتوای دسته‌های دیگر دست‌نخورده می‌ماند.</p>
        ${p.orphan_count ? `<div class="notice warn"><b>${fmtNum(p.orphan_count)} محتوا</b> فقط در همین دسته بوده‌اند و پس از حذف به سطل زباله منتقل می‌شوند (قابل بازیابی). برای نگه‌داشتن آن‌ها، به‌جای حذف، دسته را «غیرفعال» کنید یا ابتدا آن‌ها را به دستهٔ دیگری ببرید.</div>` : '<p class="muted">هیچ محتوایی بدون دسته نمی‌ماند.</p>'}` });
      if (!ok) return;
      const r = await api.sb.rpc('delete_category', { p_category: c.id }); if (r.error) throw r.error;
      toast('دسته حذف شد.' + (r.data ? ` ${fmtNum(r.data)} محتوا به سطل زباله رفت.` : ''), 'ok'); again();
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

// ---------- بازخوردها ----------
async function feedback(box) {
  const rows = must(await api.sb.from('feedback').select('id,rating,comment,created_at,content_id,contents(title)').order('created_at', { ascending: false }).limit(200));
  if (!rows.length) { box.innerHTML = emptyState('بازخوردی ثبت نشده است', 'امتیازها و نظرهای خصوصی بازدیدکنندگان این‌جا نمایش داده می‌شود.'); return; }
  const avg = (rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(1);
  box.innerHTML = `<p class="muted">میانگین امتیاز (۲۰۰ مورد آخر): <b>${fmtNum(avg)}</b> از ۵</p>` + rows.map((r) => `<div class="list-item"><div class="info">
    <a href="#/content/${r.content_id}"><b>${esc(r.contents?.title || 'محتوای حذف‌شده')}</b></a>
    <div>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)} <span class="muted small">${fmtDateTime(r.created_at)}</span></div>
    ${r.comment ? `<p style="margin:.3rem 0 0">${esc(r.comment)}</p>` : ''}</div>
    <button class="btn sm danger ghost" data-fd="${r.id}" type="button">حذف</button></div>`).join('');
  $$('[data-fd]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'حذف بازخورد', text: '<p>این بازخورد برای همیشه حذف شود؟</p>', okText: 'حذف', danger: true }))) return;
    try { must(await api.sb.from('feedback').delete().eq('id', b.dataset.fd)); feedback(box); } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

// ---------- سطل زباله ----------
async function trash(box) {
  const rows = must(await api.sb.from('contents').select('id,title,kind,deleted_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }));
  if (!rows.length) { box.innerHTML = emptyState('سطل زباله خالی است', 'محتوای حذف‌شده برای بازیابی این‌جا نگه‌داری می‌شود.'); return; }
  box.innerHTML = rows.map((c) => `<div class="list-item"><div class="info"><b>${esc(c.title)}</b><div class="muted small"><span class="chip">${esc(kindLabel(c.kind))}</span> حذف‌شده در ${fmtDateTime(c.deleted_at)}</div></div>
    <div class="acts"><button class="btn sm soft" data-restore="${c.id}" type="button">بازیابی</button>
    <button class="btn sm danger ghost" data-perm="${c.id}" data-title="${esc(c.title)}" type="button">حذف برای همیشه</button></div></div>`).join('');
  $$('[data-restore]', box).forEach((b) => b.addEventListener('click', () => withLock(b, async () => {
    try { await api.restoreContent(b.dataset.restore); toast('محتوا بازیابی شد.', 'ok'); trash(box); } catch (e) { toast(friendlyError(e), 'error'); }
  })));
  $$('[data-perm]', box).forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'حذف دائمی', danger: true, okText: 'حذف برای همیشه', requireText: 'حذف',
      text: `<p>«${esc(b.dataset.title)}» برای همیشه حذف می‌شود و قابل بازگشت نیست. فایل‌هایی که فقط در همین محتوا بوده‌اند هم پاک می‌شوند؛ فایل‌های مشترک با محتوای دیگر باقی می‌مانند.</p>` });
    if (!ok) return;
    try { const n = await api.permanentlyDelete(b.dataset.perm); toast('برای همیشه حذف شد' + (n ? ` (${fmtNum(n)} فایل پاک شد)` : '') + '.', 'ok'); trash(box); } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

// ---------- فایل‌ها ----------
async function files(box) {
  const fl = must(await api.sb.from('files').select('*').order('created_at', { ascending: false }).limit(500));
  const refs = must(await api.sb.from('content_files').select('file_id,content_id,contents(title,deleted_at)'));
  const use = new Map(); refs.forEach((r) => { (use.get(r.file_id) || use.set(r.file_id, []).get(r.file_id)).push(r); });
  if (!fl.length) { box.innerHTML = emptyState('فایلی بارگذاری نشده است', 'فایل‌های پیوست محتواها این‌جا فهرست می‌شوند.'); return; }
  const total = fl.reduce((s, f) => s + Number(f.size_bytes), 0);
  box.innerHTML = `<p class="muted">${fmtNum(fl.length)} فایل — مجموع ${fmtSize(total)}</p>` + fl.map((f) => {
    const u = use.get(f.id) || [];
    return `<div class="list-item"><div class="info"><b>${esc(f.file_name)}</b>
      <div class="muted small">${esc(f.mime_type)} — ${fmtSize(f.size_bytes)} — ${fmtDate(f.created_at)}</div>
      <div class="small">${u.length ? 'استفاده‌شده در: ' + u.map((r) => `<a href="#/content/${r.content_id}">${esc(r.contents?.title || '')}</a>${r.contents?.deleted_at ? ' (سطل زباله)' : ''}`).join('، ') : '<span class="chip draft">بدون استفاده</span>'}</div></div>
      <div class="acts"><button class="btn sm soft" data-dl="${esc(f.storage_path)}" data-name="${esc(f.file_name)}" type="button">دانلود</button>
      ${u.length ? '' : `<button class="btn sm danger ghost" data-rmf="${f.id}" type="button">حذف</button>`}</div></div>`;
  }).join('');
  $$('[data-dl]', box).forEach((b) => b.addEventListener('click', async () => { try { location.href = await api.signedUrl(b.dataset.dl, b.dataset.name); } catch (e) { toast(friendlyError(e), 'error'); } }));
  $$('[data-rmf]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'حذف فایل بدون استفاده', text: '<p>این فایل به هیچ محتوایی وصل نیست و برای همیشه پاک می‌شود.</p>', okText: 'حذف', danger: true }))) return;
    try {
      const { data, error } = await api.sb.rpc('delete_unused_file', { p_file: b.dataset.rmf }); if (error) throw error;
      if (data) await api.sb.storage.from(api.BUCKET).remove([data]);
      toast('فایل حذف شد.', 'ok'); files(box);
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}

// ---------- گزارش اقدامات ----------
async function audit(box) {
  const rows = must(await api.sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200));
  if (!rows.length) { box.innerHTML = emptyState('گزارشی ثبت نشده است', 'اقدامات مهم مدیران و مربیان این‌جا ثبت می‌شود.'); return; }
  box.innerHTML = `<p class="muted small">۲۰۰ اقدام آخر</p>` + rows.map((r) => {
    const d = r.details || {};
    const what = d.title || d.name || d.email || '';
    const extra = r.action === 'role_change' ? ` (${ROLE_FA[d.old_role]} ← ${ROLE_FA[d.new_role]})` : r.action === 'educator_status_change' ? ` (${STATUS_FA[d.old_status]} ← ${STATUS_FA[d.new_status]})` : '';
    return `<div class="list-item"><div class="info"><b>${esc(ACTION_FA[r.action] || r.action)}</b> ${what ? '— ' + esc(what) : ''}${esc(extra)}
      <div class="muted small">${esc(r.actor_email || 'سیستم')} — ${fmtDateTime(r.created_at)}</div></div></div>`;
  }).join('');
}

// ---------- پشتیبان‌گیری ----------
async function backup(box) {
  box.innerHTML = `<div class="panel"><h3>دریافت نسخهٔ پشتیبان از اطلاعات (JSON)</h3>
    <p>این دکمه همهٔ اطلاعات متنی سایت (محتواها، دسته‌ها، کاربران، بازخوردها و گزارش‌ها) را در یک فایل ذخیره می‌کند.</p>
    <div class="notice warn"><b>توجه:</b> این فایل شامل خودِ فایل‌های بارگذاری‌شده (PDF، صوت، تصویر…) نیست. برای پشتیبان فایل‌ها راهنمای راه‌اندازی را ببینید. فایل پشتیبان شامل ایمیل کاربران و بازخوردهاست؛ آن را در جای امن نگه دارید.</div>
    <button class="btn" id="bk" type="button">دریافت فایل پشتیبان</button></div>`;
  const b = $('#bk', box);
  b.addEventListener('click', () => withLock(b, async () => {
    try {
      const tables = ['profiles', 'categories', 'contents', 'content_categories', 'files', 'content_files', 'content_links', 'feedback', 'audit_log'];
      const out = { exported_at: new Date().toISOString(), tables: {} };
      for (const t of tables) {
        let all = [], from = 0;
        for (;;) { const { data, error } = await api.sb.from(t).select('*').range(from, from + 999); if (error) throw error; all = all.concat(data); if (data.length < 1000) break; from += 1000; }
        out.tables[t] = all;
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = 'salehat-backup-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('فایل پشتیبان آماده شد.', 'ok');
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}
