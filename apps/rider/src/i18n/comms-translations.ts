/**
 * EN + AR copy of the M10 comms & safety slice (chat, call, share trip,
 * SOS) — approved artboards RiderChat / RiderChatAr / RiderSafetyActions /
 * RiderSosConfirm. Merged into translations.ts; keys must stay identical
 * in both languages.
 */
export const commsEn = {
  chat: {
    back: "Back",
    call: "Call {{name}}",
    today: "Today",
    seen: "Seen",
    sending: "Sending…",
    placeholder: "Message {{name}}…",
    messageLabel: "Message",
    send: "Send",
    statusOnTheWay: "On the way",
    statusArrived: "Arrived",
    statusOnTrip: "On the trip",
    readOnlyNotice:
      "This chat has closed. You can still read the messages, but new ones can't be sent.",
    loadEarlier: "Load earlier messages",
    noChatTitle: "No chat for this ride",
    noChatBody: "Chat opens once a driver accepts your ride.",
    errorTitle: "Couldn't open the chat",
    errorBody: "Something went wrong loading this chat. Check your connection and try again.",
    sendFailed: "This message couldn't be sent.",
  },
  safety: {
    chat: "Chat",
    callAction: "Call",
    share: "Share trip",
    shareAlready:
      "Trip sharing was already started for this ride — the link can't be created again.",
    shareFailed: "Couldn't share your trip. Please try again.",
    sos: "SOS",
    sosLabel: "Emergency SOS",
    sosTitle: "Emergency SOS",
    sosBody:
      "Your phone will call {{number}}, the emergency number for {{region}}. Labby support is alerted instantly with your ride and live location.",
    sosBodyNoNumber:
      "Your phone will open the dialer to call emergency services. Labby support is alerted instantly with your ride and live location.",
    sosConfirm: "Call {{number}} — support alerted",
    sosConfirmNoNumber: "Call emergency — support alerted",
    sosCancel: "Cancel",
    sosFootnote: "The alert reaches support even if the call doesn't connect.",
  },
};

export const commsAr: typeof commsEn = {
  chat: {
    back: "رجوع",
    call: "اتصال بـ{{name}}",
    today: "اليوم",
    seen: "شوهدت",
    sending: "جارٍ الإرسال…",
    placeholder: "راسل {{name}}…",
    messageLabel: "الرسالة",
    send: "إرسال",
    statusOnTheWay: "في الطريق",
    statusArrived: "وصل",
    statusOnTrip: "خلال الرحلة",
    readOnlyNotice:
      "أُغلقت هذه المحادثة. لا يزال بإمكانك قراءة الرسائل، لكن لا يمكن إرسال رسائل جديدة.",
    loadEarlier: "تحميل رسائل أقدم",
    noChatTitle: "لا توجد محادثة لهذه الرحلة",
    noChatBody: "تُفتح المحادثة عندما يقبل سائق رحلتك.",
    errorTitle: "تعذّر فتح المحادثة",
    errorBody: "حدث خطأ أثناء تحميل المحادثة. تحقق من اتصالك وحاول مرة أخرى.",
    sendFailed: "تعذّر إرسال هذه الرسالة.",
  },
  safety: {
    chat: "محادثة",
    callAction: "اتصال",
    share: "مشاركة الرحلة",
    shareAlready:
      "سبق أن بدأت مشاركة هذه الرحلة — لا يمكن إنشاء الرابط مرة أخرى.",
    shareFailed: "تعذّرت مشاركة رحلتك. حاول مرة أخرى.",
    sos: "SOS",
    sosLabel: "نداء استغاثة",
    sosTitle: "نداء استغاثة",
    sosBody:
      "سيتصل هاتفك بالرقم {{number}}، رقم الطوارئ في {{region}}. يصل تنبيه فوري إلى دعم لبي مع تفاصيل رحلتك وموقعك المباشر.",
    sosBodyNoNumber:
      "سيفتح هاتفك شاشة الاتصال للاتصال بالطوارئ. يصل تنبيه فوري إلى دعم لبي مع تفاصيل رحلتك وموقعك المباشر.",
    sosConfirm: "اتصال بـ{{number}} — تم تنبيه الدعم",
    sosConfirmNoNumber: "اتصال بالطوارئ — تم تنبيه الدعم",
    sosCancel: "إلغاء",
    sosFootnote: "يصل التنبيه إلى الدعم حتى لو لم يكتمل الاتصال.",
  },
};
