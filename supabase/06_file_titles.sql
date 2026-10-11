-- =====================================================================
-- عنوان برای هر فایل پیوست (مثلاً عنوان فایل صوتی)
-- یک‌بار در Supabase > SQL Editor اجرا کنید (قبل از انتشار فایل‌های جدید در GitHub).
-- اجرای دوباره‌اش بی‌خطر است. هیچ اطلاعاتی حذف یا تغییر نمی‌کند؛ فایل‌های فعلی عنوانِ خالی می‌گیرند
-- و مثل قبل با نام فایل نمایش داده می‌شوند. دسترسی‌ها (RLS) تغییر نمی‌کنند.
-- =====================================================================

alter table public.content_files
  add column if not exists title text not null default '' check (char_length(title) <= 200);

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'content_files' and column_name = 'title';
