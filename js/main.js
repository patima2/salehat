import * as api from './api.js';
import { esc, $, $$, ICON, emptyState, loading, errorBox } from './util.js';
import * as pub from './views-public.js';
import * as auth from './views-auth.js';
import * as ed from './views-editor.js';
import { admin } from './views-admin.js';

const main = document.getElementById('main');
const header = document.getElementById('site-header');
const footer = document.getElementById('site-footer');

footer.innerHTML = `${ICON.divider()}<div class="wrap">بانک محتوای تربیتی صالحات — منابع و طرح درس‌های موردنیاز مربیان، یک‌جا.</div>`;

const ROUTES = [
  [/^$|^\/$/, pub.home],
  [/^\/library$/, pub.library],
  [/^\/library\/new$/, (el, ctx) => ed.editor(el, { ...ctx, library: true })],
  [/^\/topics$/, pub.topics],
  [/^\/category\/([\w-]+)$/, pub.category],
  [/^\/search$/, pub.search],
  [/^\/content\/([\w-]+)$/, pub.contentPage],
  [/^\/login$/, auth.login],
  [/^\/register$/, auth.register],
  [/^\/forgot$/, auth.forgot],
  [/^\/reset$/, auth.resetPassword],
  [/^\/my$/, ed.myContents],
  [/^\/new$/, ed.editor],
  [/^\/edit\/([\w-]+)$/, ed.editor],
  [/^\/admin(?:\/(\w+))?$/, admin]
];

function renderHeader() {
  const p = api.state.profile;
  const here = (location.hash.slice(1).split('?')[0]) || '/';
  const cur = (path) => (here === path || (path !== '/' && here.startsWith(path)) ? 'aria-current="page"' : '');
  let authLinks;
  if (api.isLoggedIn()) {
    authLinks = `<span class="sep"></span>
      ${api.canEdit() ? `<a href="#/my" ${cur('/my')}>محتواهای من</a><a href="#/new" ${cur('/new')}>افزودن محتوا</a>` : ''}
      ${api.isAdmin() ? `<a href="#/admin" ${cur('/admin')}>پنل مدیریت</a>` : ''}
      <button class="linklike" type="button" id="logout">خروج${p?.full_name ? ' (' + esc(p.full_name.split(' ')[0]) + ')' : ''}</button>`;
  } else {
    authLinks = `<span class="sep"></span><a href="#/login" ${cur('/login')}>ورود</a><a class="pill" href="#/register">ثبت‌نام مربی</a>`;
  }
  header.innerHTML = `<div class="wrap">
    <a class="brand" href="#/"><span class="brand-mark"><svg viewBox="0 0 64 64" aria-hidden="true"><g fill="#F3DDE2"><ellipse cx="32" cy="17" rx="7" ry="11"/><ellipse cx="32" cy="47" rx="7" ry="11"/><ellipse cx="17" cy="32" rx="11" ry="7"/><ellipse cx="47" cy="32" rx="11" ry="7"/></g><circle cx="32" cy="32" r="6" fill="#F7F4EF"/></svg></span><span>بانک محتوای تربیتی<br>صالحات</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="منو"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
    <nav class="nav" id="nav" aria-label="منوی اصلی">
      <a href="#/library" ${cur('/library')}>کتابخانهٔ مربیان</a>
      <a href="#/topics" ${cur('/topics')}>موضوعات و طرح درس‌ها</a>
      <a href="#/search" ${cur('/search')}>جست‌وجو</a>
      ${authLinks}
    </nav></div>
    ${statusBanner()}`;
  const toggle = $('.nav-toggle', header), nav = $('#nav', header);
  toggle.addEventListener('click', () => { const o = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', o); });
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) nav.classList.remove('open'); });
  $('#logout', header)?.addEventListener('click', async () => { await api.signOut(); api.state.profile = null; location.hash = '#/'; });
}

function statusBanner() {
  if (!api.isLoggedIn()) return '';
  const p = api.state.profile;
  if (!p) return '<div class="banner"><div class="wrap">اطلاعات حساب شما بارگذاری نشد. صفحه را دوباره باز کنید.</div></div>';
  if (p.status === 'pending') return '<div class="banner"><div class="wrap">حساب شما در انتظار تأیید مدیر است. پس از تأیید می‌توانید محتوا اضافه کنید.</div></div>';
  if (p.status === 'rejected') return '<div class="banner danger"><div class="wrap">درخواست ثبت‌نام شما تأیید نشد.</div></div>';
  if (p.status === 'disabled') return '<div class="banner danger"><div class="wrap">حساب شما غیرفعال شده است. برای اطلاعات بیشتر با مدیر تماس بگیرید.</div></div>';
  return '';
}

function setupScreen(msg) {
  header.innerHTML = '';
  main.innerHTML = `<div class="wrap narrow" style="padding-top:2rem">
    <div class="auth-card">${ICON.divider('orn-top')}<h1>راه‌اندازی سایت</h1>
    <div class="notice warn">${msg}</div>
    <p class="muted small">راهنمای کامل در فایل «راهنمای-راه‌اندازی.md» (پوشهٔ docs) آمده است.</p></div></div>`;
}

let renderToken = 0;
async function route() {
  const token = ++renderToken;
  window.onbeforeunload = null; // ویرایشگر خودش دوباره تنظیم می‌کند
  const raw = location.hash.slice(1);
  const [path, qs = ''] = raw.split('?');
  renderHeader();
  for (const [re, fn] of ROUTES) {
    const m = re.exec(path.replace(/\/+$/, '') || '/');
    const m2 = m || (path === '' ? re.exec('') : null);
    if (!m2) continue;
    main.classList.remove('page-in'); void main.offsetWidth; main.classList.add('page-in');
    main.innerHTML = loading();
    try {
      await fn(main, { params: m2.slice(1), query: new URLSearchParams(qs) });
    } catch (e) {
      console.error(e);
      if (token === renderToken) main.innerHTML = `<div class="wrap narrow">${errorBox('خطای غیرمنتظره رخ داد.')}</div>`;
    }
    if (token === renderToken) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
    return;
  }
  main.innerHTML = `<div class="wrap narrow">${emptyState('صفحه پیدا نشد', 'نشانی را بررسی کنید.', '<a class="btn" href="#/">صفحهٔ اصلی</a>')}</div>`;
}

async function start() {
  if (api.libMissing || window.__SB_LOAD_FAILED) {
    return setupScreen('بارگذاری کتابخانهٔ اتصال به پایگاه داده ناموفق بود. اتصال اینترنت خود را بررسی کنید یا مسدود نبودن «cdn.jsdelivr.net» را در شبکه‌تان کنترل کنید و صفحه را دوباره باز کنید.');
  }
  if (api.configMissing) {
    return setupScreen('اتصال به Supabase هنوز تنظیم نشده است. مقدارهای <b>SUPABASE_URL</b> و <b>SUPABASE_ANON_KEY</b> را در فایل <b>js/config.js</b> وارد کنید.');
  }
  await api.initAuth();
  api.onAuth(() => {
    if (api.state.recovery && !location.hash.startsWith('#/reset')) { location.hash = '#/reset'; return; }
    route();
  });
  window.addEventListener('hashchange', route);
  if (api.state.recovery) location.hash = '#/reset';
  route();
}
start();
