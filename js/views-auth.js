import * as api from './api.js';
import { esc, $, ICON, withLock, friendlyError } from './util.js';

const card = (title, inner) => `<div class="wrap narrow"><div class="auth-card">${ICON.divider('orn-top')}<h1>${esc(title)}</h1>${inner}</div></div>`;

function showErr(form, msg) {
  let box = $('.notice.error', form);
  if (!box) { box = document.createElement('div'); box.className = 'notice error'; box.setAttribute('role', 'alert'); form.prepend(box); }
  box.textContent = msg;
  box.scrollIntoView({ block: 'nearest' });
}
const clearErr = (form) => $('.notice.error', form)?.remove();

export function login(el) {
  if (api.isLoggedIn()) { location.hash = '#/'; return; }
  el.innerHTML = card('ورود به حساب', `
    <form novalidate>
      <div class="field"><label for="em">ایمیل</label><input id="em" name="email" type="email" dir="ltr" autocomplete="username" required></div>
      <div class="field"><label for="pw">رمز عبور</label><input id="pw" name="password" type="password" dir="ltr" autocomplete="current-password" required></div>
      <button class="btn" type="submit" style="width:100%">ورود</button>
      <div class="auth-links"><a href="#/forgot">رمز را فراموش کرده‌ام</a><a href="#/register">ثبت‌نام مربی</a></div>
    </form>`);
  const form = $('form', el);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); clearErr(form);
    const email = form.email.value.trim(), password = form.password.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(form, 'ایمیل را درست وارد کنید.');
    if (!password) return showErr(form, 'رمز عبور را وارد کنید.');
    withLock($('button[type=submit]', form), async () => {
      try { await api.signIn(email, password); location.hash = '#/'; }
      catch (err) { showErr(form, friendlyError(err)); }
    });
  });
}

export function register(el) {
  if (api.isLoggedIn()) { location.hash = '#/'; return; }
  el.innerHTML = card('ثبت‌نام مربی', `
    <p class="muted small">پس از ثبت‌نام، حساب شما باید توسط مدیر تأیید شود؛ سپس می‌توانید محتوا اضافه کنید. مشاهدهٔ محتوا نیاز به ثبت‌نام ندارد.</p>
    <form novalidate>
      <div class="field"><label for="nm">نام و نام خانوادگی</label><input id="nm" name="name" type="text" autocomplete="name" maxlength="120" required></div>
      <div class="field"><label for="em">ایمیل</label><input id="em" name="email" type="email" dir="ltr" autocomplete="email" required></div>
      <div class="field"><label for="pw">رمز عبور</label><input id="pw" name="password" type="password" dir="ltr" autocomplete="new-password" minlength="8" required><div class="hint">دست‌کم ۸ کاراکتر</div></div>
      <div class="field"><label for="pw2">تکرار رمز عبور</label><input id="pw2" name="password2" type="password" dir="ltr" autocomplete="new-password" required></div>
      <button class="btn" type="submit" style="width:100%">ثبت‌نام</button>
      <div class="auth-links"><a href="#/login">قبلاً ثبت‌نام کرده‌ام</a></div>
    </form>`);
  const form = $('form', el);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); clearErr(form);
    const name = form.name.value.trim(), email = form.email.value.trim(), pw = form.password.value;
    if (name.length < 2) return showErr(form, 'نام خود را وارد کنید.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(form, 'ایمیل را درست وارد کنید.');
    if (pw.length < 8) return showErr(form, 'رمز عبور باید دست‌کم ۸ کاراکتر باشد.');
    if (pw !== form.password2.value) return showErr(form, 'تکرار رمز عبور با رمز یکسان نیست.');
    withLock($('button[type=submit]', form), async () => {
      try {
        const data = await api.signUp(email, pw, name);
        const needsConfirm = !data.session;
        el.innerHTML = card('ثبت‌نام انجام شد', `<div class="notice ok">${needsConfirm
          ? 'یک ایمیل تأیید برای شما ارسال شد. پس از تأیید ایمیل، وارد شوید. سپس حساب شما باید توسط مدیر تأیید شود.'
          : 'حساب شما ساخته شد و در انتظار تأیید مدیر است.'}</div><a class="btn" href="#/">بازگشت به صفحهٔ اصلی</a>`);
      } catch (err) { showErr(form, friendlyError(err)); }
    });
  });
}

export function forgot(el) {
  el.innerHTML = card('بازیابی رمز عبور', `
    <form novalidate>
      <p class="muted small">ایمیل خود را وارد کنید تا لینک تنظیم رمز جدید برای شما ارسال شود. لینک را باید در همین مرورگر باز کنید.</p>
      <div class="field"><label for="em">ایمیل</label><input id="em" name="email" type="email" dir="ltr" autocomplete="email" required></div>
      <button class="btn" type="submit" style="width:100%">ارسال لینک</button>
      <div class="auth-links"><a href="#/login">بازگشت به ورود</a></div>
    </form>`);
  const form = $('form', el);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); clearErr(form);
    const email = form.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showErr(form, 'ایمیل را درست وارد کنید.');
    withLock($('button[type=submit]', form), async () => {
      try {
        await api.sendReset(email);
        form.innerHTML = '<div class="notice ok">اگر این ایمیل ثبت شده باشد، لینک بازیابی برای آن ارسال می‌شود. پوشهٔ هرزنامه را هم ببینید.</div>';
      } catch (err) { showErr(form, friendlyError(err)); }
    });
  });
}

export function resetPassword(el) {
  if (!api.state.recovery) {
    el.innerHTML = card('تنظیم رمز جدید', '<div class="notice warn">لینک بازیابی معتبر نیست یا منقضی شده است. دوباره درخواست دهید.</div><a class="btn" href="#/forgot">درخواست لینک جدید</a>');
    return;
  }
  el.innerHTML = card('تنظیم رمز جدید', `
    <form novalidate>
      <div class="field"><label for="pw">رمز جدید</label><input id="pw" name="password" type="password" dir="ltr" autocomplete="new-password" minlength="8" required><div class="hint">دست‌کم ۸ کاراکتر</div></div>
      <div class="field"><label for="pw2">تکرار رمز جدید</label><input id="pw2" name="password2" type="password" dir="ltr" autocomplete="new-password" required></div>
      <button class="btn" type="submit" style="width:100%">ذخیرهٔ رمز</button>
    </form>`);
  const form = $('form', el);
  form.addEventListener('submit', (e) => {
    e.preventDefault(); clearErr(form);
    const pw = form.password.value;
    if (pw.length < 8) return showErr(form, 'رمز عبور باید دست‌کم ۸ کاراکتر باشد.');
    if (pw !== form.password2.value) return showErr(form, 'تکرار رمز با رمز یکسان نیست.');
    withLock($('button[type=submit]', form), async () => {
      try { await api.setNewPassword(pw); el.innerHTML = card('رمز تغییر کرد', '<div class="notice ok">رمز عبور جدید ذخیره شد.</div><a class="btn" href="#/">ادامه</a>'); }
      catch (err) { showErr(form, friendlyError(err)); }
    });
  });
}
