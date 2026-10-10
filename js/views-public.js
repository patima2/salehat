import * as api from './api.js';
import { editor } from './views-editor.js';
import { esc, $, $$, ICON, KINDS, kindLabel, fmtDate, fmtSize, sanitizeHtml, emptyState, loading, errorBox, toast, withLock, friendlyError, getClientToken, debounce, confirmDialog } from './util.js';

const rowHtml = (c) => `
  <li><a class="row" href="#/content/${c.id}">
    <span class="t">${esc(c.title)}</span>
    <span class="m"><span class="chip">${esc(kindLabel(c.kind))}</span>
      ${(c.category_names || []).slice(0, 3).map((n) => `<span>${esc(n)}</span>`).join('<span aria-hidden="true">·</span>')}
      ${c.author_name ? `<span aria-hidden="true">·</span><span>${esc(c.author_name)}</span>` : ''}
    </span>
    ${c.summary ? `<span class="s">${esc(c.summary)}</span>` : ''}
  </a></li>`;

const listHtml = (rows) => `<ul class="rows">${rows.map(rowHtml).join('')}</ul>`;

function searchForm(q = '') {
  return `<form role="search" data-search-form>
    <label class="hidden" for="q">جست‌وجو</label>
    <input id="q" type="search" name="q" value="${esc(q)}" placeholder="جست‌وجو در منابع…" enterkeyhint="search" autocomplete="off">
    <button class="btn" type="submit">جست‌وجو</button>
  </form>`;
}
export function bindSearch(root) {
  $$('[data-search-form]', root).forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(f).get('q').toString().trim();
    location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/search';
  }));
}

// ---------- صفحهٔ اصلی ----------
export async function home(el) {
  el.innerHTML = `
  <section class="hero">
    ${ICON.branch('orn-a')}${ICON.branch('orn-b')}
    <div class="wrap">
      <h1>بانک محتوای تربیتی صالحات</h1>
      <img class="hero-logo" src="assets/logo-salehat.png" alt="لوگوی صالحات" width="640" height="640">
      <p class="lead">منابع و طرح درس‌های موردنیاز مربیان، یک‌جا.</p>
      ${ICON.divider('orn-divider')}
    </div>
  </section>
  <div class="searchbox">${searchForm()}</div>
  <div class="wrap">
    <div class="portals">
      <a class="portal one" href="#/library">${ICON.branch('orn-c')}<h2>کتابخانهٔ مربیان</h2><p>کتاب‌ها و منابع کتابخانه‌ای.</p></a>
      <a class="portal two" href="#/topics">${ICON.branch('orn-c')}<h2>موضوعات و طرح درس‌ها</h2><p>دسته‌بندی موضوعی و طرح درس‌های آماده.</p></a>
    </div>
    <div class="section-head"><h2>تازه‌ها</h2><a href="#/topics">همهٔ موضوعات</a></div>
    <div id="recent">${loading()}</div>
    <div class="section-head"><h2>دسته‌بندی‌ها</h2><a href="#/topics">همه</a></div>
    <div id="cats">${loading()}</div>
  </div>`;
  bindSearch(el);
  try {
    const rows = await api.searchContents({ limit: 8, library: false });
    $('#recent', el).innerHTML = rows.length
      ? listHtml(rows)
      : emptyState('هنوز محتوایی اضافه نشده است', 'به‌زودی منابع و طرح درس‌ها در این‌جا قرار می‌گیرند. از شکیبایی شما سپاسگزاریم.');
  } catch (e) { $('#recent', el).innerHTML = errorBox(friendlyError(e)); }
  try {
    const { roots } = api.buildTree(await api.fetchCategories());
    $('#cats', el).innerHTML = roots.length
      ? `<div class="filters">${roots.map((c) => `<a href="#/category/${c.id}">${esc(c.name)}</a>`).join('')}</div>`
      : `<p class="muted">دسته‌بندی‌ای تعریف نشده است.</p>`;
  } catch (e) { $('#cats', el).innerHTML = errorBox(friendlyError(e)); }
}

// ---------- فهرست صفحه‌بندی‌شده ----------
async function pagedList(box, params, emptyHtml, decorate = null) {
  const PAGE = 20;
  let offset = 0;
  box.innerHTML = loading();
  const load = async (append) => {
    try {
      const rows = await api.searchContents({ ...params, limit: PAGE, offset });
      if (!append && !rows.length) { box.innerHTML = emptyHtml; return; }
      if (!append) box.innerHTML = '<ul class="rows"></ul><div class="btn-row" style="justify-content:center;margin-top:1rem" id="more-row"></div>';
      $('ul.rows', box).insertAdjacentHTML('beforeend', rows.map(rowHtml).join(''));
      offset += rows.length;
      if (decorate) { try { await decorate(rows, box); } catch { /* دکمهٔ حذف اختیاری است */ } }
      const mr = $('#more-row', box);
      mr.innerHTML = rows.length === PAGE ? '<button class="btn ghost" type="button">نمایش بیشتر</button>' : '';
      const b = mr.querySelector('button');
      if (b) b.onclick = () => withLock(b, () => load(true));
    } catch (e) {
      box.innerHTML = errorBox(friendlyError(e));
      $('[data-retry]', box)?.addEventListener('click', () => pagedList(box, params, emptyHtml, decorate));
    }
  };
  await load(false);
}

// ---------- کتابخانهٔ مربیان (فقط کتاب‌هایی که با «افزودن کتاب» ثبت شده‌اند) ----------
export async function library(el) {
  el.innerHTML = `<div class="wrap">
    <div class="page-head"><h1>کتابخانهٔ مربیان</h1><p class="muted">کتاب‌ها و منابع کتابخانه‌ای</p>
    ${api.canEdit() ? '<a class="btn sm ghost" href="#/library/new">+ افزودن کتاب</a>' : ''}</div>
    <div id="list"></div></div>`;
  // مدیر همه‌ی کتاب‌ها را می‌تواند مدیریت کند؛ مربی فقط کتاب‌های خودش (دیتابیس هم همین را اعمال می‌کند)
  const decorate = async (rows, box) => {
    if (!api.canEdit()) return;
    const { data } = await api.sb.from('contents').select('id,created_by').in('id', rows.map((r) => r.id));
    const mine = new Set((data || []).filter((r) => api.isAdmin() || r.created_by === api.state.session.user.id).map((r) => r.id));
    $$('li', box).forEach((li) => {
      const id = /content\/([\w-]+)/.exec(li.querySelector('a.row')?.getAttribute('href') || '')?.[1];
      if (!id || !mine.has(id) || li.querySelector('.row-del')) return;
      li.classList.add('has-del');
      li.insertAdjacentHTML('beforeend', `<a class="mini-del edit" href="#/edit/${id}">ویرایش</a><button class="mini-del row-del" type="button" data-delcontent="${id}" data-title="${esc(li.querySelector('.t')?.textContent || '')}">حذف</button>`);
    });
  };
  $('#list', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delcontent]'); if (!b) return;
    if (!(await confirmDialog({ title: 'حذف کتاب', text: `<p>«${esc(b.dataset.title)}» به سطل زباله منتقل می‌شود و دیگر در کتابخانه نمایش داده نمی‌شود. مدیر می‌تواند آن را بازیابی کند.</p>`, okText: 'انتقال به سطل زباله', danger: true }))) return;
    try { await api.softDelete(b.dataset.delcontent); toast('کتاب به سطل زباله منتقل شد.', 'ok'); library(el); } catch (err) { toast(friendlyError(err), 'error'); }
  });
  await pagedList($('#list', el), { library: true }, emptyState('هنوز کتابی در کتابخانه نیست', 'کتاب‌هایی که با «افزودن کتاب» ثبت شوند این‌جا نمایش داده می‌شوند.'), decorate);
}

// ---------- موضوعات و طرح درس‌ها ----------
export async function topics(el) {
  el.innerHTML = `<div class="wrap"><div class="page-head"><h1>موضوعات و طرح درس‌ها</h1><p class="muted">یک موضوع را انتخاب کنید.</p></div>
    <div id="cats">${loading()}</div>
    <div class="section-head"><h2>جدیدترین طرح درس‌ها</h2></div><div id="plans"></div></div>`;
  try {
    const { roots } = api.buildTree(await api.fetchCategories());
    $('#cats', el).innerHTML = roots.length ? `<div class="cat-list">${roots.map((c) => `
      <div class="cat"><a class="name" href="#/category/${c.id}">${ICON.flower}${esc(c.name)}</a>
        ${c.children.length ? `<div class="subs">${c.children.map((s) => `<a class="chip" href="#/category/${s.id}">${esc(s.name)}</a>`).join('')}</div>` : ''}
      </div>`).join('')}</div>` : emptyState('دسته‌بندی‌ای وجود ندارد', 'مدیر سایت می‌تواند دسته‌بندی‌ها را اضافه کند.');
  } catch (e) { $('#cats', el).innerHTML = errorBox(friendlyError(e)); }
  await pagedList($('#plans', el), { kinds: ['lesson_plan'] }, emptyState('هنوز طرح درسی منتشر نشده است', 'طرح درس‌های جدید این‌جا نمایش داده می‌شوند.'));
}

export async function category(el, { params }) {
  el.innerHTML = `<div class="wrap">${loading()}</div>`;
  let cats;
  try { cats = await api.fetchCategories(); } catch (e) { el.innerHTML = `<div class="wrap">${errorBox(friendlyError(e))}</div>`; return; }
  const { by } = api.buildTree(cats);
  const cat = by.get(params[0]);
  if (!cat || !cat.is_active) { el.innerHTML = `<div class="wrap">${emptyState('این دسته پیدا نشد', 'ممکن است حذف یا غیرفعال شده باشد.', '<a class="btn" href="#/topics">بازگشت به موضوعات</a>')}</div>`; return; }
  const path = api.categoryPath(by, cat.id);
  // حذف زیرشاخه: مدیر همه؛ مربی فقط زیرشاخه‌ای که خودش ساخته (دیتابیس هم همین را اعمال می‌کند)
  const canDeleteCat = (c) => api.canEdit() && (api.isAdmin() || (c.created_by && c.created_by === api.state.session.user.id));
  el.innerHTML = `<div class="wrap">
    <div class="page-head">
      <div class="crumbs"><a href="#/topics">موضوعات</a>${path.map((p) => `<span class="sep">‹</span>${p.id === cat.id ? esc(p.name) : `<a href="#/category/${p.id}">${esc(p.name)}</a>`}`).join('')}</div>
      <h1>${esc(cat.name)}</h1>
    </div>
    ${cat.children.filter((c) => c.is_active).length ? `<h2 class="sub-title">زیرشاخه‌ها</h2><div class="subcards">${cat.children.filter((c) => c.is_active).map((c) => `<div class="subcard"><a class="name ${canDeleteCat(c) ? 'has-del' : ''}" href="#/category/${c.id}">${ICON.flower}<span>${esc(c.name)}</span></a>${canDeleteCat(c) ? `<button class="mini-del" type="button" data-delcat="${c.id}" aria-label="حذف زیرشاخهٔ ${esc(c.name)}">حذف</button>` : ''}</div>`).join('')}</div>` : ''}
    ${api.canEdit() ? `<div class="btn-row cat-actions" id="cat-actions"><button class="btn sm ghost" type="button" id="add-content">+ افزودن محتوا</button><button class="btn sm ghost" type="button" id="add-sub">+ افزودن زیرشاخه</button></div>` : ''}
    <div id="inline"></div>
    <div id="list"></div></div>`;
  const reload = () => category(el, { params });
  if (api.canEdit()) {
    const inline = $('#inline', el), list = $('#list', el), actions = $('#cat-actions', el);
    const close = () => { inline.innerHTML = ''; list.classList.remove('hidden'); actions.classList.remove('hidden'); window.onbeforeunload = null; };
    const open = () => { list.classList.add('hidden'); actions.classList.add('hidden'); };
    $('#add-content', el).addEventListener('click', async () => {
      open();
      await editor(inline, { presetCategory: cat.id, onSaved: () => { toast('محتوا ذخیره شد.', 'ok'); reload(); }, onCancel: close });
      inline.scrollIntoView({ block: 'start' });
    });
    $('#add-sub', el).addEventListener('click', () => {
      open();
      inline.innerHTML = `<form class="panel" id="subform" novalidate><h3>افزودن زیرشاخه</h3>
        <div class="field"><label for="sub-parent">والد</label><input id="sub-parent" type="text" value="${esc(cat.name)}" readonly></div>
        <div class="field"><label for="sub-name">نام زیرشاخه *</label><input id="sub-name" type="text" maxlength="120" required></div>
        <div class="btn-row"><button class="btn" type="submit">ایجاد زیرشاخه</button><button class="btn ghost" type="button" id="sub-cancel">انصراف</button></div></form>`;
      $('#sub-name', el).focus();
      $('#sub-cancel', el).addEventListener('click', close);
      $('#subform', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = $('#sub-name', el).value.trim();
        if (!name) { toast('نام زیرشاخه را وارد کنید.', 'error'); return; }
        withLock($('#subform button[type=submit]', el), async () => {
          try {
            const sibs = cat.children;
            const order = sibs.length ? Math.max(...sibs.map((x) => x.sort_order)) + 10 : 10;
            const { error } = await api.sb.from('categories').insert({ name, parent_id: cat.id, sort_order: order });
            if (error) throw error;
            toast('زیرشاخه ایجاد شد.', 'ok'); reload();
          } catch (err) { toast(friendlyError(err), 'error'); }
        });
      });
    });
  }
  // --- حذف زیرشاخه ---
  $$('[data-delcat]', el).forEach((b) => b.addEventListener('click', async () => {
    const c = by.get(b.dataset.delcat);
    try {
      let body;
      if (api.isAdmin()) {
        const { data, error } = await api.sb.rpc('category_delete_preview', { p_category: c.id }); if (error) throw error;
        const pv = data[0];
        if (pv.children_count) { toast('این زیرشاخه خودش زیرشاخه دارد. ابتدا زیرشاخه‌های داخل آن را حذف کنید.', 'error'); return; }
        body = `<p>زیرشاخهٔ «${esc(c.name)}» حذف می‌شود. این کار قابل بازگشت نیست.</p>` + (pv.orphan_count
          ? `<div class="notice warn"><b>${pv.orphan_count.toLocaleString('fa-IR')} محتوا</b> فقط در همین زیرشاخه بوده‌اند و به سطل زباله منتقل می‌شوند (قابل بازیابی). محتواهایی که در دسته‌های دیگر هم هستند فقط از این زیرشاخه جدا می‌شوند.</div>`
          : '<p class="muted">هیچ محتوایی بدون دسته نمی‌ماند.</p>');
      } else {
        body = `<p>زیرشاخهٔ «${esc(c.name)}» که خودتان ساخته‌اید حذف می‌شود. این کار قابل بازگشت نیست. فقط زیرشاخهٔ خالی (بدون محتوا و بدون زیرشاخه) قابل حذف است.</p>`;
      }
      if (!(await confirmDialog({ title: 'حذف زیرشاخه', text: body, okText: 'حذف زیرشاخه', danger: true }))) return;
      const r = await api.sb.rpc('delete_category', { p_category: c.id }); if (r.error) throw r.error;
      toast('زیرشاخه حذف شد.' + (r.data ? ` ${r.data.toLocaleString('fa-IR')} محتوا به سطل زباله رفت.` : ''), 'ok'); reload();
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));

  // --- حذف محتوا (کنار هر محتوا): مدیر همه؛ مربی فقط محتوای خودش ---
  const decorate = async (rows, box) => {
    if (!api.canEdit()) return;
    const ids = rows.map((r) => r.id);
    const { data } = await api.sb.from('contents').select('id,created_by').in('id', ids);
    const mine = new Set((data || []).filter((r) => api.isAdmin() || r.created_by === api.state.session.user.id).map((r) => r.id));
    $$('li', box).forEach((li) => {
      const id = /content\/([\w-]+)/.exec(li.querySelector('a.row')?.getAttribute('href') || '')?.[1];
      if (!id || !mine.has(id) || li.querySelector('.row-del')) return;
      li.classList.add('has-del');
      li.insertAdjacentHTML('beforeend', `<button class="mini-del row-del" type="button" data-delcontent="${id}" data-title="${esc(li.querySelector('.t')?.textContent || '')}">حذف</button>`);
    });
  };
  $('#list', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-delcontent]'); if (!b) return;
    if (!(await confirmDialog({ title: 'حذف محتوا', text: `<p>«${esc(b.dataset.title)}» به سطل زباله منتقل می‌شود و دیگر در سایت نمایش داده نمی‌شود. مدیر می‌تواند آن را بازیابی کند.</p>`, okText: 'انتقال به سطل زباله', danger: true }))) return;
    try { await api.softDelete(b.dataset.delcontent); toast('محتوا به سطل زباله منتقل شد.', 'ok'); reload(); } catch (err) { toast(friendlyError(err), 'error'); }
  });
  await pagedList($('#list', el), { category: cat.id }, emptyState('هنوز محتوایی در این دسته نیست', 'محتوای تازه پس از انتشار در این‌جا نمایش داده می‌شود.'), decorate);
}

// ---------- جست‌وجو ----------
export async function search(el, { query }) {
  const q = (query.get('q') || '').trim();
  const kind = query.get('kind') || '';
  const cat = query.get('cat') || '';
  let cats = [];
  try { cats = api.flattenTree(api.buildTree(await api.fetchCategories()).roots); } catch { /* فیلتر دسته اختیاری است */ }
  el.innerHTML = `<div class="wrap">
    <div class="page-head"><h1>جست‌وجو</h1></div>
    <form class="panel" id="sf" role="search">
      <div class="field"><label for="q">عبارت</label><input id="q" type="search" name="q" value="${esc(q)}" placeholder="عنوان، متن، نویسنده، نام کتاب یا فایل…" autocomplete="off"></div>
      <div class="inline-form">
        <div class="field"><label for="k">نوع محتوا</label><select id="k" name="kind"><option value="">همه</option>${Object.entries(KINDS).map(([k, n]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label for="c">دسته‌بندی</label><select id="c" name="cat"><option value="">همه</option>${cats.map((c) => `<option value="${c.id}" ${c.id === cat ? 'selected' : ''}>${'— '.repeat(c.lvl)}${esc(c.name)}</option>`).join('')}</select></div>
        <button class="btn" type="submit">جست‌وجو</button>
      </div>
    </form>
    <div id="list"></div></div>`;
  $('#sf', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const p = new URLSearchParams();
    for (const k of ['q', 'kind', 'cat']) { const v = (fd.get(k) || '').toString().trim(); if (v) p.set(k, v); }
    location.hash = '#/search' + (p.toString() ? '?' + p : '');
  });
  await pagedList($('#list', el), { q, kinds: kind ? [kind] : null, category: cat || null },
    emptyState('نتیجه‌ای پیدا نشد', 'عبارت دیگری را امتحان کنید یا فیلترها را کم کنید.'));
}

// ---------- صفحهٔ محتوا ----------
const isImg = (m) => m.startsWith('image/');
const isAudio = (m) => m.startsWith('audio/');
const isVideo = (m) => m.startsWith('video/');

export async function contentPage(el, { params }) {
  el.innerHTML = `<div class="wrap narrow">${loading()}</div>`;
  let c, cats;
  try { [c, cats] = await Promise.all([api.fetchContent(params[0]), api.fetchCategories().catch(() => [])]); }
  catch (e) { el.innerHTML = `<div class="wrap narrow">${errorBox(friendlyError(e))}</div>`; $('[data-retry]', el)?.addEventListener('click', () => contentPage(el, { params })); return; }
  if (!c) { el.innerHTML = `<div class="wrap narrow">${emptyState('این محتوا پیدا نشد', 'ممکن است حذف شده یا هنوز منتشر نشده باشد.', '<a class="btn" href="#/">صفحهٔ اصلی</a>')}</div>`; return; }

  const { by } = api.buildTree(cats);
  const paths = c.category_ids.map((id) => api.categoryPath(by, id)).filter((p) => p.length);
  const files = c.files.map((x) => ({ ...x.files, description: x.description, cfId: x.id })).filter((f) => f.id);
  const [viewUrls, dlUrls, related] = await Promise.all([
    api.signedUrls(files), api.signedUrls(files, { download: true }), api.fetchRelated(c).catch(() => [])
  ]);
  const body = sanitizeHtml(c.body);
  const mine = api.state.session && (c.created_by === api.state.session.user.id || api.isAdmin());

  el.innerHTML = `<div class="wrap narrow" style="padding-top:1.5rem">
    <article class="article">
      <svg class="orn-corner" aria-hidden="true" viewBox="0 0 240 150"><use href="#orn-branch"/></svg>
      <div class="crumbs"><a href="#/">خانه</a><span class="sep">‹</span>${c.in_library ? '<a href="#/library">کتابخانه</a>' : '<a href="#/topics">موضوعات</a>'}</div>
      <h1>${esc(c.title)}</h1>
      <div class="meta"><span class="chip">${esc(kindLabel(c.kind))}</span>
        ${c.status === 'draft' ? '<span class="chip draft">پیش‌نویس</span>' : ''}
        ${c.author_name ? `<span>نویسنده/تهیه‌کننده: ${esc(c.author_name)}</span>` : ''}
        ${c.source_title ? `<span>منبع: ${esc(c.source_title)}</span>` : ''}
        <span>تاریخ: ${fmtDate(c.created_at)}</span>
        ${c.updated_at && c.updated_at.slice(0, 10) !== c.created_at.slice(0, 10) ? `<span>آخرین ویرایش: ${fmtDate(c.updated_at)}</span>` : ''}
      </div>
      ${paths.length ? `<div class="cat-paths">${paths.map((p) => `<a class="chip" href="#/category/${p[p.length - 1].id}">${p.map((x) => esc(x.name)).join(' ‹ ')}</a>`).join('')}</div>` : ''}
      ${mine ? `<div class="btn-row" style="margin-bottom:1rem"><a class="btn sm ghost" href="#/edit/${c.id}">ویرایش</a></div>` : ''}
      ${c.summary ? `<p class="lead-summary">${esc(c.summary)}</p>` : ''}
      ${body ? `<div class="prose">${body}</div>` : ''}
      ${files.length ? `<h2 style="margin-top:1.6rem">فایل‌ها</h2><div class="attach">${files.map((f) => attachHtml(f, viewUrls[f.id], dlUrls[f.id])).join('')}</div>` : ''}
      ${c.links.length ? `<h2 style="margin-top:1.6rem">لینک‌ها</h2><ul class="linklist">${c.links.map((l) => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(l.title || l.url)}</a>${l.description ? `<div class="muted small">${esc(l.description)}</div>` : ''}</li>`).join('')}</ul>` : ''}
      ${related.length ? `<h2 style="margin-top:1.6rem">محتواهای مرتبط</h2>${listHtml(related.map((r) => ({ ...r, category_names: [] })))}` : ''}
      <section class="fb" id="fb" aria-labelledby="fbt"></section>
    </article></div>`;
  if (c.status === 'published') renderFeedback($('#fb', el), c.id); else $('#fb', el).remove();
}

function attachHtml(f, view, dl) {
  const m = f.mime_type || '';
  let preview = '';
  if (view) {
    if (isImg(m)) preview = `<img src="${esc(view)}" alt="${esc(f.description || f.file_name)}" loading="lazy">`;
    else if (isAudio(m)) preview = `<audio controls preload="none" src="${esc(view)}">مرورگر شما پخش صوت را پشتیبانی نمی‌کند.</audio>`;
    else if (isVideo(m)) preview = `<video controls preload="metadata" playsinline src="${esc(view)}">مرورگر شما پخش ویدئو را پشتیبانی نمی‌کند.</video>`;
    else if (m === 'application/pdf') preview = `<details style="margin-top:.5rem"><summary class="small" style="cursor:pointer;color:var(--wine)">پیش‌نمایش PDF</summary><iframe src="${esc(view)}" title="${esc(f.file_name)}"></iframe><p class="hint">اگر پیش‌نمایش در گوشی نمایش داده نشد، فایل را دانلود کنید.</p></details>`;
  }
  return `<div class="att"><div class="top"><span class="name"><bdi>${esc(f.file_name)}</bdi> <span class="muted small">(${fmtSize(f.size_bytes)})</span></span>
    ${dl ? `<a class="btn sm soft" href="${esc(dl)}" download="${esc(f.file_name)}">دانلود</a>` : '<span class="muted small">فایل در دسترس نیست</span>'}</div>
    ${f.description ? `<p class="d">${esc(f.description)}</p>` : ''}${preview}</div>`;
}

function renderFeedback(box, contentId) {
  let rating = 0;
  box.innerHTML = `<h3 id="fbt">نظر شما دربارهٔ این محتوا</h3>
    <p class="hint">امتیاز و بازخورد شما خصوصی است، نمایش عمومی ندارد و فقط مدیر سایت آن را می‌بیند. نام یا اطلاعات هویتی دریافت نمی‌شود.</p>
    <div class="stars" role="radiogroup" aria-label="امتیاز">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" aria-label="${n} از ۵" data-n="${n}">★</button>`).join('')}</div>
    <div class="field"><label for="fbc">بازخورد (اختیاری)</label><textarea id="fbc" maxlength="1000" rows="3"></textarea></div>
    <div class="hp" aria-hidden="true"><input type="text" id="fbh" tabindex="-1" autocomplete="off"></div>
    <button class="btn" type="button" id="fbs">ثبت</button>`;
  const stars = $$('.stars button', box);
  const paint = () => stars.forEach((b) => { const on = Number(b.dataset.n) <= rating; b.classList.toggle('on', on); b.setAttribute('aria-checked', Number(b.dataset.n) === rating ? 'true' : 'false'); });
  stars.forEach((b) => b.addEventListener('click', () => { rating = Number(b.dataset.n); paint(); }));
  const send = $('#fbs', box);
  send.addEventListener('click', () => withLock(send, async () => {
    if ($('#fbh', box).value) return; // ربات
    if (!rating) { toast('ابتدا امتیاز را انتخاب کنید.', 'error'); return; }
    try {
      await api.submitFeedback(contentId, rating, $('#fbc', box).value.trim(), getClientToken());
      box.innerHTML = '<div class="notice ok" style="margin:0">سپاسگزاریم؛ بازخورد شما ثبت شد.</div>';
    } catch (e) { toast(friendlyError(e), 'error'); }
  }));
}
