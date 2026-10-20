/**
 * EN + AR copy of the M8 money slice (wallet, tips; the booking/ride/receipt
 * money lines live in ride-translations.ts). Merged into translations.ts;
 * keys must stay identical in both languages.
 *
 * Arabic numerals: the UI always renders WESTERN digits (owner ruling
 * 2026-10-11); amounts inside Arabic text are wrapped in an LTR isolate by
 * formatMoney/formatSignedMoney, and the SYP currency label is "ل.س".
 */
export const moneyEn = {
  money: {
    currencies: {
      SYP: "SYP",
    },
    currencyNames: {
      SYP: "Syrian pound",
    },
  },
  wallet: {
    title: "Wallet",
    balanceLabel: "Balance · {{currency}}",
    noTopUps:
      "Credits come from refunds, promotions and rewards. No top-ups.",
    dueBanner:
      "{{money}} cancellation fee from {{date}} will be added to your next ride.",
    activity: "Activity",
    emptyTitle: "No activity yet",
    emptyBody:
      "Refunds, promotions, ride payments and tips will appear here.",
    loadMore: "Load more",
    loadMoreFailed: "Couldn't load older activity. Please try again.",
    takenFromWallet: "taken from wallet",
    types: {
      fare_payment: "Ride payment",
      tip: "Tip",
      cancellation_fee: "Cancellation fee",
      refund: "Refund",
      admin_grant: "Credit from Labby",
      referral: "Referral reward",
      promo: "Promotion",
      loyalty_redemption: "Rewards credit",
    },
  },
  tip: {
    title: "Tip {{name}}",
    titleNoName: "Tip your driver",
    customLabel: "Custom amount · {{currency}}",
    fromWallet: "From your wallet · balance {{money}}",
    window: "You can tip until {{time}}",
    windowDuringRide: "You can tip during the ride and up to 24 hours after",
    allToDriver: "100% goes to {{name}} — Labby takes nothing",
    allToDriverNoName: "100% goes to your driver — Labby takes nothing",
    send: "Send {{money}} tip",
    notNow: "Not now",
    invalidAmount: "Enter a tip amount.",
    sent: "Tip sent — thank you!",
    errors: {
      windowExpired:
        "The tip window has ended — tips are possible up to 24 hours after a ride.",
      alreadyTipped: "You already tipped for this ride.",
      insufficientBalance: "Your wallet balance doesn't cover this tip.",
      notTippable: "This ride can't be tipped.",
      generic: "The tip couldn't be sent. Please try again.",
    },
  },
} as const;

export const moneyAr = {
  money: {
    currencies: {
      SYP: "ل.س",
    },
    currencyNames: {
      SYP: "ليرة سورية",
    },
  },
  wallet: {
    title: "المحفظة",
    balanceLabel: "الرصيد · {{currency}}",
    noTopUps:
      "يأتي الرصيد من الاستردادات والعروض والمكافآت. لا يمكن تعبئة المحفظة.",
    dueBanner: "رسم إلغاء {{money}} من {{date}} سيُضاف إلى رحلتك القادمة.",
    activity: "الحركات",
    emptyTitle: "لا توجد حركات بعد",
    emptyBody: "ستظهر هنا الاستردادات والعروض ودفعات الرحلات والإكراميات.",
    loadMore: "تحميل المزيد",
    loadMoreFailed: "تعذر تحميل الحركات الأقدم. يرجى المحاولة مرة أخرى.",
    takenFromWallet: "خُصم من المحفظة",
    types: {
      fare_payment: "دفع رحلة",
      tip: "إكرامية",
      cancellation_fee: "رسم إلغاء",
      refund: "استرداد",
      admin_grant: "رصيد من لبي",
      referral: "مكافأة دعوة صديق",
      promo: "عرض ترويجي",
      loyalty_redemption: "رصيد مكافآت",
    },
  },
  tip: {
    title: "إكرامية لـ\u2068{{name}}\u2069",
    titleNoName: "قدّم إكرامية لسائقك",
    customLabel: "مبلغ مخصص · {{currency}}",
    fromWallet: "من محفظتك · الرصيد {{money}}",
    window: "يمكنك إرسال الإكرامية حتى {{time}}",
    windowDuringRide: "يمكنك إرسال الإكرامية أثناء الرحلة وحتى 24 ساعة بعدها",
    allToDriver: "تذهب الإكرامية بالكامل إلى {{name}} — لبي لا يقتطع شيئًا",
    allToDriverNoName:
      "تذهب الإكرامية بالكامل إلى سائقك — لبي لا يقتطع شيئًا",
    send: "أرسل إكرامية {{money}}",
    notNow: "ليس الآن",
    invalidAmount: "أدخل مبلغ الإكرامية.",
    sent: "أُرسلت الإكرامية — شكرًا لك!",
    errors: {
      windowExpired:
        "انتهت مهلة الإكرامية — يمكن إرسالها حتى 24 ساعة بعد الرحلة.",
      alreadyTipped: "لقد أرسلت إكرامية لهذه الرحلة بالفعل.",
      insufficientBalance: "رصيد محفظتك لا يكفي لهذه الإكرامية.",
      notTippable: "لا يمكن إرسال إكرامية لهذه الرحلة.",
      generic: "تعذر إرسال الإكرامية. يرجى المحاولة مرة أخرى.",
    },
  },
} as const;
