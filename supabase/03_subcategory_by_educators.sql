-- =====================================================================
-- اجازهٔ ساخت «زیرشاخه» توسط مربی تأییدشده (فقط ساخت؛ نه ویرایش، نه حذف)
-- این فایل را یک‌بار در Supabase > SQL Editor اجرا کنید. اجرای دوباره‌اش بی‌خطر است.
--
-- مربی فقط می‌تواند دسته‌ای بسازد که «والد» داشته باشد و والدش فعال باشد.
-- ساخت دستهٔ اصلی، ویرایش و حذف دسته‌ها همچنان فقط برای مدیر است.
-- =====================================================================

drop policy if exists categories_insert_educator on public.categories;

create policy categories_insert_educator on public.categories
  for insert to authenticated
  with check (
    public.is_approved_educator()
    and parent_id is not null
    and is_active = true
    and exists (select 1 from public.categories p where p.id = parent_id and p.is_active)
  );

-- بررسی: باید دو سیاست ساخت (admin و educator) ببینید
select policyname from pg_policies
 where schemaname = 'public' and tablename = 'categories' and cmd = 'INSERT';
