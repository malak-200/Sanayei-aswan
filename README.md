# صنايعي أسوان 🔧

منصة خدمات تربط العملاء بالصنايعية في أسوان.

## هيكل المشروع

```
/
├── index.html              # الملف الرئيسي
├── css/
│   ├── styles.css          # CSS الرئيسي
│   └── styles-extra.css    # CSS صفحات الـ wallet والـ guide
└── js/
    ├── firebase.js         # Firebase config + Auth state
    ├── chat.js             # Chat + Notifications + Price offers
    ├── orders.js           # Worker requests + Client orders
    ├── admin.js            # Admin dashboard كامل
    ├── app.js              # Navigation + Craftsmen + Profiles
    ├── ui.js               # Modals + Rating + Toast
    ├── realtime.js         # Real-time listeners
    ├── market.js           # Client market + Unified orders
    ├── wallet.js           # Wallet + Payment settings
    └── portfolio.js        # معرض الأعمال
```

## ترتيب تحميل الـ JS (مهم)

Firebase SDK → firebase.js → chat.js → orders.js → admin.js → app.js → ui.js → realtime.js → [HTML pages] → market.js → wallet.js → portfolio.js
