// ابزارهای کمکی: امن‌سازی متن، قالب‌بندی فارسی، پیام‌ها و پنجره‌ها

export const KINDS = {
  article: 'مطلب',
  lesson_plan: 'طرح درس',
  book: 'کتاب',
  audio: 'صوت',
  file: 'فایل آموزشی',
  link: 'لینک'
};
export const kindLabel = (k) => KINDS[k] || 'محتوا';

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const dateFmt = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');
export const fmtNum = (n) => new Intl.NumberFormat('fa-IR').format(n);

export function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return fmtNum(b) + ' بایت';
  if (b < 1024 * 1024) return fmtNum(Math.round(b / 1024)) + ' کیلوبایت';
  return fmtNum(Math.round((b / 1024 / 1024) * 10) / 10) + ' مگابایت';
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- امن‌سازی HTML ویرایشگر (فهرست سفید) ----------
const ALLOWED = new Set(['P', 'BR', 'STRONG', 'EM', 'U', 'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'A']);
const RENAME = { B: 'STRONG', I: 'EM', H1: 'H2', H4: 'H3', H5: 'H3', H6: 'H3' };

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString('<body>' + String(html ?? '') + '</body>', 'text/html');
  const out = document.createElement('div');
  const walk = (node, target) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) { target.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      let tag = n.tagName;
      if (RENAME[tag]) tag = RENAME[tag];
      if (tag === 'DIV') tag = 'P';
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'TEMPLATE', 'NOSCRIPT'].includes(n.tagName)) return;
      if (!ALLOWED.has(tag)) { walk(n, target); return; } // برچسب ناشناخته: فقط محتوا حفظ می‌شود
      const el = document.createElement(tag);
      if (tag === 'A') {
        const href = (n.getAttribute('href') || '').trim();
        if (/^(https?:|mailto:)/i.test(href)) {
          el.setAttribute('href', href);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer nofollow');
        }
      }
      walk(n, el);
      target.appendChild(el);
    });
  };
  walk(doc.body, out);
  return out.innerHTML;
}

export function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = sanitizeHtml(html);
  return d.textContent || '';
}

export function isHttpUrl(u) {
  try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; } catch { return false; }
}

// ---------- پیام‌ها ----------
export function toast(msg, type = '') {
  const box = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 6500 : 3500);
}

export function confirmDialog({ title, text, okText = 'تأیید', danger = false, requireText = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3><div>${text}</div>
      ${requireText ? `<div class="field" style="margin-top:.8rem"><label for="cf-in">برای تأیید، عبارت «${esc(requireText)}» را بنویسید</label><input id="cf-in" type="text" autocomplete="off"></div>` : ''}
      <div class="btn-row" style="margin-top:1rem;justify-content:flex-end">
        <button class="btn ghost" data-x="no" type="button">انصراف</button>
        <button class="btn ${danger ? 'danger' : ''}" data-x="yes" type="button" ${requireText ? 'disabled' : ''}>${esc(okText)}</button>
      </div></div>`;
    root.appendChild(back);
    const yes = back.querySelector('[data-x=yes]');
    const finish = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', (e) => { if (e.target === back) finish(false); });
    back.querySelector('[data-x=no]').onclick = () => finish(false);
    yes.onclick = () => finish(true);
    const input = back.querySelector('#cf-in');
    if (input) input.addEventListener('input', () => { yes.disabled = input.value.trim() !== requireText; });
    (input || yes).focus();
  });
}

// اجرای عملیات با قفل دکمه (جلوگیری از ارسال تکراری)
export async function withLock(btn, fn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>لطفاً صبر کنید…';
  try { return await fn(); }
  finally { delete btn.dataset.busy; btn.disabled = false; btn.innerHTML = old; }
}

// ترجمهٔ خطاهای رایج به فارسی
export function friendlyError(e) {
  const m = String(e?.message || e || '');
  const map = [
    [/Invalid login credentials/i, 'ایمیل یا رمز عبور درست نیست.'],
    [/Email not confirmed/i, 'ایمیل شما هنوز تأیید نشده است. لینک ارسال‌شده به ایمیل را باز کنید.'],
    [/User already registered/i, 'با این ایمیل قبلاً ثبت‌نام شده است. وارد شوید یا رمز را بازیابی کنید.'],
    [/Password should be at least/i, 'رمز عبور باید دست‌کم ۸ کاراکتر باشد.'],
    [/rate limit|too many requests|over_email_send_rate_limit/i, 'تعداد درخواست‌ها زیاد است. چند دقیقه بعد دوباره تلاش کنید.'],
    [/Failed to fetch|NetworkError|Load failed|network/i, 'ارتباط با سرور برقرار نشد. اینترنت خود را بررسی کنید.'],
    [/row-level security|permission denied|42501/i, 'شما اجازهٔ انجام این کار را ندارید.'],
    [/exceeded the maximum allowed size|too large|413/i, 'حجم فایل از حد مجاز بیشتر است.'],
    [/mime type .* is not supported|invalid_mime_type/i, 'نوع این فایل مجاز نیست.'],
    [/duplicate key/i, 'این مورد قبلاً ثبت شده است.']
  ];
  for (const [re, fa] of map) if (re.test(m)) return fa;
  // پیام‌های فارسی خودِ دیتابیس را همان‌طور نمایش بده
  if (/[\u0600-\u06FF]/.test(m)) return m;
  return 'مشکلی پیش آمد. دوباره تلاش کنید.' + (m ? ' (' + m.slice(0, 120) + ')' : '');
}

export const ICON = {
  flower: '<svg class="orn" aria-hidden="true"><use href="#orn-flower"/></svg>',
  branch: (cls = '') => `<svg class="${cls}" aria-hidden="true" viewBox="0 0 240 150"><use href="#orn-branch"/></svg>`,
  divider: (cls = '') => `<svg class="${cls}" aria-hidden="true" viewBox="0 0 200 24"><use href="#orn-divider"/></svg>`
};

export function emptyState(title, text, action = '') {
  return `<div class="empty">${ICON.branch('')}<h3>${esc(title)}</h3><p>${esc(text)}</p>${action ? `<div style="margin-top:1rem">${action}</div>` : ''}</div>`;
}

export function loading(text = 'در حال بارگذاری…') {
  return `<div class="loading-block"><span class="spinner"></span>${esc(text)}</div>`;
}

export function errorBox(msg, retry = true) {
  return `<div class="notice error">${esc(msg)} ${retry ? '<button class="btn sm ghost" data-retry type="button">تلاش دوباره</button>' : ''}</div>`;
}

export function getClientToken() {
  const KEY = 'salehat_client_token';
  try {
    let t = localStorage.getItem(KEY);
    if (!t) { t = crypto.randomUUID(); localStorage.setItem(KEY, t); }
    return t;
  } catch {
    window.__tok = window.__tok || crypto.randomUUID();
    return window.__tok;
  }
}
