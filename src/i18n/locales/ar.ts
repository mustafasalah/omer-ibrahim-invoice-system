export const arMessages = {
  metadata: {
    title: "نظام إدارة الفواتير",
    description: "نظام محلي لإدارة فواتير المبيعات",
  },
  accessibility: {
    skipToContent: "انتقل إلى المحتوى الرئيسي",
  },
  home: {
    eyebrow: "أعمال عمر إبراهيم للمستلزمات الطبية",
    title: "الأساس التقني جاهز للمرحلة التالية",
    description:
      "تم إعداد التطبيق العربي وقاعدة البيانات المحلية. لم تُفعّل المصادقة أو إدارة الفواتير بعد.",
    healthLabel: "فحص حالة الخدمة",
    foundationTitle: "تأسيس المشروع",
    foundationDescription:
      "واجهة عربية من اليمين إلى اليسار، وترجمة مركزية، وإعدادات تشغيل typed، وعقد أخطاء موحّد.",
    databaseTitle: "قاعدة البيانات",
    databaseDescription:
      "SQLite محلية مع ترحيلات وقيود نزاهة ومعاملات آمنة وسجل تدقيق append-only.",
    scopeTitle: "نطاق هذه الدفعة",
    scopeDescription:
      "هذه الصفحة حالة تأسيسية فقط؛ تبدأ المصادقة ومحرر الفاتورة في خطوات لاحقة من الخطة.",
  },
  errors: {
    internal: "تعذر إكمال الطلب.",
    serviceUnavailable: "الخدمة المحلية غير جاهزة.",
    validation: "تحقق من البيانات المدخلة.",
    conflict: "تعارضت العملية مع تغيير أحدث.",
    databaseBusy: "قاعدة البيانات مشغولة مؤقتًا. أعد المحاولة.",
    notFound: "العنصر المطلوب غير موجود.",
  },
} as const;
