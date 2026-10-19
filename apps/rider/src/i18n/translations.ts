/**
 * Translations for the Labby rider app (EN + AR).
 * Keys are nested per screen, mirroring the admin app's i18n layout.
 * The M7 ride slice lives in ride-translations.ts, the M8 money slice in
 * money-translations.ts, the M10 comms & safety slice in
 * comms-translations.ts, the M11 trust slice in trust-translations.ts, the
 * M12 scheduled & shared slice in m12-translations.ts, the M13 growth slice
 * in growth-translations.ts — all merged in here.
 */
import { commsAr, commsEn } from "./comms-translations";
import { growthAr, growthEn } from "./growth-translations";
import { supportAr, supportEn } from "./support-translations";
import { m12Ar, m12En } from "./m12-translations";
import { moneyAr, moneyEn } from "./money-translations";
import { rideAr, rideEn } from "./ride-translations";
import { trustAr, trustEn } from "./trust-translations";

export const translations = {
  en: {
    ...rideEn,
    ...moneyEn,
    ...commsEn,
    ...trustEn,
    ...m12En,
    ...growthEn,
    ...supportEn,
    common: {
      appName: "Labby",
      back: "Back",
      continue: "Continue",
      save: "Save",
      networkError:
        "Something went wrong. Check your connection and try again.",
      showPassword: "Show password",
      hidePassword: "Hide password",
      retry: "Try again",
      networkErrorTitle: "No connection",
      networkErrorBody:
        "We couldn't reach Labby. Check your internet connection and try again.",
      serverErrorTitle: "Something went wrong on our side",
      serverErrorBody:
        "Labby's servers ran into a problem. Please try again in a moment.",
    },
    home: {
      title: "Home",
      openSettings: "Settings",
      whereTo: "Where to?",
      searchDestination: "Search destination",
    },
    region: {
      finding: "Finding your area…",
      outsideTitle: "Outside our service area",
      outsideBody:
        "We don't operate in your area yet. We're expanding — please check back soon.",
      permissionDeniedTitle: "Location needed",
      permissionDeniedBody:
        "We use your location to find your operating region and show the right services and prices. Allow location access to continue.",
      errorTitle: "Couldn't check your area",
      errorBody:
        "Something went wrong while finding your region. Check your connection and try again.",
      retry: "Try again",
      openSettings: "Open settings",
    },
    welcome: {
      tagline: "Your ride, your way.",
      createAccount: "Create account",
      logIn: "Log in",
      goodbyeTitle: "Your account was deleted",
      goodbyeBody:
        "Sorry to see you go. Your data is kept safe — register again with the same phone number any time to pick up right where you left off.",
      sessionExpired: "Your session expired. Please log in again.",
    },
    auth: {
      phoneLabel: "Phone number",
      phonePlaceholder: "+963 9…",
      phoneInvalid: "Enter a valid phone number (8–15 digits, optional +).",
      passwordLabel: "Password",
      passwordInvalid: "Password must be 8–72 characters.",
      confirmPasswordLabel: "Confirm password",
      passwordMismatch: "Passwords do not match.",
      otpLabel: "Verification code",
      otpHint: "Enter the 6-digit code we sent by SMS to {{phone}}.",
      otpInvalid: "Enter the 6-digit code.",
      otpWrong: "Wrong code. Please check the SMS and try again.",
      otpExpired:
        "This code has expired or was used too many times. Request a new one.",
      otpResend: "Resend code",
      otpResendIn: "Resend code in {{seconds}}s",
      otpHourlyCap:
        "Too many codes requested. Please wait and try again later.",
      otpSendFailed: "The code could not be sent. Please try again later.",
      verify: "Verify",
    },
    login: {
      title: "Log in",
      submit: "Log in",
      passwordPlaceholder: "Your password",
      passwordRequired: "Enter your password.",
      invalidCredentials: "Phone number or password is incorrect.",
      noValidRole: "This account cannot use the rider app.",
      throttled:
        "Too many failed attempts. Please wait a moment and try again.",
      forgotPassword: "Forgot password?",
      noAccount: "New to Labby? Create an account",
    },
    register: {
      title: "Create account",
      phoneIntro: "We will send a verification code to this number by SMS.",
      sendCode: "Send code",
      phoneTaken: "This phone number is already registered.",
      phoneTakenAction: "Log in instead",
      detailsTitle: "Almost there",
      detailsIntro: "Choose a password and tell us your name.",
      nameLabel: "Full name",
      nameInvalid: "Enter your name (up to 100 characters).",
      termsLabel: "I accept the Terms of Service",
      termsRequired: "You must accept the Terms of Service to continue.",
      referralLabel: "Referral code (optional)",
      referralHint:
        "Got a code from a friend? You both get wallet credit after your first ride.",
      referralUnknown:
        "We don't know this code. Check the spelling, or clear the field to continue.",
      referralPhoneUsed:
        "This phone number already used a referral. Clear the field to continue.",
      submit: "Create account",
      tokenExpired: "Your verification expired. Please start over.",
      startOver: "Start over",
      reactivatedTitle: "Welcome back!",
      reactivatedBody:
        "This number belonged to a deleted account — it has been reactivated with all your history, wallet and ratings intact. Log in with your old password, or reset it if you forgot.",
      reactivatedLogin: "Go to log in",
      haveAccount: "Already have an account? Log in",
    },
    forgot: {
      title: "Reset password",
      intro:
        "Enter your phone number and we will send a reset code if it is registered.",
      sendCode: "Send code",
      codeSentNeutral:
        "If this number is registered, a code has been sent by SMS.",
      newPasswordTitle: "Choose a new password",
      newPasswordLabel: "New password",
      submit: "Set new password",
      resetTokenExpired:
        "The reset expired or the password is too weak. Please start over.",
      doneTitle: "Password changed",
      doneBody:
        "Your password was changed and all other sessions were signed out. Log in with your new password.",
      goToLogin: "Go to log in",
    },
    settings: {
      title: "Settings",
      language: "Language",
      english: "English",
      arabic: "العربية",
      direction: "Layout direction",
      apiChecking: "Checking backend…",
      apiOffline: "Backend unreachable",
      apiVersionLabel: "Backend version:",
      account: "Account",
      editProfile: "Edit profile",
      changePassword: "Change password",
      changePhone: "Change phone number",
      deleteAccount: "Delete account",
      logout: "Log out",
      notifications: "Notifications",
      notificationCenter: "Notification center",
      notificationPreferences: "Notification preferences",
      rides: "Rides",
      rideHistory: "Your rides",
      savedPlaces: "Saved places",
      ridePreferences: "Ride preferences",
      walletSection: "Wallet",
      wallet: "Wallet",
    },
    profile: {
      title: "Edit profile",
      photo: "Profile photo",
      changePhoto: "Change photo",
      photoUploadFailed:
        "The photo could not be uploaded. Use a supported image type and size.",
      saved: "Profile saved.",
      saveFailed: "The profile could not be saved.",
    },
    changePassword: {
      title: "Change password",
      intro: "For your security we verify this change with an SMS code.",
      currentLabel: "Current password",
      currentRequired: "Enter your current password.",
      newLabel: "New password",
      rejected:
        "The current password or the code is wrong. Please check both and try again.",
      done: "Password changed. Your other sessions were signed out.",
      forgotLink: "Forgot your password?",
      otpHint: "Enter the 6-digit code we sent by SMS to your phone number.",
      newTitle: "Choose a new password",
      startOver: "Start over",
    },
    changePhone: {
      title: "Change phone number",
      newPhoneLabel: "New phone number",
      intro:
        "We verify both your current number and the new one with SMS codes.",
      start: "Send code to current phone",
      phoneTaken: "This phone number is already used by another account.",
      verifyCurrentHint:
        "Enter the 6-digit code we sent to your current number {{phone}}.",
      verifyNewHint:
        "Enter the 6-digit code we sent to your new number {{phone}}.",
      restart: "The flow expired. Please start over — nothing was changed.",
      done: "Phone number updated.",
    },
    deleteAccount: {
      title: "Delete account",
      consequencesTitle: "Before you go",
      consequences:
        "Deleting your account signs you out everywhere and hides you from the app. Your rides, wallet and ratings are kept — registering again with the same phone number reactivates everything. You cannot delete your account during an active ride.",
      sendCode: "Send confirmation code",
      confirm: "Delete my account",
      blocked:
        "Your account cannot be deleted right now (for example during an active ride or with an unsettled balance).",
      otpRejected: "The code is wrong or expired. Request a new one.",
    },
    map: {
      accessibilityLabel: "Map",
      failedTitle: "The map couldn't load",
      failedBody: "Check your connection and try again.",
      retry: "Try again",
      tilesUnavailable:
        "Map details are unavailable right now — check your connection.",
      locating: "Finding your location…",
      permissionDeniedTitle: "Location is off",
      permissionDeniedBody:
        "Allow location access to see where you are on the map.",
      unavailableTitle: "Couldn't find your location",
      unavailableBody: "Make sure location services are on, then try again.",
    },
    notifications: {
      title: "Notifications",
      open: "Open notifications",
      openWithUnread: "Open notifications, {{count}} unread",
      unreadHint: "Unread. Opening it marks it as read.",
      filterAll: "All",
      categories: {
        ride: "Rides",
        chat: "Chat",
        scheduled: "Scheduled rides",
        promotions: "Promotions",
        account: "Account",
        safety: "Safety",
      },
      markAllRead: "Mark all as read",
      markAllFailed:
        "Couldn't mark your notifications as read. Please try again.",
      preferences: "Preferences",
      emptyTitle: "No notifications yet",
      emptyBody: "Updates about your rides and your account will appear here.",
      emptyFilteredTitle: "Nothing in this category",
      emptyFilteredBody: "Try another category or show all notifications.",
      loadMoreNetworkError:
        "Couldn't load older notifications — check your connection.",
      loadMoreServerError: "Couldn't load older notifications right now.",
      endOfList: "You're all caught up.",
    },
    preferences: {
      title: "Notification preferences",
      intro:
        "Choose which notifications Labby sends to your phone. Muted categories still appear in your notification center.",
      lockedCaption: "Always on — ride and safety alerts can't be turned off.",
      saveFailed: "Your change couldn't be saved. Please try again.",
      descriptions: {
        ride: "Driver assigned, arrival and trip updates",
        chat: "Messages from your driver",
        scheduled: "Reminders for rides you booked ahead",
        promotions: "Offers and discounts",
        account: "Account and security updates",
        safety: "Safety alerts",
      },
    },
    routePreview: {
      open: "Route preview (dev)",
      title: "Route preview",
      devNote:
        "Developer tool: checks the routing service between two points. Not available in release builds.",
      origin: "From (lat, lng)",
      destination: "To (lat, lng)",
      submit: "Get route",
      invalidPoint: 'Enter both points as "lat, lng" with valid coordinates.',
      failed: "The route couldn't be calculated.",
      distance: "Distance: {{km}} km",
      duration: "Duration: about {{minutes}} min",
      approximate:
        "Approximate — straight-line estimate (routing service unavailable)",
    },
  },
  ar: {
    ...rideAr,
    ...moneyAr,
    ...commsAr,
    ...trustAr,
    ...m12Ar,
    ...growthAr,
    ...supportAr,
    common: {
      appName: "لبي",
      back: "رجوع",
      continue: "متابعة",
      save: "حفظ",
      showPassword: "إظهار كلمة المرور",
      hidePassword: "إخفاء كلمة المرور",
      networkError: "حدث خطأ ما. تحقق من اتصالك وحاول مرة أخرى.",
      retry: "حاول مرة أخرى",
      networkErrorTitle: "لا يوجد اتصال",
      networkErrorBody:
        "تعذر الوصول إلى لبي. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.",
      serverErrorTitle: "حدث خطأ من جهتنا",
      serverErrorBody: "واجهت خوادم لبي مشكلة. يرجى المحاولة بعد قليل.",
    },
    home: {
      title: "الرئيسية",
      openSettings: "الإعدادات",
      whereTo: "إلى أين؟",
      searchDestination: "ابحث عن وجهة",
    },
    region: {
      finding: "جارٍ تحديد منطقتك…",
      outsideTitle: "خارج منطقة الخدمة",
      outsideBody:
        "لا نقدم خدماتنا في منطقتك بعد. نحن نتوسع — يرجى المحاولة لاحقًا.",
      permissionDeniedTitle: "الموقع مطلوب",
      permissionDeniedBody:
        "نستخدم موقعك لتحديد منطقة التشغيل وعرض الخدمات والأسعار الصحيحة. اسمح بالوصول إلى الموقع للمتابعة.",
      errorTitle: "تعذر فحص منطقتك",
      errorBody: "حدث خطأ أثناء تحديد منطقتك. تحقق من اتصالك وحاول مرة أخرى.",
      retry: "حاول مرة أخرى",
      openSettings: "فتح الإعدادات",
    },
    welcome: {
      tagline: "رحلتك، على طريقتك.",
      createAccount: "إنشاء حساب",
      logIn: "تسجيل الدخول",
      goodbyeTitle: "تم حذف حسابك",
      goodbyeBody:
        "يؤسفنا رحيلك. بياناتك محفوظة بأمان — سجّل مرة أخرى بنفس رقم الهاتف في أي وقت لتستعيد كل شيء كما كان.",
      sessionExpired: "انتهت صلاحية جلستك. يرجى تسجيل الدخول مرة أخرى.",
    },
    auth: {
      phoneLabel: "رقم الهاتف",
      phonePlaceholder: "+963 9…",
      phoneInvalid: "أدخل رقم هاتف صحيحًا (8–15 رقمًا، مع + اختيارية).",
      passwordLabel: "كلمة المرور",
      passwordInvalid: "يجب أن تكون كلمة المرور بين 8 و72 حرفًا.",
      confirmPasswordLabel: "تأكيد كلمة المرور",
      passwordMismatch: "كلمتا المرور غير متطابقتين.",
      otpLabel: "رمز التحقق",
      otpHint:
        "أدخل الرمز المكوَّن من 6 أرقام الذي أرسلناه برسالة نصية إلى \u2066{{phone}}\u2069.",
      otpInvalid: "أدخل الرمز المكوَّن من 6 أرقام.",
      otpWrong: "الرمز غير صحيح. تحقق من الرسالة وحاول مرة أخرى.",
      otpExpired:
        "انتهت صلاحية هذا الرمز أو استُخدم مرات كثيرة. اطلب رمزًا جديدًا.",
      otpResend: "إعادة إرسال الرمز",
      otpResendIn: "إعادة الإرسال خلال {{seconds}} ثانية",
      otpHourlyCap: "طُلبت رموز كثيرة. يرجى الانتظار والمحاولة لاحقًا.",
      otpSendFailed: "تعذر إرسال الرمز. يرجى المحاولة لاحقًا.",
      verify: "تحقق",
    },
    login: {
      title: "تسجيل الدخول",
      submit: "تسجيل الدخول",
      passwordPlaceholder: "كلمة المرور",
      passwordRequired: "أدخل كلمة المرور.",
      invalidCredentials: "رقم الهاتف أو كلمة المرور غير صحيحة.",
      noValidRole: "لا يمكن لهذا الحساب استخدام تطبيق الركاب.",
      throttled:
        "محاولات فاشلة كثيرة. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى.",
      forgotPassword: "هل نسيت كلمة المرور؟",
      noAccount: "جديد في لبي؟ أنشئ حسابًا",
    },
    register: {
      title: "إنشاء حساب",
      phoneIntro: "سنرسل رمز تحقق إلى هذا الرقم برسالة نصية.",
      sendCode: "إرسال الرمز",
      phoneTaken: "رقم الهاتف هذا مسجَّل بالفعل.",
      phoneTakenAction: "سجّل الدخول بدلًا من ذلك",
      detailsTitle: "اقتربنا من النهاية",
      detailsIntro: "اختر كلمة مرور وأخبرنا باسمك.",
      nameLabel: "الاسم الكامل",
      nameInvalid: "أدخل اسمك (حتى 100 حرف).",
      termsLabel: "أوافق على شروط الخدمة",
      termsRequired: "يجب الموافقة على شروط الخدمة للمتابعة.",
      referralLabel: "رمز الدعوة (اختياري)",
      referralHint:
        "لديك رمز من صديق؟ تحصلان معًا على رصيد في المحفظة بعد رحلتك الأولى.",
      referralUnknown:
        "لا نعرف هذا الرمز. تأكد من كتابته، أو امسح الحقل للمتابعة.",
      referralPhoneUsed: "استُخدمت دعوة بهذا الرقم من قبل. امسح الحقل للمتابعة.",
      submit: "إنشاء الحساب",
      tokenExpired: "انتهت صلاحية التحقق. يرجى البدء من جديد.",
      startOver: "البدء من جديد",
      reactivatedTitle: "مرحبًا بعودتك!",
      reactivatedBody:
        "هذا الرقم كان يخص حسابًا محذوفًا — تمت إعادة تفعيله مع كامل سجلّك ومحفظتك وتقييماتك. سجّل الدخول بكلمة مرورك القديمة، أو أعد تعيينها إذا نسيتها.",
      reactivatedLogin: "الانتقال إلى تسجيل الدخول",
      haveAccount: "لديك حساب بالفعل؟ سجّل الدخول",
    },
    forgot: {
      title: "إعادة تعيين كلمة المرور",
      intro: "أدخل رقم هاتفك وسنرسل رمز إعادة تعيين إذا كان الرقم مسجلًا.",
      sendCode: "إرسال الرمز",
      codeSentNeutral: "إذا كان هذا الرقم مسجلًا، فقد أُرسل رمز برسالة نصية.",
      newPasswordTitle: "اختر كلمة مرور جديدة",
      newPasswordLabel: "كلمة المرور الجديدة",
      submit: "تعيين كلمة المرور",
      resetTokenExpired:
        "انتهت صلاحية إعادة التعيين أو كلمة المرور ضعيفة. يرجى البدء من جديد.",
      doneTitle: "تم تغيير كلمة المرور",
      doneBody:
        "تم تغيير كلمة مرورك وتسجيل الخروج من جميع الجلسات الأخرى. سجّل الدخول بكلمة المرور الجديدة.",
      goToLogin: "الانتقال إلى تسجيل الدخول",
    },
    settings: {
      title: "الإعدادات",
      language: "اللغة",
      english: "English",
      arabic: "العربية",
      direction: "اتجاه الواجهة",
      apiChecking: "جارٍ فحص الخادم…",
      apiOffline: "تعذر الوصول إلى الخادم",
      apiVersionLabel: "إصدار الخادم:",
      account: "الحساب",
      editProfile: "تعديل الملف الشخصي",
      changePassword: "تغيير كلمة المرور",
      changePhone: "تغيير رقم الهاتف",
      deleteAccount: "حذف الحساب",
      logout: "تسجيل الخروج",
      notifications: "الإشعارات",
      notificationCenter: "مركز الإشعارات",
      notificationPreferences: "تفضيلات الإشعارات",
      rides: "الرحلات",
      rideHistory: "رحلاتك",
      savedPlaces: "الأماكن المحفوظة",
      ridePreferences: "تفضيلات الرحلة",
      walletSection: "المحفظة",
      wallet: "المحفظة",
    },
    profile: {
      title: "تعديل الملف الشخصي",
      photo: "الصورة الشخصية",
      changePhoto: "تغيير الصورة",
      photoUploadFailed: "تعذر رفع الصورة. استخدم نوع صورة وحجمًا مدعومين.",
      saved: "تم حفظ الملف الشخصي.",
      saveFailed: "تعذر حفظ الملف الشخصي.",
    },
    changePassword: {
      title: "تغيير كلمة المرور",
      intro: "لحماية حسابك نتحقق من هذا التغيير برمز يُرسل برسالة نصية.",
      currentLabel: "كلمة المرور الحالية",
      currentRequired: "أدخل كلمة المرور الحالية.",
      newLabel: "كلمة المرور الجديدة",
      rejected:
        "كلمة المرور الحالية أو الرمز غير صحيح. تحقق منهما وحاول مرة أخرى.",
      done: "تم تغيير كلمة المرور. تم تسجيل الخروج من جلساتك الأخرى.",
      forgotLink: "نسيت كلمة المرور؟",
      otpHint:
        "أدخل الرمز المكوَّن من 6 أرقام الذي أرسلناه برسالة نصية إلى رقم هاتفك.",
      newTitle: "اختر كلمة مرور جديدة",
      startOver: "البدء من جديد",
    },
    changePhone: {
      title: "تغيير رقم الهاتف",
      newPhoneLabel: "رقم الهاتف الجديد",
      intro: "نتحقق من رقمك الحالي والرقم الجديد برموز تُرسل برسائل نصية.",
      start: "إرسال رمز إلى الهاتف الحالي",
      phoneTaken: "رقم الهاتف هذا مستخدم بالفعل في حساب آخر.",
      verifyCurrentHint:
        "أدخل الرمز المكوَّن من 6 أرقام الذي أرسلناه إلى رقمك الحالي \u2066{{phone}}\u2069.",
      verifyNewHint:
        "أدخل الرمز المكوَّن من 6 أرقام الذي أرسلناه إلى رقمك الجديد \u2066{{phone}}\u2069.",
      restart: "انتهت صلاحية العملية. يرجى البدء من جديد — لم يتغير أي شيء.",
      done: "تم تحديث رقم الهاتف.",
    },
    deleteAccount: {
      title: "حذف الحساب",
      consequencesTitle: "قبل أن تغادر",
      consequences:
        "حذف حسابك يسجّل خروجك من كل مكان ويخفيك من التطبيق. تُحفظ رحلاتك ومحفظتك وتقييماتك — والتسجيل مرة أخرى بنفس رقم الهاتف يعيد تفعيل كل شيء. لا يمكنك حذف حسابك أثناء رحلة نشطة.",
      sendCode: "إرسال رمز التأكيد",
      confirm: "احذف حسابي",
      blocked:
        "لا يمكن حذف حسابك الآن (مثلًا أثناء رحلة نشطة أو مع رصيد غير مُسوّى).",
      otpRejected: "الرمز غير صحيح أو منتهي الصلاحية. اطلب رمزًا جديدًا.",
    },
    map: {
      accessibilityLabel: "الخريطة",
      failedTitle: "تعذر تحميل الخريطة",
      failedBody: "تحقق من اتصالك وحاول مرة أخرى.",
      retry: "حاول مرة أخرى",
      tilesUnavailable: "تفاصيل الخريطة غير متاحة حاليًا — تحقق من اتصالك.",
      locating: "جارٍ تحديد موقعك…",
      permissionDeniedTitle: "الموقع غير مفعّل",
      permissionDeniedBody: "اسمح بالوصول إلى الموقع لترى مكانك على الخريطة.",
      unavailableTitle: "تعذر تحديد موقعك",
      unavailableBody: "تأكد من تشغيل خدمات الموقع، ثم حاول مرة أخرى.",
    },
    notifications: {
      title: "الإشعارات",
      open: "فتح الإشعارات",
      openWithUnread: "فتح الإشعارات، {{count}} غير مقروءة",
      unreadHint: "غير مقروء. فتحه يجعله مقروءًا.",
      filterAll: "الكل",
      categories: {
        ride: "الرحلات",
        chat: "المحادثات",
        scheduled: "الرحلات المجدولة",
        promotions: "العروض",
        account: "الحساب",
        safety: "السلامة",
      },
      markAllRead: "تعيين الكل كمقروء",
      markAllFailed: "تعذر تعيين الإشعارات كمقروءة. يرجى المحاولة مرة أخرى.",
      preferences: "التفضيلات",
      emptyTitle: "لا توجد إشعارات بعد",
      emptyBody: "ستظهر هنا التحديثات الخاصة برحلاتك وحسابك.",
      emptyFilteredTitle: "لا شيء في هذه الفئة",
      emptyFilteredBody: "جرّب فئة أخرى أو اعرض جميع الإشعارات.",
      loadMoreNetworkError: "تعذر تحميل الإشعارات الأقدم — تحقق من اتصالك.",
      loadMoreServerError: "تعذر تحميل الإشعارات الأقدم حاليًا.",
      endOfList: "لا توجد إشعارات أخرى.",
    },
    preferences: {
      title: "تفضيلات الإشعارات",
      intro:
        "اختر الإشعارات التي يرسلها لبي إلى هاتفك. تبقى الفئات المكتومة ظاهرة في مركز الإشعارات.",
      lockedCaption: "مفعّلة دائمًا — لا يمكن إيقاف تنبيهات الرحلات والسلامة.",
      saveFailed: "تعذر حفظ التغيير. يرجى المحاولة مرة أخرى.",
      descriptions: {
        ride: "تعيين السائق والوصول وتحديثات الرحلة",
        chat: "الرسائل من سائقك",
        scheduled: "تذكيرات بالرحلات التي حجزتها مسبقًا",
        promotions: "العروض والخصومات",
        account: "تحديثات الحساب والأمان",
        safety: "تنبيهات السلامة",
      },
    },
    routePreview: {
      open: "معاينة المسار (للمطورين)",
      title: "معاينة المسار",
      devNote:
        "أداة للمطورين: تختبر خدمة المسارات بين نقطتين. غير متاحة في إصدارات النشر.",
      origin: "من (خط العرض، خط الطول)",
      destination: "إلى (خط العرض، خط الطول)",
      submit: "احسب المسار",
      invalidPoint:
        'أدخل النقطتين بالصيغة "خط العرض, خط الطول" بإحداثيات صحيحة.',
      failed: "تعذر حساب المسار.",
      distance: "المسافة: {{km}} كم",
      duration: "المدة: حوالي {{minutes}} دقيقة",
      approximate: "تقديرية — تقدير بخط مستقيم (خدمة المسارات غير متاحة)",
    },
  },
} as const;

export type AppLocale = keyof typeof translations;
export const SUPPORTED_LOCALES: AppLocale[] = ["en", "ar"];
