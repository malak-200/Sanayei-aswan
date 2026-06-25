# 🔧 صنايعي أسوان — Firebase Security Rules

ملف قواعد الحماية لـ Firebase Realtime Database الخاصة بمشروع **صنايعي أسوان**.

---

## 📁 محتوى الريبو

```
├── database.rules.json   ← قواعد الحماية
├── firebase.json         ← إعدادات Firebase CLI
└── README.md
```

---

## 🚀 طريقة الرفع على Firebase

### الطريقة الأولى: Firebase CLI (الأسهل)

```bash
# تثبيت Firebase CLI لو مش مثبت
npm install -g firebase-tools

# تسجيل الدخول
firebase login

# ربط المشروع
firebase use sanayei-aswan

# رفع الـ Rules
firebase deploy --only database
```

### الطريقة الثانية: يدوي من Console

1. افتح [Firebase Console](https://console.firebase.google.com/)
2. اختار مشروع `sanayei-aswan`
3. من القائمة: **Realtime Database → Rules**
4. انسخ محتوى `database.rules.json` والصقه
5. اضغط **Publish** ✅

---

## 🔐 ملخص القواعد

| المسار | الزوار | مستخدم مسجّل | صاحب البيانات |
|--------|--------|--------------|--------------|
| `profiles` | ❌ | قراءة ✅ | قراءة + كتابة ✅ |
| `craftsmen` | قراءة ✅ | قراءة ✅ | قراءة + كتابة ✅ |
| `service_requests` | ❌ | قراءة + كتابة ✅ | ✅ |
| `client_requests` | ❌ | قراءة + كتابة ✅ | ✅ |
| `chats` | ❌ | طرفي الشات بس ✅ | ✅ |
| `notifications` | ❌ | كتابة ✅ | قراءة + كتابة ✅ |
| `wallets` | ❌ | قراءة (أدمن) ✅ | قراءة ✅ |
| `wallet_transactions` | ❌ | ❌ | قراءة ✅ |
| `wallet_pending` | ❌ | قراءة + كتابة ✅ | ✅ |
| `portfolio` | قراءة ✅ | قراءة ✅ | قراءة + كتابة ✅ |
| `admin_permissions` | ❌ | قراءة ✅ | ✅ |
| `blocked_users` | ❌ | قراءة ✅ | ✅ |
| `deleted_users` | ❌ | قراءة ✅ | ✅ |
| `contact_messages` | ❌ | قراءة + كتابة ✅ | ✅ |
| `custom_services` | قراءة ✅ | قراءة ✅ | ✅ |
| `promos` | ❌ | قراءة ✅ | ✅ |

---

## ⚠️ ملاحظات

- صلاحيات **الأدمن الأصلي** بتتحقق عبر الكود (`isOwner()`) بالإيميل، مش في الـ Rules.
- قواعد الـ `chats` بتتحقق إن الـ `chatId` يحتوي على `uid` المستخدم الحالي.
- عند الحاجة لقواعد أكثر صرامة، ابعت وهنحدّثها.
