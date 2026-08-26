# تسليم التنفيذ إلى Codex

## 1. المهمة

بناء تطبيق إنتاج محلي باسم مؤقت **Omer Ibrahim Invoice Management System** وفق المستندات في هذا المجلد. التطبيق متخصص في فواتير المبيعات فقط. لا تضف مخزونًا أو مشتريات أو محاسبة أو POS.

النموذج التفاعلي مرجع بصري:

`https://omer-ibrahim-invoice-prototype.mustafasalah99.chatgpt.site`

النموذج ليس قاعدة لنسخ منطق الإنتاج ولا يحتوي بيانات حقيقية.

## 2. ترتيب قراءة الملفات

1. `PRODUCT_REQUIREMENTS.md`
2. `INVOICE_BUSINESS_RULES.md`
3. `INVOICE_STATUS_AND_PAYMENT_FLOW.md`
4. `USER_ROLES_AND_PERMISSIONS.md`
5. `DATABASE_SCHEMA.md`
6. `USER_FLOWS.md`
7. `SCREEN_SPECIFICATIONS.md`
8. `UI_DESIGN_SYSTEM.md`
9. `INVOICE_PRINT_SPECIFICATION.md`
10. `PDF_EXPORT_REQUIREMENTS.md`
11. `REPORTING_REQUIREMENTS.md`
12. `MVP_BACKLOG.md`
13. `ACCEPTANCE_TESTS.md`

عند التعارض:

1. قواعد العمل والحالات.
2. مخطط البيانات.
3. اختبارات القبول.
4. مواصفات الشاشة.
5. النموذج البصري.

لا تغيّر قاعدة مالية لتناسب الواجهة؛ عدّل الواجهة.

## 3. ثوابت غير قابلة للتفاوض

1. حالة الفاتورة والدفع والأرشفة ثلاثة محاور مستقلة.
2. حالة الدفع مشتقة فقط.
3. لا حذف نهائي لفاتورة أو حركة مالية.
4. لا `float` أو JavaScript `Number` للحساب المالي.
5. الخادم يعيد كل الحسابات.
6. رقم الفاتورة ذري وفريد ولا يعاد استخدامه.
7. الفاتورة تحفظ لقطات المستفيد والمنتج والعملة والضريبة والطباعة.
8. حذف الاقتراح لا يغير التاريخ.
9. أي حركة مالية + حالة + audit في transaction واحدة.
10. الاستعادة تتحقق مؤقتًا ثم تبدل ذريًا مع rollback.
11. لا طلبات شبكة خارجية في تشغيل الفواتير أو PDF.
12. صلاحيات الخادم إلزامية لكل endpoint.

## 4. المعمارية الموصى بها

اختيار عملي، مع قبول بديل مكافئ موثق:

- Full-stack: Next.js App Router + TypeScript.
- UI: React، CSS/Tailwind tokens، مكونات يمكن الوصول إليها.
- Validation: Zod أو بديل typed.
- Database: SQLite + Drizzle ORM أو SQL صريح بمigrations.
- SQLite driver: driver متزامن موثوق مناسب للعملية المحلية.
- Decimal: `decimal.js` أو بديل arbitrary precision.
- Password: Argon2id.
- Sessions: database-backed opaque sessions.
- PDF: Chromium/Playwright أو Puppeteer محلي ومضمّن بالتثبيت.
- Tests: Vitest/Node test للوحدة والتكامل، وPlaywright للـE2E/print.

لا تثبت إصدارًا عشوائيًا من مستند قديم؛ استخدم إصدارًا مدعومًا وقت التنفيذ وثبته في lockfile.

## 5. نموذج التشغيل

### الجهاز المضيف

- عملية تطبيق واحدة.
- مجلد بيانات دائم خارج source.
- يبدأ كخدمة نظام أو من launcher واضح.
- يستمع `127.0.0.1` افتراضيًا.
- خيار موثق للاستماع على LAN الخاص.

### أجهزة العملاء

- متصفح حديث.
- لا قاعدة محلية ولا مزامنة.
- كل الكتابة على الخادم المضيف.

### ملاحظة أمان

لا تفتح المنفذ على الإنترنت. إذا كانت الشبكة غير موثوقة، جهز HTTPS محليًا أو اعزل الشبكة. وثق إعداد جدار حماية Windows للشبكات الخاصة فقط.

## 6. هيكل مستودع مقترح

```text
src/
├── app/
│   ├── (auth)/
│   ├── (dashboard)/
│   ├── api/
│   └── print/
├── components/
│   ├── ui/
│   ├── invoice/
│   ├── payments/
│   └── reports/
├── domain/
│   ├── invoices/
│   │   ├── calculator.ts
│   │   ├── lifecycle.ts
│   │   ├── numbering.ts
│   │   ├── permissions.ts
│   │   └── schemas.ts
│   ├── payments/
│   ├── reports/
│   └── backups/
├── server/
│   ├── auth/
│   ├── db/
│   ├── files/
│   ├── pdf/
│   └── audit/
├── i18n/
└── styles/
tests/
├── unit/
├── integration/
├── e2e/
├── fixtures/
└── visual/
data/  # runtime only, gitignored
```

منع استيراد `server/*` إلى client bundle بقيد lint/build.

## 7. وحدات المجال

### InvoiceCalculator

دالة pure:

```ts
calculateInvoice(input, currency): CalculatedInvoice
```

- لا تقرأ قاعدة البيانات.
- لا تقبل totals من الخارج.
- تعيد قيم كل بند والتوزيع والإجماليات.
- لها fixtures مرجعية.

### InvoiceNumberService

- يعمل داخل transaction.
- يتحقق من pattern tokens.
- يعيد preview دون حجز.
- يحجز فقط عند أول حفظ.

### InvoiceLifecycleService

- `saveDraft`
- `issue`
- `editIssued`
- `cancel`
- `archive`
- `unarchive`
- `copy`

كل method يتحقق من القدرة والحالة و`row_version`.

### PaymentLedgerService

- `addPayment`
- `addRefund`
- `voidTransaction`
- `recalculatePaymentState`

لا توجد method لتعيين `payment_status` مباشرة.

### PrintSnapshotService

- يلتقط بيانات المنشأة والأصول عند الإصدار.
- يمنع تنظيف أصل مشار إليه.
- المسودات تستخدم إعدادات حية.

### BackupService

- `create`
- `inspect`
- `restore`
- `rollback`

لا تنفذ الاستعادة من route كمنطق inline.

## 8. API مبدئي

```text
POST   /api/auth/login
POST   /api/auth/logout
POST   /api/auth/change-password

GET    /api/invoices
POST   /api/invoices
GET    /api/invoices/:id
PATCH  /api/invoices/:id
POST   /api/invoices/:id/issue
POST   /api/invoices/:id/cancel
POST   /api/invoices/:id/archive
POST   /api/invoices/:id/unarchive
POST   /api/invoices/:id/copy
POST   /api/invoices/:id/payments
POST   /api/invoices/:id/refunds
POST   /api/financial-transactions/:id/void
GET    /api/invoices/:id/pdf

GET    /api/suggestions/beneficiaries
DELETE /api/suggestions/beneficiaries/:id
GET    /api/suggestions/products
DELETE /api/suggestions/products/:id

GET    /api/reports/summary
GET    /api/reports/sales-series
GET    /api/reports/top-beneficiaries
GET    /api/reports/top-products
GET    /api/reports/overdue

GET    /api/settings
PATCH  /api/settings
POST   /api/media

GET    /api/users
POST   /api/users
PATCH  /api/users/:id
POST   /api/users/:id/reset-password

GET    /api/audit-logs
POST   /api/backups
POST   /api/backups/inspect
POST   /api/backups/restore
```

يفضل commands مخصصة للحالات بدل PATCH عام يتيح تغيير حقول محمية.

## 9. عقد الأخطاء

```json
{
  "error": {
    "code": "PAYMENT_EXCEEDS_REMAINING",
    "message": "المبلغ يتجاوز المتبقي.",
    "fieldErrors": {
      "amount": "الحد الأقصى 600.00"
    },
    "requestId": "..."
  }
}
```

- codes ثابتة قابلة للاختبار.
- النص مترجم في طبقة العرض أو الخادم وفق قرار واحد.
- لا stack traces أو SQL أو paths.
- `409` للتعارض أو stale version.
- `422` للتحقق التجاري.

## 10. تسلسل التنفيذ

### Milestone 1 — Vertical slice

- مدير أول وتسجيل دخول.
- إعدادات أساسية.
- فاتورة بسيطة وحساب وحفظ مسودة وإصدار.
- شاشة تفاصيل.

### Milestone 2 — Financial integrity

- الخصم والضريبة الكاملة.
- دفعات واستردادات وإبطال.
- lifecycle وحماية التعديل.
- audit.

### Milestone 3 — Retrieval/output

- الاقتراحات والبحث والفلاتر والأرشفة.
- طباعة وPDF.
- تقارير.

### Milestone 4 — Operations

- المستخدمون.
- الوسائط الكاملة.
- backup/restore.
- LAN packaging والأداء والأمان.

لا تبن كل الشاشات mock قبل vertical slice فعلي قابل للاختبار.

## 11. استراتيجية الاختبار

### وحدة

- الحسابات والتقريب والتوزيع.
- اشتقاق الحالة.
- تنسيق الرقم.
- تطبيع الأسماء.
- تنظيف اسم PDF.

### تكامل

- transactions والقيود.
- تزامن الرقم والدفعات.
- الصلاحيات.
- اللقطات.
- audit.
- backup inspect/restore.

### E2E

- إنشاء → إصدار → دفع → PDF.
- دفع جزئي → استرداد → إلغاء.
- بحث منتج محذوف اقتراحه.
- أرشفة/استعادة.
- تغيير إعداد لا يغير فاتورة قديمة.

### Visual

Fixtures ثابتة:

- one-page.
- multi-page.
- five logos.
- draft/cancelled.
- color/mono.
- with/without stamp.

## 12. قاعدة الاختبار والـseed

Seed التطوير فقط:

- مدير `admin`.
- موظف `employee`.
- 6 مستفيدين.
- 12 منتجًا طبيًا.
- فواتير تمثل كل حالة.
- حركات دفع واسترداد.
- لا تشحن كلمات مرور معروفة في إنتاج.

Bootstrap الإنتاج:

1. إذا لا مستخدمين، يعرض إعداد مدير أول محليًا فقط.
2. يمنع endpoint بعد إنشاء أول مدير.
3. يطلب كلمة قوية وتأكيدها.

## 13. الوسائط

- خزن باسم content-addressed أو UUID، لا الاسم الأصلي.
- تحقق magic bytes.
- decode ثم re-encode عند الحاجة لإزالة metadata/حمولات.
- امنع SVG الخام في MVP أو عقمه وحوله.
- حد حجم وعدد.
- لا تستبدل ملفًا في مكانه؛ أنشئ أصلًا جديدًا.
- احتفظ بالأصل القديم إذا أشارت إليه لقطة.

## 14. النسخ الاحتياطي

- استخدم SQLite backup API.
- لا تنسخ `database.sqlite` بأمر ملفات أثناء الكتابة.
- manifest versioned.
- حماية path traversal وzip bomb.
- `integrity_check`.
- dry inspection قبل التأكيد.
- maintenance lock.
- safety backup.
- atomic directory swap.
- smoke check ثم إنهاء الجلسات.

## 15. PDF

- الصفحة الداخلية لا تقبل URL.
- token أحادي الاستخدام وقصير.
- انتظر fonts/images/print-ready.
- لا CDN.
- process limit وطابور.
- اختبر أن النص قابل للتحديد.
- استخدم نفس CSS للطباعة والمعاينة.

## 16. التقارير

- ضع تعريف كل metric بجانب query في كود domain.
- اختبارات reconciliation إلزامية.
- لا تجمع عملتين.
- لا تستخدم N+1.
- FTS/indexes قبل اختبار 100 ألف سجل.
- drill-down يجب أن يعيد نفس المجموعة.

## 17. الإعدادات والبيئة

متغيرات مقترحة:

```text
APP_DATA_DIR=
APP_HOST=127.0.0.1
APP_PORT=
APP_TIMEZONE=Africa/Khartoum
SESSION_SECRET=
PDF_BROWSER_PATH=
LOG_LEVEL=info
```

- لا تخزن أسرارًا في Git.
- تولد `SESSION_SECRET` عند التثبيت.
- `APP_DATA_DIR` مطلق ومملوك لحساب الخدمة.
- اعرض config diagnostic يحجب السر.

## 18. أوامر تشغيل مقترحة

```text
dev
build
start
lint
typecheck
test
test:integration
test:e2e
test:print
db:migrate
db:check
backup:create
backup:inspect
```

الأسماء النهائية تتبع package manager، لكن يجب توفير وظائف مكافئة.

## 19. مراجعات إلزامية قبل الإطلاق

- مراجعة قواعد الحساب مع عينة فواتير فعلية من المنشأة.
- اعتماد شكل رقم الفاتورة والعملة والضريبة.
- طباعة فعلية على الطابعة المستخدمة.
- تجربة خمسة شعارات وختم/توقيع حقيقيين.
- تجربة استعادة على جهاز/مجلد منفصل.
- تجربة مستخدمين متزامنين على LAN.
- تغيير عنوان IP/إعادة تشغيل الجهاز.
- اختبار تشغيل كامل بعد فصل الإنترنت.

## 20. قرارات تحتاج إجابة مالك المشروع قبل الإنتاج

1. العملة الافتراضية ومنازلها.
2. نسبة الضريبة الافتراضية وهل توجد بنود معفاة عادة.
3. شكل رقم الفاتورة والبداية وسياسة إعادة التسلسل.
4. بيانات العنوان والهواتف والبريد والتسجيل النهائية.
5. هل يملك الموظف الأرشفة الجماعية.
6. هل يسمح تجاوز إلغاء فاتورة غير مسواة أم يمنع نهائيًا.
7. مدة انتهاء الجلسة.
8. نظام تشغيل الجهاز المضيف والطابعة والمتصفحات.
9. مكان حفظ النسخ الخارجية ومن المسؤول عن اختبارها.

ضع هذه كـseed/config؛ لا تجمدها افتراضات مبعثرة في الكود.

## 21. Definition of Ready لـ Codex

يمكن بدء التنفيذ الآن مع قيم تطويرية للإعدادات، بشرط:

- عدم تقرير الأسئلة المفتوحة نيابة عن المنشأة للإنتاج.
- الالتزام بالثوابت.
- تنفيذ vertical slice أولًا.
- ربط كل Pull Request بقصص واختبارات قبول.

## 22. Definition of Done للإطلاق

- كل P0 مكتمل.
- اختبارات `ACCEPTANCE_TESTS.md` الحرجة ناجحة.
- لا أخطاء reconciliation.
- PDF والطباعة معتمدان.
- الاستعادة ناجحة من نسخة فعلية.
- دليل تشغيل ونسخ واستعادة متوفر.
- لا اتصال خارجي أثناء العمل.
- لا مخزون أو ميزات خارج النطاق تسربت للنظام.

