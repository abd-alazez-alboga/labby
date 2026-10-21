/**
 * EN + AR copy of the M11 trust slice (rating the driver, reporting the
 * driver, the reporter's outcome list, the suspended state) — approved
 * artboards RiderRate / RiderRateAr / RiderHistoryRate / RiderReport /
 * RiderReports / RiderSuspended. Merged into translations.ts; keys must
 * stay identical in both languages. Numbers stay Western digits (NFR-I2);
 * the brand in Arabic is لبي.
 */
export const trustEn = {
  rating: {
    skip: "Skip",
    title: "How was your ride with {{name}}?",
    rideLine: "{{date}} · {{place}}",
    starsLabel: "Rating, 1 to 5 stars",
    stars: {
      "1": "1 star",
      "2": "2 stars",
      "3": "3 stars",
      "4": "4 stars",
      "5": "5 stars",
    },
    labels: {
      "1": "Terrible",
      "2": "Bad",
      "3": "Okay",
      "4": "Good",
      "5": "Great",
    },
    commentLabel: "Add a comment (optional)",
    commentPlaceholder: "What stood out?",
    anonymous:
      "Your rating is anonymous. {{name}} only ever sees an overall average, never who rated or for which ride.",
    submit: "Submit rating",
    windowNote: "You can rate this ride from Your rides until {{date}}.",
    close: "Close",
    errors: {
      rating_window_closed:
        "The rating window for this ride has closed — rides can be rated for 7 days after they end.",
      rating_already_submitted:
        "You've already rated this ride. Ratings can't be changed.",
      ride_not_completed: "Only completed rides can be rated.",
      account_suspended:
        "Your account is suspended, so this ride can't be rated.",
      generic: "Couldn't send your rating. Please try again.",
    },
  },
  rateHistory: {
    lineWithDriver: "{{date}} · {{driver}} · {{service}}",
    rateOneDay: "Rate {{name}} · 1 day left",
    rateTwoDays: "Rate {{name}} · 2 days left",
    rateDays: "Rate {{name}} · {{count}} days left",
    youRated: "You rated {{score}}",
    windowClosed: "Rating window closed",
  },
  report: {
    title: "Report {{name}}",
    rideLine: "Ride {{date}} · {{place}}",
    question: "What happened?",
    categories: {
      unsafe_driving: "Unsafe driving",
      inappropriate_behavior: "Inappropriate behavior",
      vehicle_condition: "Vehicle condition",
      other: "Other",
      unsafe_behavior: "Unsafe behavior",
      vehicle_damage: "Vehicle damage",
    },
    detailsLabel: "Tell us more (optional)",
    photosLabel: "Photos · up to 3",
    addPhoto: "Add a photo",
    removePhoto: "Remove photo",
    footnote:
      "Our team reviews every report with the ride's route and chat. {{name}} is not told who reported them. We'll let you know the outcome.",
    send: "Send report",
    viewReports: "Your reports",
    errors: {
      report_already_submitted:
        "You've already reported this ride. You can follow it in Your reports.",
      no_counterpart: "This ride had no driver, so there's no one to report.",
      account_suspended:
        "Your account is suspended, so reports can't be sent.",
      photoType: "Use a JPEG or PNG photo.",
      photoTooLarge: "This photo is too large. Choose a smaller one.",
      photoCap:
        "You've reached today's photo upload limit. Send the report without it or try again tomorrow.",
      photoFailed: "Couldn't add this photo. Please try again.",
      generic: "Couldn't send your report. Please try again.",
    },
  },
  reports: {
    title: "Your reports",
    sentTitle: "Report sent",
    sentBody: "We'll notify you when it's reviewed.",
    status: {
      open: "In review",
      substantiated: "Action taken",
      unsubstantiated: "Not confirmed",
    },
    sentLine: "Sent {{date}}",
    reviewedLine: "Sent {{sent}} · reviewed {{reviewed}}",
    footnote:
      "\"Action taken\" means our review confirmed the report. Details of the action stay private.",
    emptyTitle: "No reports",
    emptyBody: "Reports you send about a ride appear here with their outcome.",
    loadMore: "Load more",
  },
  suspended: {
    roleTitle: "Your rider account is suspended",
    accountTitle: "Your Labby account is suspended",
    body: "You can't book rides while it's suspended. Your wallet balance and ride history are safe.",
    reasonFromTeam: "Reason · from the Labby team",
    reasonLabel: "Reason",
    reasonFromTeamDated: "Reason · from the Labby team · {{date}}",
    reasonLabelDated: "Reason · {{date}}",
    quoted: "“{{note}}”",
    lowRating:
      "Your average rider rating fell below the minimum allowed in your area.",
    footer:
      "Your account will be reactivated if our team reviews it. You'll get a notification when that happens.",
    rideCancelledTitle: "Ride cancelled",
    rideCancelledBody: "Cancelled because your account was suspended.",
    historyCancelled: "Cancelled · account suspended",
    contactSupport: "Contact support",
    contactSupportHint:
      "Opens a support ticket about this suspension. You can add details before sending.",
    refusedTitle: "You can't book right now",
    refusedBody: "Your rider account is suspended.",
    refusedNote: "Reason: “{{note}}”",
    refusedNothingCharged: "Nothing was booked and nothing was charged.",
    ticket: {
      notice:
        "We filled this in about your suspension. Add anything that helps our team review it.",
      roleLine: "My rider account was suspended.",
      accountLine: "My Labby account was suspended.",
      roleLineDated: "My rider account was suspended on {{date}}.",
      accountLineDated: "My Labby account was suspended on {{date}}.",
      reasonLine: "Reason shown: “{{reason}}”",
      reviewLine: "I'd like my account to be reviewed.",
    },
  },
  driverRating: {
    label: "Rated {{rating}} out of 5",
  },
};

export const trustAr: typeof trustEn = {
  rating: {
    skip: "تخطي",
    // The name sits in a first-strong isolate (Latin or Arabic names).
    title: "كيف كانت رحلتك مع \u2068{{name}}\u2069؟",
    rideLine: "{{date}} · {{place}}",
    starsLabel: "التقييم من 1 إلى 5 نجوم",
    stars: {
      "1": "نجمة واحدة",
      "2": "نجمتان",
      "3": "3 نجوم",
      "4": "4 نجوم",
      "5": "5 نجوم",
    },
    labels: {
      "1": "سيئة جداً",
      "2": "سيئة",
      "3": "مقبولة",
      "4": "جيدة",
      "5": "ممتازة",
    },
    commentLabel: "أضف تعليقاً (اختياري)",
    commentPlaceholder: "ما الذي لفت انتباهك؟",
    anonymous:
      "تقييمك مجهول الهوية. يرى {{name}} متوسطاً عاماً فقط، ولا يعرف أبداً من قيّمه أو في أي رحلة.",
    submit: "إرسال التقييم",
    windowNote: "يمكنك تقييم هذه الرحلة من «رحلاتك» حتى {{date}}.",
    close: "إغلاق",
    errors: {
      rating_window_closed:
        "انتهت مهلة تقييم هذه الرحلة — يمكن تقييم الرحلات خلال 7 أيام من انتهائها.",
      rating_already_submitted: "سبق أن قيّمت هذه الرحلة. لا يمكن تغيير التقييم.",
      ride_not_completed: "يمكن تقييم الرحلات المكتملة فقط.",
      account_suspended: "حسابك موقوف، لذا لا يمكن تقييم هذه الرحلة.",
      generic: "تعذّر إرسال تقييمك. حاول مرة أخرى.",
    },
  },
  rateHistory: {
    lineWithDriver: "{{date}} · {{driver}} · {{service}}",
    rateOneDay: "قيّم {{name}} · يوم واحد متبقٍ",
    rateTwoDays: "قيّم {{name}} · يومان متبقيان",
    rateDays: "قيّم {{name}} · {{count}} أيام متبقية",
    youRated: "تقييمك: {{score}}",
    windowClosed: "انتهت مهلة التقييم",
  },
  report: {
    title: "الإبلاغ عن \u2068{{name}}\u2069",
    rideLine: "رحلة {{date}} · {{place}}",
    question: "ماذا حدث؟",
    categories: {
      unsafe_driving: "قيادة غير آمنة",
      inappropriate_behavior: "سلوك غير لائق",
      vehicle_condition: "حالة المركبة",
      other: "أخرى",
      unsafe_behavior: "سلوك غير آمن",
      vehicle_damage: "ضرر بالمركبة",
    },
    detailsLabel: "أخبرنا بالمزيد (اختياري)",
    photosLabel: "صور · حتى 3",
    addPhoto: "إضافة صورة",
    removePhoto: "إزالة الصورة",
    footnote:
      "يراجع فريقنا كل بلاغ مع مسار الرحلة والمحادثة. لا يُبلَّغ {{name}} بهوية من أبلغ عنه. سنُعلمك بالنتيجة.",
    send: "إرسال البلاغ",
    viewReports: "بلاغاتك",
    errors: {
      report_already_submitted:
        "سبق أن أبلغت عن هذه الرحلة. يمكنك متابعة البلاغ في «بلاغاتك».",
      no_counterpart: "لم يكن لهذه الرحلة سائق، فلا يوجد من يُبلَّغ عنه.",
      account_suspended: "حسابك موقوف، لذا لا يمكن إرسال البلاغات.",
      photoType: "استخدم صورة بصيغة JPEG أو PNG.",
      photoTooLarge: "هذه الصورة كبيرة جداً. اختر صورة أصغر.",
      photoCap:
        "وصلت إلى حد رفع الصور لهذا اليوم. أرسل البلاغ بدونها أو حاول غداً.",
      photoFailed: "تعذّرت إضافة هذه الصورة. حاول مرة أخرى.",
      generic: "تعذّر إرسال بلاغك. حاول مرة أخرى.",
    },
  },
  reports: {
    title: "بلاغاتك",
    sentTitle: "تم إرسال البلاغ",
    sentBody: "سنُعلمك عند مراجعته.",
    status: {
      open: "قيد المراجعة",
      substantiated: "تم اتخاذ إجراء",
      unsubstantiated: "غير مؤكَّد",
    },
    sentLine: "أُرسل {{date}}",
    reviewedLine: "أُرسل {{sent}} · روجع {{reviewed}}",
    footnote:
      "«تم اتخاذ إجراء» يعني أن مراجعتنا أكدت البلاغ. تبقى تفاصيل الإجراء خاصة.",
    emptyTitle: "لا توجد بلاغات",
    emptyBody: "تظهر هنا البلاغات التي ترسلها عن رحلاتك مع نتيجتها.",
    loadMore: "تحميل المزيد",
  },
  suspended: {
    roleTitle: "حسابك كراكب موقوف",
    accountTitle: "حسابك في لبي موقوف",
    body: "لا يمكنك حجز رحلات أثناء الإيقاف. رصيد محفظتك وسجل رحلاتك محفوظان.",
    reasonFromTeam: "السبب · من فريق لبي",
    reasonLabel: "السبب",
    reasonFromTeamDated: "السبب · من فريق لبي · {{date}}",
    reasonLabelDated: "السبب · {{date}}",
    quoted: "«{{note}}»",
    lowRating: "انخفض متوسط تقييمك كراكب عن الحد الأدنى المسموح به في منطقتك.",
    footer:
      "سيُعاد تفعيل حسابك إذا راجعه فريقنا. سيصلك إشعار عند حدوث ذلك.",
    rideCancelledTitle: "أُلغيت الرحلة",
    rideCancelledBody: "أُلغيت لأن حسابك موقوف.",
    historyCancelled: "أُلغيت · الحساب موقوف",
    contactSupport: "تواصل مع الدعم",
    contactSupportHint:
      "نفتح لك تذكرة دعم عن هذا الإيقاف، ويمكنك إضافة ما تريد قبل الإرسال.",
    refusedTitle: "لا يمكنك الحجز الآن",
    refusedBody: "حسابك كراكب موقوف.",
    refusedNote: "السبب: «{{note}}»",
    refusedNothingCharged: "لم يُحجز شيء ولم يُخصم أي مبلغ.",
    ticket: {
      notice:
        "عبّأنا هذه التذكرة عن إيقاف حسابك. أضف ما يساعد فريقنا على مراجعته.",
      roleLine: "تم إيقاف حسابي كراكب.",
      accountLine: "تم إيقاف حسابي في لبي.",
      roleLineDated: "تم إيقاف حسابي كراكب بتاريخ {{date}}.",
      accountLineDated: "تم إيقاف حسابي في لبي بتاريخ {{date}}.",
      reasonLine: "السبب المعروض: «{{reason}}»",
      reviewLine: "أرجو مراجعة حسابي.",
    },
  },
  driverRating: {
    label: "التقييم {{rating}} من 5",
  },
};
