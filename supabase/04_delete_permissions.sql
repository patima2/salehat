-- =====================================================================
-- مجوز حذف زیرشاخه در صفحهٔ دسته‌بندی
-- این فایل را یک‌بار در Supabase > SQL Editor اجرا کنید. اجرای دوباره‌اش بی‌خطر است.
--
-- قواعد:
--  • مدیر: هر زیرشاخه را می‌تواند حذف کند (محتوایی که فقط در همان زیرشاخه بوده به سطل زباله می‌رود).
--  • مربی تأییدشده: فقط زیرشاخه‌ای که خودش ساخته و فقط اگر خالی باشد
--    (بدون محتوا و بدون زیرشاخه). دستهٔ اصلی را هیچ مربی نمی‌تواند حذف کند.
--  • حذف محتوا (انتقال به سطل زباله) همان قاعدهٔ قبلی را دارد: مدیر همه، مربی فقط محتوای خودش.
-- زیرشاخه‌هایی که قبل از این تغییر ساخته شده‌اند «سازنده» ندارند و فقط مدیر حذفشان می‌کند.
-- =====================================================================

alter table public.categories
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create or replace function public.set_category_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists categories_creator on public.categories;
create trigger categories_creator before insert on public.categories
  for each row execute function public.set_category_creator();

create or replace function public.delete_category(p_category uuid)
returns int language plpgsql security definer set search_path = public as $$
declare trashed int := 0;
begin
  if public.is_admin() then
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
    return coalesce(trashed, 0);
  elsif public.is_approved_educator() then
    if not exists (select 1 from public.categories c
                   where c.id = p_category and c.parent_id is not null and c.created_by = auth.uid()) then
      raise exception 'فقط زیرشاخه‌ای را که خودتان ساخته‌اید می‌توانید حذف کنید.' using errcode = '42501';
    end if;
    if exists (select 1 from public.categories where parent_id = p_category) then
      raise exception 'این زیرشاخه، زیرشاخه دارد؛ حذف آن فقط توسط مدیر ممکن است.' using errcode = '23503';
    end if;
    if exists (select 1 from public.content_categories where category_id = p_category) then
      raise exception 'این زیرشاخه محتوا دارد؛ حذف آن فقط توسط مدیر ممکن است.' using errcode = '23503';
    end if;
    delete from public.categories where id = p_category;
    return 0;
  else
    raise exception 'دسترسی ندارید.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.delete_category(uuid) from public, anon;
grant execute on function public.delete_category(uuid) to authenticated;

-- بررسی: باید ستون created_by را ببینید
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'categories' and column_name = 'created_by';
