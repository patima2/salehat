-- =====================================================================
-- بانک محتوای تربیتی صالحات — ساختار پایگاه داده، امنیت (RLS) و ذخیره‌سازی
-- این فایل را یک‌بار کامل در Supabase > SQL Editor اجرا کنید.
-- اجرای دوباره‌ی آن امن است (idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- ۱. جدول‌ها
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'educator' check (role in ('educator','admin')),
  status      text not null default 'pending'  check (status in ('pending','approved','rejected','disabled')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  parent_id   uuid references public.categories(id) on delete restrict,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists categories_parent_idx on public.categories(parent_id, sort_order);

create table if not exists public.contents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 250),
  kind         text not null default 'article' check (kind in ('article','lesson_plan','book','audio','file','link')),
  summary      text not null default '' check (char_length(summary) <= 1000),
  body         text not null default '' check (char_length(body) <= 200000),
  author_name  text not null default '' check (char_length(author_name) <= 200),
  source_title text not null default '' check (char_length(source_title) <= 300),
  status       text not null default 'published' check (status in ('draft','published')),
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users(id) on delete set null
);
create index if not exists contents_list_idx on public.contents(status, deleted_at, created_at desc);
create index if not exists contents_owner_idx on public.contents(created_by);

create table if not exists public.content_categories (
  content_id  uuid not null references public.contents(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key (content_id, category_id)
);
create index if not exists content_categories_cat_idx on public.content_categories(category_id);

create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name    text not null check (char_length(file_name) <= 300),
  mime_type    text not null default '',
  size_bytes   bigint not null default 0 check (size_bytes >= 0),
  uploaded_by  uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now()
);

create table if not exists public.content_files (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.contents(id) on delete cascade,
  file_id     uuid not null references public.files(id) on delete restrict,
  description text not null default '' check (char_length(description) <= 500),
  sort_order  integer not null default 0,
  unique (content_id, file_id)
);
create index if not exists content_files_file_idx on public.content_files(file_id);

create table if not exists public.content_links (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.contents(id) on delete cascade,
  url         text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  title       text not null default '' check (char_length(title) <= 300),
  description text not null default '' check (char_length(description) <= 500),
  sort_order  integer not null default 0
);
create index if not exists content_links_content_idx on public.content_links(content_id);

create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  content_id   uuid not null references public.contents(id) on delete cascade,
  client_token text not null check (char_length(client_token) between 16 and 80),
  rating       smallint not null check (rating between 1 and 5),
  comment      text not null default '' check (char_length(comment) <= 1000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (content_id, client_token)
);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_email text,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

-- ---------------------------------------------------------------------
-- ۲. توابع کمکی (SECURITY DEFINER با search_path ثابت)
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.role = 'admin' and p.status = 'approved');
$$;

create or replace function public.is_approved_educator()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'approved' and p.role in ('educator','admin'));
$$;

create or replace function public.content_is_public(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contents c
                 where c.id = cid and c.status = 'published' and c.deleted_at is null);
$$;

create or replace function public.content_is_owned(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contents c
                 where c.id = cid and c.created_by = auth.uid() and c.deleted_at is null)
         and public.is_approved_educator();
$$;

-- آیا کاربر فعلی اجازه‌ی خواندن این فایل (بر اساس مسیر) را دارد؟
create or replace function public.can_read_file(path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.files f
                 where f.storage_path = path and f.uploaded_by = auth.uid())
      or exists (select 1
                 from public.files f
                 join public.content_files cf on cf.file_id = f.id
                 join public.contents c on c.id = cf.content_id
                 where f.storage_path = path and c.status = 'published' and c.deleted_at is null);
$$;

create or replace function public.file_is_visible(fid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.files f where f.id = fid and f.uploaded_by = auth.uid())
      or exists (select 1 from public.content_files cf
                 join public.contents c on c.id = cf.content_id
                 where cf.file_id = fid and c.status = 'published' and c.deleted_at is null);
$$;

-- ---------------------------------------------------------------------
-- ۳. ساخت خودکار پروفایل هنگام ثبت‌نام (همیشه مربیِ «در انتظار تأیید»)
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (new.id, coalesce(new.email,''),
          left(coalesce(new.raw_user_meta_data->>'full_name',''), 120),
          'educator', 'pending')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- ۴. نگهبان‌ها (Triggers) برای جلوگیری از تغییرهای غیرمجاز
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();
drop trigger if exists contents_touch on public.contents;
create trigger contents_touch before update on public.contents
  for each row execute function public.touch_updated_at();

-- نقش و وضعیت فقط توسط مدیر (یا مالک پروژه در SQL Editor) تغییر می‌کند
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare other_admins int;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'فقط مدیر می‌تواند پروفایل‌ها را تغییر دهد.' using errcode = '42501';
  end if;
  if new.id <> old.id or new.email <> old.email then
    raise exception 'شناسه و ایمیل قابل تغییر نیستند.' using errcode = '42501';
  end if;
  if old.role = 'admin' and old.status = 'approved'
     and (new.role <> 'admin' or new.status <> 'approved') then
    select count(*) into other_admins from public.profiles p
      where p.id <> old.id and p.role = 'admin' and p.status = 'approved';
    if other_admins = 0 then
      raise exception 'نمی‌توان آخرین مدیر فعال را تنزل داد یا غیرفعال کرد.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- محدودیت‌های مربی روی محتوا: مالک و تاریخ ایجاد ثابت؛ بازیابی از سطل فقط مدیر
create or replace function public.guard_content_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.deleted_at := null;
      new.deleted_by := null;
    end if;
    return new;
  end if;
  -- UPDATE
  if auth.uid() is not null and not public.is_admin() then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.deleted_at is not null then
      raise exception 'این محتوا در سطل زباله است.' using errcode = '42501';
    end if;
    if new.deleted_at is not null then new.deleted_by := auth.uid(); end if;
  else
    new.created_at := old.created_at;
    if new.deleted_at is not null and old.deleted_at is null then new.deleted_by := auth.uid(); end if;
    if new.deleted_at is null then new.deleted_by := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists contents_guard on public.contents;
create trigger contents_guard before insert or update on public.contents
  for each row execute function public.guard_content_write();

-- ---------------------------------------------------------------------
-- ۵. گزارش اقدامات مهم (فقط از طریق Trigger؛ هیچ کاربری مستقیم نمی‌نویسد)
-- ---------------------------------------------------------------------

create or replace function public.log_action(p_action text, p_type text, p_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_email, action, entity_type, entity_id, details)
  values (auth.uid(), v_email, p_action, p_type, p_id, coalesce(p_details,'{}'::jsonb));
end $$;
revoke all on function public.log_action(text,text,text,jsonb) from public, anon, authenticated;

create or replace function public.audit_contents()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_action('content_create','content',new.id::text,jsonb_build_object('title',new.title,'status',new.status));
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      perform public.log_action('content_soft_delete','content',new.id::text,jsonb_build_object('title',new.title));
    elsif old.deleted_at is not null and new.deleted_at is null then
      perform public.log_action('content_restore','content',new.id::text,jsonb_build_object('title',new.title));
    else
      perform public.log_action('content_update','content',new.id::text,
        jsonb_build_object('title',new.title,'status',new.status));
    end if;
  elsif tg_op = 'DELETE' then
    perform public.log_action('content_permanent_delete','content',old.id::text,jsonb_build_object('title',old.title));
    return old;
  end if;
  return new;
end $$;
drop trigger if exists contents_audit on public.contents;
create trigger contents_audit after insert or update or delete on public.contents
  for each row execute function public.audit_contents();

create or replace function public.audit_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_action('category_create','category',new.id::text,jsonb_build_object('name',new.name));
  elsif tg_op = 'UPDATE' then
    if old.name is distinct from new.name or old.parent_id is distinct from new.parent_id
       or old.is_active is distinct from new.is_active then
      perform public.log_action('category_update','category',new.id::text,
        jsonb_build_object('name',new.name,'old_name',old.name,'is_active',new.is_active));
    end if;
  elsif tg_op = 'DELETE' then
    perform public.log_action('category_delete','category',old.id::text,jsonb_build_object('name',old.name));
    return old;
  end if;
  return new;
end $$;
drop trigger if exists categories_audit on public.categories;
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function public.audit_categories();

create or replace function public.audit_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (old.role is distinct from new.role or old.status is distinct from new.status) then
    perform public.log_action(
      case when old.role is distinct from new.role then 'role_change' else 'educator_status_change' end,
      'profile', new.id::text,
      jsonb_build_object('email',new.email,'old_role',old.role,'new_role',new.role,
                         'old_status',old.status,'new_status',new.status));
  end if;
  return new;
end $$;
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update on public.profiles
  for each row execute function public.audit_profiles();

-- ---------------------------------------------------------------------
-- ۶. فعال‌سازی RLS
-- ---------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.contents           enable row level security;
alter table public.content_categories enable row level security;
alter table public.files              enable row level security;
alter table public.content_files      enable row level security;
alter table public.content_links      enable row level security;
alter table public.feedback           enable row level security;
alter table public.audit_log          enable row level security;

-- پاک‌سازی سیاست‌های قبلی برای اجرای مجدد
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- profiles: هر کاربر پروفایل خودش را می‌بیند؛ مدیر همه را می‌بیند و تغییر می‌دهد
create policy profiles_select_own   on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_select_admin on public.profiles for select to authenticated using (public.is_admin());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- categories: همه دسته‌های فعال را می‌بینند؛ فقط مدیر مدیریت می‌کند
create policy categories_select_public on public.categories for select to anon, authenticated using (is_active);
create policy categories_select_admin  on public.categories for select to authenticated using (public.is_admin());
create policy categories_insert_admin  on public.categories for insert to authenticated with check (public.is_admin());
create policy categories_update_admin  on public.categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy categories_delete_admin  on public.categories for delete to authenticated using (public.is_admin());

-- contents
create policy contents_select_public on public.contents for select to anon, authenticated
  using (status = 'published' and deleted_at is null);
create policy contents_select_own on public.contents for select to authenticated
  using (created_by = auth.uid() and deleted_at is null and public.is_approved_educator());
create policy contents_select_admin on public.contents for select to authenticated using (public.is_admin());
create policy contents_insert_educator on public.contents for insert to authenticated
  with check (public.is_approved_educator() and created_by = auth.uid());
create policy contents_update_own on public.contents for update to authenticated
  using (created_by = auth.uid() and deleted_at is null and public.is_approved_educator())
  with check (created_by = auth.uid() and public.is_approved_educator());
create policy contents_update_admin on public.contents for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy contents_delete_admin on public.contents for delete to authenticated using (public.is_admin());

-- content_categories
create policy cc_select on public.content_categories for select to anon, authenticated
  using (public.content_is_public(content_id) or public.content_is_owned(content_id) or public.is_admin());
create policy cc_write on public.content_categories for all to authenticated
  using (public.content_is_owned(content_id) or public.is_admin())
  with check (public.content_is_owned(content_id) or public.is_admin());

-- files
create policy files_select on public.files for select to anon, authenticated using (public.file_is_visible(id));
create policy files_insert on public.files for insert to authenticated
  with check (public.is_approved_educator() and uploaded_by = auth.uid());
create policy files_delete_admin on public.files for delete to authenticated using (public.is_admin());

-- content_files
create policy cf_select on public.content_files for select to anon, authenticated
  using (public.content_is_public(content_id) or public.content_is_owned(content_id) or public.is_admin());
create policy cf_write on public.content_files for all to authenticated
  using (public.content_is_owned(content_id) or public.is_admin())
  with check (public.content_is_owned(content_id) or public.is_admin());

-- content_links
create policy cl_select on public.content_links for select to anon, authenticated
  using (public.content_is_public(content_id) or public.content_is_owned(content_id) or public.is_admin());
create policy cl_write on public.content_links for all to authenticated
  using (public.content_is_owned(content_id) or public.is_admin())
  with check (public.content_is_owned(content_id) or public.is_admin());

-- feedback: فقط مدیر می‌خواند؛ ثبت فقط از طریق تابع submit_feedback
create policy feedback_select_admin on public.feedback for select to authenticated using (public.is_admin());
create policy feedback_delete_admin on public.feedback for delete to authenticated using (public.is_admin());

-- audit_log: فقط مدیر می‌خواند
create policy audit_select_admin on public.audit_log for select to authenticated using (public.is_admin());

-- مجوزهای سطح جدول (RLS روی آن‌ها اعمال می‌شود)
revoke all on all tables in schema public from anon, authenticated;
grant select on public.categories, public.contents, public.content_categories,
                public.files, public.content_files, public.content_links to anon;
grant select on public.profiles, public.categories, public.contents, public.content_categories,
                public.files, public.content_files, public.content_links, public.feedback, public.audit_log to authenticated;
grant update on public.profiles to authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert, update, delete on public.contents to authenticated;
grant insert, delete on public.content_categories, public.content_links, public.content_files to authenticated;
grant update on public.content_links, public.content_files to authenticated;
grant insert, delete on public.files to authenticated;
grant delete on public.feedback to authenticated;

-- ---------------------------------------------------------------------
-- ۷. توابع عمومی (RPC)
-- ---------------------------------------------------------------------

-- جست‌وجو: با دسترسی خودِ کاربر (security invoker) اجرا می‌شود، پس RLS رعایت می‌شود
drop function if exists public.search_contents(text,text,uuid,int,int);
create or replace function public.search_contents(
  q text default '', p_kinds text[] default null, p_category uuid default null,
  p_limit int default 40, p_offset int default 0)
returns table (id uuid, title text, kind text, summary text, author_name text,
               created_at timestamptz, category_names text[])
language sql stable security invoker set search_path = public as $$
  with recursive tree as (
    select cat.id from public.categories cat where cat.id = p_category
    union all
    select ch.id from public.categories ch join tree t on ch.parent_id = t.id
  ), params as (
    select '%' || replace(replace(replace(btrim(coalesce(q,'')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat,
           btrim(coalesce(q,'')) = '' as empty
  )
  select c.id, c.title, c.kind, c.summary, c.author_name, c.created_at,
         coalesce((select array_agg(cat.name order by cat.sort_order)
                   from public.content_categories cc
                   join public.categories cat on cat.id = cc.category_id
                   where cc.content_id = c.id), '{}') as category_names
  from public.contents c, params
  where c.deleted_at is null
    and c.status = 'published'
    and (p_kinds is null or c.kind = any(p_kinds))
    and (p_category is null or exists (
          select 1 from public.content_categories cc
          where cc.content_id = c.id and cc.category_id in (select id from tree)))
    and (params.empty
         or c.title ilike params.pat
         or c.summary ilike params.pat
         or c.author_name ilike params.pat
         or c.source_title ilike params.pat
         or regexp_replace(c.body, '<[^>]*>', ' ', 'g') ilike params.pat
         or exists (select 1 from public.content_files cf join public.files f on f.id = cf.file_id
                    where cf.content_id = c.id and (f.file_name ilike params.pat or cf.description ilike params.pat))
         or exists (select 1 from public.content_links l
                    where l.content_id = c.id and (l.title ilike params.pat or l.description ilike params.pat)))
  order by c.created_at desc
  limit least(greatest(p_limit,1),100) offset greatest(p_offset,0);
$$;
grant execute on function public.search_contents(text,text[],uuid,int,int) to anon, authenticated;

-- ثبت امتیاز و بازخورد خصوصی (بدون هویت؛ هر مرورگر یک امتیاز برای هر محتوا)
create or replace function public.submit_feedback(p_content uuid, p_rating int, p_comment text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare recent int;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'امتیاز باید بین ۱ تا ۵ باشد.' using errcode = '22023';
  end if;
  if p_token is null or char_length(p_token) < 16 or char_length(p_token) > 80 then
    raise exception 'درخواست نامعتبر است.' using errcode = '22023';
  end if;
  if not public.content_is_public(p_content) then
    raise exception 'این محتوا در دسترس نیست.' using errcode = '42501';
  end if;
  select count(*) into recent from public.feedback
    where content_id = p_content and updated_at > now() - interval '1 minute';
  if recent >= 15 then
    raise exception 'درخواست‌های زیادی ثبت شده است؛ کمی بعد دوباره تلاش کنید.' using errcode = '54000';
  end if;
  insert into public.feedback (content_id, client_token, rating, comment)
  values (p_content, p_token, p_rating, left(coalesce(p_comment,''), 1000))
  on conflict (content_id, client_token)
  do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
end $$;
revoke all on function public.submit_feedback(uuid,int,text,text) from public;
grant execute on function public.submit_feedback(uuid,int,text,text) to anon, authenticated;

-- پیش‌نمایش حذف دسته: چند زیرمجموعه دارد و چند محتوا بدون دسته می‌مانند؟
create or replace function public.category_delete_preview(p_category uuid)
returns table (children_count int, orphan_count int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'دسترسی ندارید.' using errcode = '42501'; end if;
  return query select
    (select count(*)::int from public.categories where parent_id = p_category),
    (select count(*)::int from public.contents c
      where c.deleted_at is null
        and exists (select 1 from public.content_categories cc where cc.content_id = c.id and cc.category_id = p_category)
        and not exists (select 1 from public.content_categories cc where cc.content_id = c.id and cc.category_id <> p_category));
end $$;
revoke all on function public.category_delete_preview(uuid) from public, anon;
grant execute on function public.category_delete_preview(uuid) to authenticated;

-- حذف دسته: فقط ارتباط‌ها پاک می‌شوند؛ محتوای بدون دسته به سطل زباله می‌رود
create or replace function public.delete_category(p_category uuid)
returns int language plpgsql security definer set search_path = public as $$
declare trashed int;
begin
  if not public.is_admin() then raise exception 'دسترسی ندارید.' using errcode = '42501'; end if;
  if exists (select 1 from public.categories where parent_id = p_category) then
    raise exception 'این دسته زیرمجموعه دارد. ابتدا زیرمجموعه‌ها را حذف یا منتقل کنید.' using errcode = '23503';
  end if;
  with orphans as (
    select c.id from public.contents c
    where c.deleted_at is null
      and exists (select 1 from public.content_categories cc where cc.content_id = c.id and cc.category_id = p_category)
      and not exists (select 1 from public.content_categories cc where cc.content_id = c.id and cc.category_id <> p_category)
  ), upd as (
    update public.contents set deleted_at = now() where id in (select id from orphans) returning 1
  ) select count(*) into trashed from upd;
  delete from public.categories where id = p_category;
  return coalesce(trashed,0);
end $$;
revoke all on function public.delete_category(uuid) from public, anon;
grant execute on function public.delete_category(uuid) to authenticated;

-- حذف دائمی محتوا: فایل‌هایی که دیگر هیچ محتوایی از آن‌ها استفاده نمی‌کند برگردانده می‌شوند
-- تا برنامه آن‌ها را از Storage پاک کند. فایل‌های مشترک با محتوای دیگر دست‌نخورده می‌مانند.
create or replace function public.permanently_delete_content(p_content uuid)
returns table (storage_path text)
language plpgsql security definer set search_path = public as $$
declare fids uuid[];
begin
  if not public.is_admin() then raise exception 'دسترسی ندارید.' using errcode = '42501'; end if;
  if not exists (select 1 from public.contents where id = p_content and deleted_at is not null) then
    raise exception 'فقط محتوای موجود در سطل زباله را می‌توان برای همیشه حذف کرد.' using errcode = '23514';
  end if;
  select coalesce(array_agg(cf.file_id), '{}') into fids from public.content_files cf where cf.content_id = p_content;
  delete from public.contents where id = p_content;
  return query
    with gone as (
      delete from public.files f
      where f.id = any(fids)
        and not exists (select 1 from public.content_files cf where cf.file_id = f.id)
      returning f.storage_path
    ) select g.storage_path from gone g;
end $$;
revoke all on function public.permanently_delete_content(uuid) from public, anon;
grant execute on function public.permanently_delete_content(uuid) to authenticated;

-- حذف فایل بدون استفاده (مدیر): فقط اگر هیچ محتوایی به آن وصل نباشد
create or replace function public.delete_unused_file(p_file uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if not public.is_admin() then raise exception 'دسترسی ندارید.' using errcode = '42501'; end if;
  if exists (select 1 from public.content_files where file_id = p_file) then
    raise exception 'این فایل هنوز در یک محتوا استفاده می‌شود.' using errcode = '23503';
  end if;
  delete from public.files where id = p_file returning storage_path into p;
  return p;
end $$;
revoke all on function public.delete_unused_file(uuid) from public, anon;
grant execute on function public.delete_unused_file(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- ۸. ذخیره‌سازی فایل‌ها (Storage): باکت خصوصی + سیاست‌های نقش‌محور
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('content-files', 'content-files', false, 52428800, array[
  'application/pdf',
  'image/jpeg','image/png','image/webp','image/gif',
  'audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/x-wav','audio/ogg','audio/webm','audio/x-m4a','audio/m4a',
  'video/mp4','video/webm','video/quicktime',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cf_read"   on storage.objects;
drop policy if exists "cf_insert" on storage.objects;
drop policy if exists "cf_delete" on storage.objects;

create policy "cf_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'content-files' and public.can_read_file(name));
create policy "cf_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'content-files' and public.is_approved_educator());
create policy "cf_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'content-files' and public.is_admin());

-- ---------------------------------------------------------------------
-- ۹. دسته‌بندی‌های اولیه (فقط دسته‌های اصلی؛ بدون محتوا و بدون زیرمجموعه)
-- ---------------------------------------------------------------------

insert into public.categories (name, sort_order)
select v.name, v.ord
from (values
  ('احکام و مسائل شرعی', 10),
  ('مهدویت و امام زمان (عج)', 20),
  ('اخلاق و خودسازی', 30),
  ('محتوای مناسبتی و سیرهٔ اهل‌بیت (ع)', 40),
  ('مهارت‌های زندگی', 50),
  ('شهدا', 60),
  ('شناخت جریان‌ها و مکاتب', 70),
  ('نهج‌البلاغه', 80),
  ('اصول عقاید', 90),
  ('نماز', 100)
) as v(name, ord)
where not exists (select 1 from public.categories);
