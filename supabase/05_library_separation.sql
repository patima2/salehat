-- =====================================================================
-- جدا کردن «کتابخانهٔ مربیان» از «موضوعات و طرح درس‌ها»
-- این فایل را یک‌بار در Supabase > SQL Editor اجرا کنید (قبل از انتشار فایل‌های جدید در GitHub).
-- اجرای دوباره‌اش بی‌خطر است. هیچ محتوایی حذف یا جابه‌جا نمی‌شود.
--
-- همهٔ محتواهای فعلی با مقدار «in_library = false» می‌مانند، یعنی همه در بخش
-- «موضوعات و طرح درس‌ها» باقی می‌مانند. فقط کتاب‌هایی که از این پس با
-- «افزودن کتاب» در کتابخانه ثبت شوند در کتابخانه دیده می‌شوند.
-- دسترسی‌ها (RLS) تغییر نمی‌کنند: همان سیاست‌های جدول contents برای کتاب‌ها هم اعمال می‌شود.
-- =====================================================================

alter table public.contents
  add column if not exists in_library boolean not null default false;
create index if not exists contents_library_idx on public.contents(in_library, status, deleted_at, created_at desc);

drop function if exists public.search_contents(text,text[],uuid,int,int);
create or replace function public.search_contents(
  q text default '', p_kinds text[] default null, p_category uuid default null,
  p_limit int default 40, p_offset int default 0, p_library boolean default null)
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
    and (p_library is null or c.in_library = p_library)
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
grant execute on function public.search_contents(text,text[],uuid,int,int,boolean) to anon, authenticated;

-- بررسی: باید ستون in_library را ببینید
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'contents' and column_name = 'in_library';
