# Finance Planner

تطبيق تخطيط مالي شخصي (PWA)، متصل بـ Supabase، شغّال Offline عبر IndexedDB + Service Worker.

## الملفات
- `index.html` — الهيكل والتنسيق (CSS)
- `app.js` — كل منطق التطبيق (Supabase, IndexedDB, Rendering)
- `manifest.webmanifest` — بيانات التثبيت (اسم، أيقونة، ألوان)
- `sw.js` — Service Worker لتخزين الصفحة والملفات Offline
- `icon.svg` — أيقونة التطبيق

## طريقة النشر (اختر واحدة)

### GitHub Pages (الأسهل والمجاني)
1. اعمل Repository جديد على GitHub وارفع الملفات كلها.
2. من Settings → Pages، اختار Branch: `main`، Folder: `/root`.
3. هتاخد رابط زي: `https://username.github.io/repo-name/`
4. افتحه من الموبايل → هيظهر خيار "Add to Home Screen" تلقائيًا.

### Netlify / Vercel (نفس الفكرة)
اسحب المجلد كامل على netlify.com/drop أو اربطه بـ GitHub — هياخد أقل من دقيقة.

## ملاحظة أمان
الـ Supabase anon/publishable key مكتوب صريح جوا `app.js`. ده طبيعي لتطبيق شخصي بسيط، لكن لو حابب حماية إضافية، فعّل RLS Policy تتحقق من Passphrase بدل ما تسيبها مفتوحة بالكامل.
