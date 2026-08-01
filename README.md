# 🤖 Hermes Web UI / رابط وب هرمس

A ChatGPT-style web interface for [Hermes Agent](https://hermes-agent.nousresearch.com).
Works with or without Hermes — falls back to direct API chat when Hermes CLI isn't installed.

رابط وبی به سبک ChatGPT برای [Hermes Agent](https://hermes-agent.nousresearch.com).
با یا بدون Hermes کار میکنه — اگه CLI نصب نباشه، مستقیم با API چت میکنه.

---

## ⚡ One-Click Install / نصب سریع

```bash
git clone https://github.com/sinapkn/hermes-web-ui.git
cd hermes-web-ui
bash install.sh
```

The installer auto-detects your setup:
- **With Hermes CLI** → Full agent (terminal, file ops, web search)
- **Without Hermes** → Local chat mode (direct API, just conversation)

نصب‌کننده خودکار تشخیص میده:
- **با Hermes CLI** → عامل کامل (ترمینال، فایل، جستجوی وب)
- **بدون Hermes** → حالت چت لوکال (API مستقیم، فقط مکالمه)

---

## 🔧 Auto-Detection / تشخیص خودکار

| Feature | With Hermes | Without Hermes |
|---------|-------------|----------------|
| Model & provider | Auto from config | Ask during install |
| Terminal/file tools | ✅ | ❌ |
| Web search | ✅ | ❌ |
| Sessions | state.db | In-memory |
| API mode | CLI backend | Direct HTTP |

| قابلیت | با Hermes | بدون Hermes |
|---------|-----------|-------------|
| مدل و پروایدر | خودکار از کانفیگ | موقع نصب پرسیده میشه |
| ابزار ترمینال/فایل | ✅ | ❌ |
| جستجوی وب | ✅ | ❌ |
| سشن‌ها | state.db | در حافظه |
| حالت API | CLI backend | HTTP مستقیم |

---

## 🌐 Expose Publicly / انتشار عمومی

1. Go to [railway.app](https://railway.app) → New Project
2. Add a TCP Proxy service
3. Run: `bash install.sh 3000 "http://your-proxy:port"`

1. برو به [railway.app](https://railway.app) → پروژه جدید
2. یه TCP Proxy اضافه کن
3. اجرا کن: `bash install.sh 3000 "http://your-proxy:port"`

---

## 📋 Features / قابلیت‌ها

- ✍️ **Word-by-word typing** — like ChatGPT / **تایپ کلمه به کلمه** — مثل ChatGPT
- 🖼️ **File upload** — images, docs, code with preview / **آپلود فایل** — عکس، داکیومنت، کد با پیش‌نمایش
- 🖥️ **Full agent tools** — terminal, file ops, web search (with Hermes) / **ابزار کامل** — ترمینال، فایل، جستجو (با Hermes)
- 🎨 **Dark theme** — clean, modern UI / **تم تاریک** — رابط تمیز و مدرن
- 🌐 **RTL Persian** — full Farsi support / **فارسی راست‌چین** — پشتیبانی کامل فارسی
- 🔄 **Session persistence** — powered by Hermes state.db / **حفظ سشن‌ها** — از state.db هرمس
- 📱 **Mobile PWA** — installable on phones / **موبایل PWA** — قابل نصب روی گوشی
- 📎 **Upload menu** — image, doc, code, any file / **منوی آپلود** — عکس، داکیومنت، کد، هر فایلی
- 🖱️ **Drag & drop** — drop files anywhere / **کشیدن و رها کردن** — فایل رو هرجا رها کن

---

## 📸 Screenshots / تصاویر

> ChatGPT-style dark UI with Persian RTL layout, file upload, and word-by-word streaming.
>
> رابط تاریک به سبک ChatGPT با لایوت فارسی راست‌چین، آپلود فایل و استریم کلمه به کلمه.

---

## ⚙️ Configuration / کانفیگ

### With Hermes CLI / با Hermes CLI
Reads from `~/.hermes/.env` automatically.
خودکار از `~/.hermes/.env` خونده میشه.

### Without Hermes (Local Mode) / بدون Hermes (حالت لوکال)
The installer will ask for:
- Model name (e.g., `gpt-4o`, `claude-sonnet-4`)
- API Base URL (e.g., `https://api.openai.com/v1`)
- API Key

نصب‌کننده اینا رو میپرسه:
- اسم مدل (مثلاً `gpt-4o`, `claude-sonnet-4`)
- آدرس API (مثلاً `https://api.openai.com/v1`)
- کلید API

---

## 🛠️ Tech Stack / تکنولوژی

- **Backend:** Node.js + Express + Multer
- **Frontend:** Vanilla JS (no framework)
- **AI:** Hermes CLI or Direct LLM API
- **Process:** PM2
- **Database:** Hermes state.db (SQLite)

- **بک‌اند:** Node.js + Express + Multer
- **فرانت‌اند:** جاوااسکریپت خام (بدون فریمورک)
- **هوش مصنوعی:** Hermes CLI یا API مستقیم LLM
- **پردازش:** PM2
- **پایگاه داده:** Hermes state.db (SQLite)

---

## 📄 License / مجوز

MIT

---

Made with ❤️ by [SINA pk](https://github.com/sinapkn)

ساخته شده با ❤️ توسط [SINA pk](https://github.com/sinapkn)
