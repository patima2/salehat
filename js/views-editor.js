import * as api from './api.js';
import { esc, $, $$, KINDS, kindLabel, fmtDate, fmtSize, sanitizeHtml, isHttpUrl, emptyState, loading, errorBox, toast, withLock, friendlyError, confirmDialog } from './util.js';

function needEditor(el) {
  if (!api.isLoggedIn()) { el.innerHTML = `<div class="wrap narrow">${emptyState('ابتدا وارد شوید', 'برای افزودن محتوا باید وارد حساب مربی شوید.', '<a class="btn" href="#/login">ورود</a>')}</div>`; return false; }
  if (!api.canEdit()) { el.innerHTML = `<div class="wrap narrow">${emptyState('حساب شما هنوز تأیید نشده است', 'پس از تأیید مدیر می‌توانید محتوا اضافه کنید.')}</div>`; return false; }
  return true;
}

// ---------- محتواهای من ----------
export async function myContents(el) {
  if (!needEditor(el)) return;
  el.innerHTML = `<div class="wrap"><div class="page-head"><h1>محتواهای من</h1>
    <a class="btn" href="#/new">افزودن محتوای جدید</a></div><div id="list">${loading()}</div></div>`;
  const load = async () => {
    const box = $('#list', el);
    const { data, error } = await api.sb.from('contents').select('id,title,kind,status,created_at,updated_at')
      .eq('created_by', api.state.session.user.id).is('deleted_at', null).order('created_at', { ascending: false });
    if (error) { box.innerHTML = errorBox(friendlyError(error)); $('[data-retry]', box)?.addEventListener('click', load); return; }
    if (!data.length) { box.innerHTML = emptyState('هنوز محتوایی ثبت نکرده‌اید', 'با دکمهٔ «افزودن محتوای جدید» شروع کنید.'); return; }
    box.innerHTML = data.map((c) => `<div class="list-item"><div class="info"><b>${esc(c.title)}</b><div class="muted small">
      <span class="chip">${esc(kindLabel(c.kind))}</span> ${c.status === 'draft' ? '<span class="chip draft">پیش‌نویس</span>' : '<span class="chip ok">منتشرشده</span>'}
      ${fmtDate(c.updated_at)}</div></div>
      <div class="acts"><a class="btn sm ghost" href="#/content/${c.id}">مشاهده</a><a class="btn sm soft" href="#/edit/${c.id}">ویرایش</a>
      <button class="btn sm danger ghost" data-del="${c.id}" data-title="${esc(c.title)}" type="button">حذف</button></div></div>`).join('');
    $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'انتقال به سطل زباله', text: `<p>«${esc(b.dataset.title)}» به سطل زباله منتقل می‌شود و دیگر نمایش داده نمی‌شود. مدیر می‌تواند آن را بازیابی کند.</p>`, okText: 'انتقال به سطل زباله', danger: true });
      if (!ok) return;
      try { await api.softDelete(b.dataset.del); toast('محتوا به سطل زباله منتقل شد.', 'ok'); load(); } catch (e) { toast(friendlyError(e), 'error'); }
    }));
  };
  load();
}

// ---------- ویرایشگر ----------
let uid = 0;
const nextKey = () => 'k' + ++uid;

// presetCategory / onSaved / onCancel: برای باز کردن فرم داخل صفحهٔ دسته (اختیاری)
export async function editor(el, { params = [], presetCategory = null, onSaved = null, onCancel = null }) {
  if (!needEditor(el)) return;
  const editId = params[0] || null;
  el.innerHTML = `<div class="wrap narrow">${loading()}</div>`;
  let cats, existing = null;
  try {
    cats = await api.fetchCategories();
    if (editId) {
      existing = await api.fetchContent(editId);
      if (!existing) throw new Error('این محتوا پیدا نشد.');
      if (!api.isAdmin() && existing.created_by !== api.state.session.user.id) throw new Error('شما فقط می‌توانید محتوای خودتان را ویرایش کنید.');
      if (existing.deleted_at) throw new Error('این محتوا در سطل زباله است.');
    }
  } catch (e) { el.innerHTML = `<div class="wrap narrow">${errorBox(friendlyError(e), false)}<a class="btn" href="#/my">بازگشت</a></div>`; return; }

  const flat = api.flattenTree(api.buildTree(cats).roots);
  const st = {
    kind: existing?.kind || 'article', status: existing?.status || 'published',
    cats: new Set(existing?.category_ids || (presetCategory ? [presetCategory] : [])),
    files: (existing?.files || []).filter((f) => f.files).map((f) => ({ key: nextKey(), cfId: f.id, fileId: f.file_id, meta: f.files, description: f.description, pending: null })),
    links: (existing?.links || []).map((l) => ({ key: nextKey(), id: l.id, url: l.url, title: l.title, description: l.description })),
    dirty: false, saving: false
  };
  const markDirty = () => { st.dirty = true; };
  window.onbeforeunload = () => (st.dirty ? 'تغییرات ذخیره‌نشده از بین می‌رود.' : undefined);

  el.innerHTML = `<div class="wrap narrow"><div class="page-head"><h1>${editId ? 'ویرایش محتوا' : 'محتوای جدید'}</h1></div>
  <form id="cf" novalidate>
    <div class="panel">
      <div class="field"><label for="f-title">عنوان *</label><input id="f-title" type="text" maxlength="250" value="${esc(existing?.title || '')}"></div>
      <div class="field"><label for="f-kind">نوع محتوا</label><select id="f-kind">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}" ${k === st.kind ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="field"><label for="f-sum">توضیح کوتاه</label><textarea id="f-sum" maxlength="1000" rows="2">${esc(existing?.summary || '')}</textarea></div>
      <div class="field"><label for="f-author">نویسنده یا تهیه‌کننده</label><input id="f-author" type="text" maxlength="200" value="${esc(existing?.author_name || '')}"></div>
      <div class="field" style="margin:0"><label for="f-source">عنوان کتاب یا منبع</label><input id="f-source" type="text" maxlength="300" value="${esc(existing?.source_title || '')}"></div>
    </div>
    <div class="panel"><h3>دسته‌بندی‌ها *</h3>
      ${flat.length ? `<div class="cat-pick" id="catpick" role="group" aria-label="دسته‌بندی‌ها">${flat.map((c) => `<label class="check lvl${Math.min(c.lvl, 2)}"><input type="checkbox" value="${c.id}" ${st.cats.has(c.id) ? 'checked' : ''}> ${esc(c.name)}${c.is_active ? '' : ' <span class="chip off">غیرفعال</span>'}</label>`).join('')}</div><div class="hint">می‌توانید چند دسته و زیرمجموعه انتخاب کنید.</div>`
        : '<div class="notice warn">هنوز دسته‌بندی‌ای تعریف نشده است. ابتدا مدیر باید دسته‌بندی بسازد.</div>'}
    </div>
    <div class="panel"><h3>متن اصلی</h3>
      <div class="rte-bar" role="toolbar" aria-label="قالب‌بندی">
        <button type="button" data-cmd="bold" title="پررنگ" aria-label="پررنگ">B</button>
        <button type="button" data-cmd="italic" title="مورب" aria-label="مورب"><i>I</i></button>
        <button type="button" data-cmd="h2" title="تیتر" aria-label="تیتر">تیتر</button>
        <button type="button" data-cmd="p" title="پاراگراف" aria-label="پاراگراف">متن</button>
        <button type="button" data-cmd="insertUnorderedList" title="فهرست نقطه‌ای" aria-label="فهرست نقطه‌ای">• ―</button>
        <button type="button" data-cmd="insertOrderedList" title="فهرست شماره‌دار" aria-label="فهرست شماره‌دار">۱.</button>
        <button type="button" data-cmd="blockquote" title="نقل‌قول" aria-label="نقل‌قول">«»</button>
        <button type="button" data-cmd="link" title="افزودن پیوند" aria-label="افزودن پیوند">پیوند</button>
        <button type="button" data-cmd="removeFormat" title="پاک‌کردن قالب" aria-label="پاک‌کردن قالب">پاک</button>
      </div>
      <div id="rte" class="rte" contenteditable="true" dir="rtl" role="textbox" aria-multiline="true" aria-label="متن اصلی">${sanitizeHtml(existing?.body || '')}</div>
    </div>
    <div class="panel"><h3>فایل‌های پیوست</h3>
      <div id="files"></div>
      <div class="btn-row"><button class="btn soft" type="button" id="addfile">افزودن فایل</button>
        <input type="file" id="fileinput" multiple hidden></div>
      <div class="hint">PDF، تصویر، صوت، ویدئو، Word، PowerPoint، Excel و متن؛ حداکثر ۵۰ مگابایت برای هر فایل.</div>
    </div>
    <div class="panel"><h3>لینک‌های خارجی</h3><div id="links"></div>
      <button class="btn soft" type="button" id="addlink">افزودن لینک</button></div>
    <div class="panel"><h3>وضعیت انتشار</h3>
      <label class="check"><input type="radio" name="status" value="published" ${st.status === 'published' ? 'checked' : ''}> انتشار فوری</label>
      <label class="check"><input type="radio" name="status" value="draft" ${st.status === 'draft' ? 'checked' : ''}> ذخیره به‌صورت پیش‌نویس (نمایش عمومی ندارد)</label>
    </div>
    <div class="sticky-actions"><div id="saveprog"></div><div class="btn-row">
      <button class="btn" type="submit" id="savebtn">ذخیره</button>
      ${onCancel ? '<button class="btn ghost" type="button" id="cancel">انصراف</button>' : `<a class="btn ghost" href="${editId ? '#/content/' + editId : '#/my'}" id="cancel">انصراف</a>`}</div></div>
  </form></div>`;

  const form = $('#cf', el);
  form.addEventListener('input', markDirty);
  $('#f-kind', el).addEventListener('change', (e) => { st.kind = e.target.value; });
  $('#catpick', el)?.addEventListener('change', (e) => { e.target.checked ? st.cats.add(e.target.value) : st.cats.delete(e.target.value); markDirty(); });
  $('#cancel', el).addEventListener('click', () => { st.dirty = false; window.onbeforeunload = null; onCancel?.(); });

  // --- ویرایشگر متن ---
  const rte = $('#rte', el);
  $$('.rte-bar button', el).forEach((b) => b.addEventListener('mousedown', (ev) => ev.preventDefault()));
  $$('.rte-bar button', el).forEach((b) => b.addEventListener('click', () => {
    rte.focus();
    const c = b.dataset.cmd;
    if (c === 'h2') document.execCommand('formatBlock', false, 'h2');
    else if (c === 'p') document.execCommand('formatBlock', false, 'p');
    else if (c === 'blockquote') document.execCommand('formatBlock', false, 'blockquote');
    else if (c === 'link') {
      const url = prompt('نشانی پیوند (با http:// یا https://):', 'https://');
      if (url && isHttpUrl(url.trim())) document.execCommand('createLink', false, url.trim()); else if (url) toast('نشانی معتبر نیست.', 'error');
    } else document.execCommand(c, false, null);
    markDirty();
  }));
  rte.addEventListener('paste', (e) => { // فقط متن ساده (جلوگیری از چسباندن قالب‌های شلوغ)
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  // --- فایل‌ها ---
  const filesBox = $('#files', el);
  const renderFiles = () => {
    filesBox.innerHTML = st.files.length ? st.files.map((f) => {
      const name = f.pending ? f.pending.name : f.meta.file_name;
      const size = f.pending ? f.pending.size : f.meta.size_bytes;
      return `<div class="item-edit" data-key="${f.key}"><div class="top"><span><b><bdi>${esc(name)}</bdi></b> <span class="muted small">(${fmtSize(size)})</span>
        ${f.pending ? (f.cfId ? '<span class="chip draft">جایگزین می‌شود</span>' : '<span class="chip draft">آپلود هنگام ذخیره</span>') : ''}</span>
        <span class="btn-row">${f.cfId ? '<button type="button" class="btn sm ghost" data-act="replace">جایگزینی فایل</button>' : ''}<button type="button" class="btn sm danger ghost" data-act="remove">حذف از محتوا</button></span></div>
        <label for="fd-${f.key}" class="small">توضیح این فایل</label><input id="fd-${f.key}" type="text" maxlength="500" value="${esc(f.description)}" data-desc></div>`;
    }).join('') : '<p class="muted small">فایلی افزوده نشده است.</p>';
  };
  const addFiles = (fileList) => {
    for (const file of fileList) {
      const bad = api.validateFile(file);
      if (bad) { toast(bad, 'error'); continue; }
      st.files.push({ key: nextKey(), cfId: null, fileId: null, meta: null, description: '', pending: file });
    }
    renderFiles(); markDirty();
  };
  filesBox.addEventListener('input', (e) => { if (e.target.matches('[data-desc]')) { const k = e.target.closest('.item-edit').dataset.key; st.files.find((f) => f.key === k).description = e.target.value; } });
  let replaceKey = null;
  filesBox.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const key = b.closest('.item-edit').dataset.key;
    if (b.dataset.act === 'remove') { st.files = st.files.filter((f) => f.key !== key); renderFiles(); markDirty(); }
    else { replaceKey = key; $('#fileinput', el).dataset.mode = 'replace'; $('#fileinput', el).multiple = false; $('#fileinput', el).click(); }
  });
  $('#addfile', el).addEventListener('click', () => { const i = $('#fileinput', el); i.dataset.mode = 'add'; i.multiple = true; i.click(); });
  $('#fileinput', el).addEventListener('change', (e) => {
    const i = e.target; const list = [...i.files]; i.value = '';
    if (!list.length) return;
    if (i.dataset.mode === 'replace') {
      const bad = api.validateFile(list[0]); if (bad) { toast(bad, 'error'); return; }
      const f = st.files.find((x) => x.key === replaceKey); if (f) { f.pending = list[0]; renderFiles(); markDirty(); }
    } else addFiles(list);
  });
  renderFiles();


  // --- لینک‌ها ---
  const linksBox = $('#links', el);
  const renderLinks = () => {
    linksBox.innerHTML = st.links.length ? st.links.map((l) => `<div class="item-edit" data-key="${l.key}">
      <div class="field"><label for="lu-${l.key}">نشانی لینک</label><input id="lu-${l.key}" type="url" dir="ltr" data-f="url" value="${esc(l.url)}" placeholder="https://"></div>
      <div class="field"><label for="lt-${l.key}">عنوان لینک</label><input id="lt-${l.key}" type="text" maxlength="300" data-f="title" value="${esc(l.title)}"></div>
      <div class="field"><label for="ld-${l.key}">توضیح</label><input id="ld-${l.key}" type="text" maxlength="500" data-f="description" value="${esc(l.description)}"></div>
      <button type="button" class="btn sm danger ghost" data-rm>حذف لینک</button></div>`).join('') : '<p class="muted small">لینکی افزوده نشده است.</p>';
  };
  linksBox.addEventListener('input', (e) => { const f = e.target.dataset.f; if (!f) return; st.links.find((l) => l.key === e.target.closest('.item-edit').dataset.key)[f] = e.target.value; });
  linksBox.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) { const k = e.target.closest('.item-edit').dataset.key; st.links = st.links.filter((l) => l.key !== k); renderLinks(); markDirty(); } });
  $('#addlink', el).addEventListener('click', () => { st.links.push({ key: nextKey(), url: '', title: '', description: '' }); renderLinks(); markDirty(); });
  renderLinks();

  // --- ذخیره ---
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (st.saving) return;
    const title = $('#f-title', el).value.trim();
    const body = sanitizeHtml(rte.innerHTML);
    const status = form.status.value;
    if (!title) { toast('عنوان را وارد کنید.', 'error'); $('#f-title', el).focus(); return; }
    if (!st.cats.size) { toast('دست‌کم یک دسته‌بندی انتخاب کنید.', 'error'); return; }
    const badLink = st.links.find((l) => !isHttpUrl(l.url.trim()));
    if (badLink) { toast('نشانی همهٔ لینک‌ها باید با http:// یا https:// شروع شود.', 'error'); return; }
    st.saving = true;
    withLock($('#savebtn', el), async () => {
      const prog = $('#saveprog', el);
      try {
        const total = st.files.filter((f) => f.pending).length; let done = 0;
        for (const f of st.files) {
          if (!f.pending) continue;
          prog.innerHTML = `<div class="small">در حال بارگذاری فایل ${done + 1} از ${total}: ${esc(f.pending.name)}</div><div class="progress"><i style="width:${Math.round((done / total) * 100)}%"></i></div>`;
          const row = await api.uploadFile(f.pending);
          f.fileId = row.id; f.meta = row; f.pending = null; done++;
        }
        prog.innerHTML = '';
        const id = await api.saveContent({
          id: editId, title, kind: st.kind, summary: $('#f-sum', el).value, body, author_name: $('#f-author', el).value,
          source_title: $('#f-source', el).value, status, category_ids: [...st.cats],
          files: st.files.map((f) => ({ cfId: f.cfId, fileId: f.fileId, description: f.description })),
          links: st.links.map((l) => ({ id: l.id, url: l.url, title: l.title, description: l.description }))
        });
        st.dirty = false; window.onbeforeunload = null;
        toast(status === 'draft' ? 'پیش‌نویس ذخیره شد.' : 'محتوا ذخیره و منتشر شد.', 'ok');
        if (onSaved) onSaved(id); else location.hash = '#/content/' + id;
      } catch (err) {
        prog.innerHTML = '';
        toast(friendlyError(err), 'error');
      } finally { st.saving = false; }
    });
  });
}
