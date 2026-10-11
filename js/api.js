// لایهٔ ارتباط با Supabase: نشست، دسته‌ها، محتوا، فایل‌ها

const cfg = window.SALEHAT_CONFIG || {};
export const configMissing = !cfg.SUPABASE_URL || /PASTE_/.test(cfg.SUPABASE_URL) || !cfg.SUPABASE_ANON_KEY || /PASTE_/.test(cfg.SUPABASE_ANON_KEY);
export const libMissing = !window.supabase || !window.supabase.createClient;

export const BUCKET = 'content-files';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const ALLOWED_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', weba: 'audio/webm',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain'
};

export const sb = (!configMissing && !libMissing)
  ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

// ---------- وضعیت کاربر ----------
export const state = { session: null, profile: null, recovery: false };
const listeners = new Set();
export const onAuth = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((f) => f());

export async function loadProfile() {
  state.profile = null;
  if (!state.session) return;
  const { data, error } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
  if (!error) state.profile = data;
}

export async function initAuth() {
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  await loadProfile();
  let sig = (state.session?.user.id || '') + '|' + (state.profile?.status || '') + '|' + (state.profile?.role || '');
  sb.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') state.recovery = true;
    // فراخوانی‌های Supabase داخل این تابع نباید await شوند؛ با تأخیر انجام می‌دهیم.
    // فقط وقتی کاربر/نقش/وضعیت عوض شد صفحه را دوباره می‌سازیم (تا فرم‌های نیمه‌کاره پاک نشوند).
    setTimeout(async () => {
      await loadProfile();
      const now = (state.session?.user.id || '') + '|' + (state.profile?.status || '') + '|' + (state.profile?.role || '');
      if (now !== sig || event === 'PASSWORD_RECOVERY') { sig = now; emit(); }
    }, 0);
  });
}

export const isLoggedIn = () => !!state.session;
export const isApproved = () => state.profile?.status === 'approved';
export const isAdmin = () => isApproved() && state.profile?.role === 'admin';
export const canEdit = () => isApproved(); // مربی تأییدشده یا مدیر

// ---------- ثبت‌نام و ورود ----------
const siteUrl = () => location.origin + location.pathname;

export async function signUp(email, password, fullName) {
  const { data, error } = await sb.auth.signUp({
    email, password, options: { data: { full_name: fullName }, emailRedirectTo: siteUrl() }
  });
  if (error) throw error;
  return data;
}
export async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export const signOut = () => sb.auth.signOut();
export async function sendReset(email) {
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: siteUrl() });
  if (error) throw error;
}
export async function setNewPassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  state.recovery = false;
}

// ---------- دسته‌بندی‌ها ----------
export async function fetchCategories() {
  const { data, error } = await sb.from('categories').select('*').order('sort_order').order('name');
  if (error) throw error;
  return data;
}
export function buildTree(cats) {
  const by = new Map(cats.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  by.forEach((c) => {
    if (c.parent_id && by.has(c.parent_id)) by.get(c.parent_id).children.push(c);
    else if (!c.parent_id) roots.push(c);
  });
  const sort = (a) => { a.sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name, 'fa')); a.forEach((c) => sort(c.children)); };
  sort(roots);
  return { roots, by };
}
export function categoryPath(by, id) {
  const names = []; let cur = by.get(id); let guard = 0;
  while (cur && guard++ < 10) { names.unshift(cur); cur = cur.parent_id ? by.get(cur.parent_id) : null; }
  return names;
}
export function flattenTree(roots, lvl = 0, out = []) {
  roots.forEach((c) => { out.push({ ...c, lvl }); flattenTree(c.children, lvl + 1, out); });
  return out;
}

// ---------- محتوا ----------
export async function searchContents({ q = '', kinds = null, category = null, limit = 20, offset = 0, library = null } = {}) {
  const { data, error } = await sb.rpc('search_contents', {
    q, p_kinds: kinds, p_category: category, p_limit: limit, p_offset: offset, p_library: library
  });
  if (error) throw error;
  return data;
}

export async function fetchContent(id) {
  const { data, error } = await sb.from('contents').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [cc, cf, cl] = await Promise.all([
    sb.from('content_categories').select('category_id').eq('content_id', id),
    sb.from('content_files').select('*, files(id, storage_path, file_name, mime_type, size_bytes)').eq('content_id', id).order('sort_order'),
    sb.from('content_links').select('*').eq('content_id', id).order('sort_order')
  ]);
  for (const r of [cc, cf, cl]) if (r.error) throw r.error;
  return { ...data, category_ids: cc.data.map((x) => x.category_id), files: cf.data, links: cl.data };
}

export async function fetchRelated(content) {
  if (!content.category_ids.length) return [];
  const { data } = await sb.from('content_categories').select('content_id').in('category_id', content.category_ids).limit(60);
  const ids = [...new Set((data || []).map((r) => r.content_id))].filter((i) => i !== content.id).slice(0, 30);
  if (!ids.length) return [];
  const { data: rows } = await sb.from('contents').select('id,title,kind,created_at').in('id', ids).eq('status', 'published').is('deleted_at', null).order('created_at', { ascending: false }).limit(6);
  return rows || [];
}

export async function signedUrls(files, { download = false } = {}) {
  const out = {};
  await Promise.all(files.map(async (f) => {
    const opts = download ? { download: f.file_name } : undefined;
    const { data } = await sb.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600, opts);
    out[f.id] = data?.signedUrl || null;
  }));
  return out;
}
export async function signedUrl(path, name) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600, { download: name });
  if (error) throw error;
  return data.signedUrl;
}

export async function submitFeedback(contentId, rating, comment, token) {
  const { error } = await sb.rpc('submit_feedback', { p_content: contentId, p_rating: rating, p_comment: comment, p_token: token });
  if (error) throw error;
}

// ---------- آپلود ----------
export function extOf(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
export function validateFile(file) {
  const ext = extOf(file.name);
  if (!ALLOWED_EXT[ext]) return 'نوع فایل «' + file.name + '» مجاز نیست. (PDF، تصویر، صوت، ویدئو، Word، PowerPoint، Excel و متن)';
  if (file.size > MAX_FILE_BYTES) return 'حجم «' + file.name + '» بیشتر از ۵۰ مگابایت است.';
  if (file.size === 0) return 'فایل «' + file.name + '» خالی است.';
  return '';
}

export async function uploadFile(file, onProgress) {
  const ext = extOf(file.name);
  const contentType = ALLOWED_EXT[ext] || file.type.split(';')[0];
  const path = crypto.randomUUID() + '.' + ext;
  onProgress?.(10);
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType, cacheControl: '3600', upsert: false });
  if (error) throw error;
  onProgress?.(80);
  const { data, error: e2 } = await sb.from('files').insert({
    storage_path: path, file_name: file.name.slice(0, 300), mime_type: contentType, size_bytes: file.size, uploaded_by: state.session.user.id
  }).select('id, storage_path, file_name, mime_type, size_bytes').single();
  if (e2) { await sb.storage.from(BUCKET).remove([path]).catch(() => {}); throw e2; }
  onProgress?.(100);
  return data;
}

// ---------- ذخیرهٔ محتوا ----------
// draft: {id?, title, kind, summary, body, author_name, source_title, status, category_ids[], files[{cfId?, fileId, description}], links[{id?, url,title,description}]}
export async function saveContent(d) {
  const uid = state.session.user.id;
  const row = {
    title: d.title.trim(), kind: d.kind, summary: d.summary.trim(), body: d.body,
    author_name: d.author_name.trim(), source_title: d.source_title.trim(), status: d.status
  };
  if (d.in_library) row.in_library = true; // فقط برای کتاب‌های کتابخانه (محتوای موضوعی این فیلد را دست‌نخورده می‌ماند)
  let id = d.id;
  if (id) {
    const { error } = await sb.from('contents').update(row).eq('id', id);
    if (error) throw error;
  } else {
    const { data, error } = await sb.from('contents').insert({ ...row, created_by: uid }).select('id').single();
    if (error) throw error;
    id = data.id;
  }

  // دسته‌ها (فقط تفاوت‌ها)
  const { data: curCats, error: ce } = await sb.from('content_categories').select('category_id').eq('content_id', id);
  if (ce) throw ce;
  const have = new Set(curCats.map((r) => r.category_id));
  const want = new Set(d.category_ids);
  const add = [...want].filter((c) => !have.has(c)).map((category_id) => ({ content_id: id, category_id }));
  const del = [...have].filter((c) => !want.has(c));
  if (add.length) { const { error } = await sb.from('content_categories').insert(add); if (error) throw error; }
  if (del.length) { const { error } = await sb.from('content_categories').delete().eq('content_id', id).in('category_id', del); if (error) throw error; }

  // فایل‌ها
  const { data: curFiles, error: fe } = await sb.from('content_files').select('id').eq('content_id', id);
  if (fe) throw fe;
  const keepIds = new Set(d.files.filter((f) => f.cfId).map((f) => f.cfId));
  const rmIds = curFiles.map((r) => r.id).filter((x) => !keepIds.has(x));
  if (rmIds.length) { const { error } = await sb.from('content_files').delete().in('id', rmIds); if (error) throw error; }
  for (const [i, f] of d.files.entries()) {
    if (f.cfId) {
      const upd = { description: f.description.trim(), sort_order: i, file_id: f.fileId };
      if ((f.title || '').trim() || f.hasTitleCol) upd.title = (f.title || '').trim();
      const { error } = await sb.from('content_files').update(upd).eq('id', f.cfId);
      if (error) throw error;
    } else {
      const ins = { content_id: id, file_id: f.fileId, description: f.description.trim(), sort_order: i };
      if ((f.title || '').trim()) ins.title = f.title.trim();
      const { error } = await sb.from('content_files').insert(ins);
      if (error) throw error;
    }
  }

  // لینک‌ها
  const { data: curLinks, error: le } = await sb.from('content_links').select('id').eq('content_id', id);
  if (le) throw le;
  const keepL = new Set(d.links.filter((l) => l.id).map((l) => l.id));
  const rmL = curLinks.map((r) => r.id).filter((x) => !keepL.has(x));
  if (rmL.length) { const { error } = await sb.from('content_links').delete().in('id', rmL); if (error) throw error; }
  for (const [i, l] of d.links.entries()) {
    const payload = { url: l.url.trim(), title: l.title.trim(), description: l.description.trim(), sort_order: i };
    if (l.id) { const { error } = await sb.from('content_links').update(payload).eq('id', l.id); if (error) throw error; }
    else { const { error } = await sb.from('content_links').insert({ ...payload, content_id: id }); if (error) throw error; }
  }
  return id;
}

export async function softDelete(id) {
  const { error } = await sb.from('contents').update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function restoreContent(id) {
  const { error } = await sb.from('contents').update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
}
export async function permanentlyDelete(id) {
  const { data, error } = await sb.rpc('permanently_delete_content', { p_content: id });
  if (error) throw error;
  const paths = (data || []).map((r) => r.storage_path);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  return paths.length;
}
