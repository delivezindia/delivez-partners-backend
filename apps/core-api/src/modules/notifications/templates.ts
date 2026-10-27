// Notification copy (plan §14). Kept short: it is shown on lock screens and passes through Google (FCM),
// so never include customer phone numbers, addresses or any health/lab detail — just numbers and amounts.

export type Lang = 'EN' | 'HI' | 'KN';
type Vars = Record<string, string | number | undefined>;
type Copy = (v: Vars) => { title: string; body: string };

const rs = (paise: unknown) => `₹${(Number(paise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const STATUS_TEXT: Record<Lang, Record<string, string>> = {
  EN: { LIVE: 'is approved and live', LIMITED: 'is live with limits', PAUSED: 'is paused by Delivez', SUSPENDED: 'is suspended', REJECTED: 'was not approved', CLOSED: 'is closed', UNDER_REVIEW: 'is under review' },
  HI: { LIVE: 'स्वीकृत है और लाइव है', LIMITED: 'सीमाओं के साथ लाइव है', PAUSED: 'Delivez ने रोका है', SUSPENDED: 'निलंबित है', REJECTED: 'स्वीकृत नहीं हुआ', CLOSED: 'बंद है', UNDER_REVIEW: 'समीक्षा में है' },
  KN: { LIVE: 'ಅನುಮೋದನೆಗೊಂಡು ಲೈವ್ ಆಗಿದೆ', LIMITED: 'ಮಿತಿಗಳೊಂದಿಗೆ ಲೈವ್ ಆಗಿದೆ', PAUSED: 'Delivez ತಡೆಹಿಡಿದಿದೆ', SUSPENDED: 'ಅಮಾನತುಗೊಂಡಿದೆ', REJECTED: 'ಅನುಮೋದನೆಯಾಗಿಲ್ಲ', CLOSED: 'ಮುಚ್ಚಲಾಗಿದೆ', UNDER_REVIEW: 'ಪರಿಶೀಲನೆಯಲ್ಲಿದೆ' },
};

export const TEMPLATES: Record<string, Partial<Record<Lang, Copy>> & { EN: Copy }> = {
  // ---- Partners: orders
  ORDER_PLACED: {
    EN: (v) => ({ title: `New order ${v.orderNumber}`, body: `${v.items} item(s) · ${rs(v.total)} · accept within 3 minutes` }),
    HI: (v) => ({ title: `नया ऑर्डर ${v.orderNumber}`, body: `${v.items} आइटम · ${rs(v.total)} · 3 मिनट में स्वीकार करें` }),
    KN: (v) => ({ title: `ಹೊಸ ಆರ್ಡರ್ ${v.orderNumber}`, body: `${v.items} ಐಟಂ · ${rs(v.total)} · 3 ನಿಮಿಷದಲ್ಲಿ ಸ್ವೀಕರಿಸಿ` }),
  },
  ORDER_REMINDER: {
    EN: (v) => ({ title: `⏰ ${v.orderNumber} is still waiting`, body: `Accept it in the next ${v.minutes} min or it will be cancelled and refunded.` }),
    HI: (v) => ({ title: `⏰ ${v.orderNumber} अभी भी इंतज़ार में`, body: `${v.minutes} मिनट में स्वीकार करें, नहीं तो ऑर्डर रद्द होकर रिफंड हो जाएगा।` }),
    KN: (v) => ({ title: `⏰ ${v.orderNumber} ಇನ್ನೂ ಕಾಯುತ್ತಿದೆ`, body: `${v.minutes} ನಿಮಿಷದಲ್ಲಿ ಸ್ವೀಕರಿಸಿ, ಇಲ್ಲದಿದ್ದರೆ ಆರ್ಡರ್ ರದ್ದಾಗಿ ಮರುಪಾವತಿಯಾಗುತ್ತದೆ.` }),
  },
  ORDER_MISSED: {
    EN: (v) => ({ title: `Missed order ${v.orderNumber}`, body: 'It was not accepted in 3 minutes and the customer was refunded.' }),
    HI: (v) => ({ title: `छूटा ऑर्डर ${v.orderNumber}`, body: '3 मिनट में स्वीकार नहीं हुआ, ग्राहक को रिफंड किया गया।' }),
    KN: (v) => ({ title: `ತಪ್ಪಿದ ಆರ್ಡರ್ ${v.orderNumber}`, body: '3 ನಿಮಿಷದಲ್ಲಿ ಸ್ವೀಕರಿಸಲಿಲ್ಲ, ಗ್ರಾಹಕರಿಗೆ ಮರುಪಾವತಿ ಮಾಡಲಾಗಿದೆ.' }),
  },
  ORDER_CANCELLED: {
    EN: (v) => ({ title: `Order ${v.orderNumber} cancelled`, body: `${v.reason ? `Reason: ${v.reason}. ` : ''}Stop preparing it.${Number(v.comp) > 0 ? ` Delivez will pay you ${rs(v.comp)} for the food.` : ''}` }),
    HI: (v) => ({ title: `ऑर्डर ${v.orderNumber} रद्द`, body: `इसे बनाना बंद करें।${Number(v.comp) > 0 ? ` खाने के लिए Delivez आपको ${rs(v.comp)} देगा।` : ''}` }),
    KN: (v) => ({ title: `ಆರ್ಡರ್ ${v.orderNumber} ರದ್ದಾಗಿದೆ`, body: `ಇದನ್ನು ತಯಾರಿಸುವುದನ್ನು ನಿಲ್ಲಿಸಿ.${Number(v.comp) > 0 ? ` ಊಟಕ್ಕಾಗಿ Delivez ನಿಮಗೆ ${rs(v.comp)} ಪಾವತಿಸುತ್ತದೆ.` : ''}` }),
  },
  ORDER_LATE: {
    EN: (v) => ({ title: `⏰ ${v.orderNumber} is running late`, body: `${v.minutes} min past the time you promised. Mark it ready, or add time so the customer knows.` }),
    HI: (v) => ({ title: `⏰ ${v.orderNumber} में देर हो रही है`, body: `वादे के समय से ${v.minutes} मिनट ज़्यादा। तैयार मार्क करें, या समय बढ़ाएँ ताकि ग्राहक को पता रहे।` }),
    KN: (v) => ({ title: `⏰ ${v.orderNumber} ತಡವಾಗುತ್ತಿದೆ`, body: `ನೀವು ಹೇಳಿದ ಸಮಯಕ್ಕಿಂತ ${v.minutes} ನಿಮಿಷ ಹೆಚ್ಚು. ಸಿದ್ಧ ಎಂದು ಗುರುತಿಸಿ, ಅಥವಾ ಸಮಯ ಹೆಚ್ಚಿಸಿ.` }),
  },
  DELIVERY_FAILED: {
    EN: (v) => ({ title: `Delivery failed · ${v.orderNumber}`, body: `${v.reason}. ${v.back ? 'The rider is bringing the items back — check them in when they arrive.' : Number(v.comp) > 0 ? `Delivez will pay you ${rs(v.comp)} for the food.` : ''}` }),
    HI: (v) => ({ title: `डिलीवरी नहीं हो सकी · ${v.orderNumber}`, body: v.back ? 'राइडर सामान वापस ला रहा है — आने पर जाँच लें।' : Number(v.comp) > 0 ? `खाने के लिए Delivez आपको ${rs(v.comp)} देगा।` : '' }),
    KN: (v) => ({ title: `ಡೆಲಿವರಿ ಆಗಲಿಲ್ಲ · ${v.orderNumber}`, body: v.back ? 'ರೈಡರ್ ವಸ್ತುಗಳನ್ನು ಹಿಂತಿರುಗಿ ತರುತ್ತಿದ್ದಾರೆ — ಬಂದಾಗ ಪರಿಶೀಲಿಸಿ.' : Number(v.comp) > 0 ? `ಊಟಕ್ಕಾಗಿ Delivez ನಿಮಗೆ ${rs(v.comp)} ಪಾವತಿಸುತ್ತದೆ.` : '' }),
  },
  RIDER_ARRIVED: {
    EN: (v) => ({ title: `Rider is here for ${v.orderNumber}`, body: v.ready ? 'Hand over the order with the rider’s code.' : 'The order is not ready yet — the rider is waiting.' }),
    HI: (v) => ({ title: `${v.orderNumber} के लिए राइडर आ गया`, body: v.ready ? 'राइडर के कोड से ऑर्डर सौंपें।' : 'ऑर्डर अभी तैयार नहीं — राइडर इंतज़ार कर रहा है।' }),
    KN: (v) => ({ title: `${v.orderNumber}ಗಾಗಿ ರೈಡರ್ ಬಂದಿದ್ದಾರೆ`, body: v.ready ? 'ರೈಡರ್ ಕೋಡ್‌ನೊಂದಿಗೆ ಆರ್ಡರ್ ಹಸ್ತಾಂತರಿಸಿ.' : 'ಆರ್ಡರ್ ಇನ್ನೂ ಸಿದ್ಧವಿಲ್ಲ — ರೈಡರ್ ಕಾಯುತ್ತಿದ್ದಾರೆ.' }),
  },
  LOW_STOCK: {
    EN: (v) => ({ title: `Low stock: ${v.name}`, body: `${v.available} left. Restock or it goes out of stock.` }),
    HI: (v) => ({ title: `कम स्टॉक: ${v.name}`, body: `${v.available} बचे हैं।` }),
    KN: (v) => ({ title: `ಕಡಿಮೆ ಸ್ಟಾಕ್: ${v.name}`, body: `${v.available} ಉಳಿದಿವೆ.` }),
  },
  RETURN_COMING: {
    EN: (v) => ({ title: `Items coming back · ${v.orderNumber}`, body: `The customer returned ${v.items} item(s) at the door (${rs(v.amount)} refunded). Check them when the rider arrives.` }),
    HI: (v) => ({ title: `आइटम वापस आ रहे हैं · ${v.orderNumber}`, body: `ग्राहक ने ${v.items} आइटम लौटाए (${rs(v.amount)} वापस)। राइडर के आने पर जाँचें।` }),
    KN: (v) => ({ title: `ಐಟಂಗಳು ಹಿಂತಿರುಗುತ್ತಿವೆ · ${v.orderNumber}`, body: `ಗ್ರಾಹಕರು ${v.items} ಐಟಂ ಹಿಂತಿರುಗಿಸಿದ್ದಾರೆ (${rs(v.amount)} ಮರುಪಾವತಿ). ರೈಡರ್ ಬಂದಾಗ ಪರಿಶೀಲಿಸಿ.` }),
  },
  // ---- Partners: pharmacy (no medicine names — health data)
  RX_REVIEW: {
    EN: (v) => ({ title: `Prescription to check · ${v.orderNumber}`, body: `${v.items} item(s) · ${rs(v.total)} · review within ${v.minutes} minutes` }),
    HI: (v) => ({ title: `पर्चा जाँचें · ${v.orderNumber}`, body: `${v.items} आइटम · ${rs(v.total)} · ${v.minutes} मिनट में जाँचें` }),
    KN: (v) => ({ title: `ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ಪರಿಶೀಲಿಸಿ · ${v.orderNumber}`, body: `${v.items} ಐಟಂ · ${rs(v.total)} · ${v.minutes} ನಿಮಿಷದಲ್ಲಿ ಪರಿಶೀಲಿಸಿ` }),
  },
  // ---- Partners: daily
  EXPIRY_ALERT: {
    EN: (v) => ({ title: 'Stock expiry check', body: `${v.expired ? `${v.expired} item(s) expired · ` : ''}${v.expiring} expiring within ${v.days} days. Take them off the shelf or return them.` }),
    HI: (v) => ({ title: 'स्टॉक एक्सपायरी जाँच', body: `${v.expired ? `${v.expired} आइटम एक्सपायर · ` : ''}${v.expiring} आइटम ${v.days} दिनों में एक्सपायर होंगे।` }),
    KN: (v) => ({ title: 'ಸ್ಟಾಕ್ ಅವಧಿ ಪರಿಶೀಲನೆ', body: `${v.expired ? `${v.expired} ಐಟಂ ಅವಧಿ ಮುಗಿದಿದೆ · ` : ''}${v.expiring} ಐಟಂ ${v.days} ದಿನಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ.` }),
  },
  DAILY_SUMMARY: {
    EN: (v) => ({ title: `Today at ${v.store}`, body: `${v.orders} order(s) · ${rs(v.sales)} sales${v.missed ? ` · ${v.missed} missed` : ''}` }),
    HI: (v) => ({ title: `आज ${v.store} में`, body: `${v.orders} ऑर्डर · ${rs(v.sales)} बिक्री${v.missed ? ` · ${v.missed} छूटे` : ''}` }),
    KN: (v) => ({ title: `ಇಂದು ${v.store}`, body: `${v.orders} ಆರ್ಡರ್ · ${rs(v.sales)} ಮಾರಾಟ${v.missed ? ` · ${v.missed} ತಪ್ಪಿದವು` : ''}` }),
  },
  // ---- Partners: support
  SUPPORT_REPLY: {
    EN: (v) => ({ title: `Delivez support replied · ${v.ticket}`, body: String(v.subject ?? '') }),
    HI: (v) => ({ title: `Delivez सपोर्ट का जवाब · ${v.ticket}`, body: String(v.subject ?? '') }),
    KN: (v) => ({ title: `Delivez ಸಹಾಯ ಉತ್ತರಿಸಿದೆ · ${v.ticket}`, body: String(v.subject ?? '') }),
  },
  SUPPORT_RESOLVED: {
    EN: (v) => ({ title: `Ticket ${v.ticket} resolved`, body: `${v.subject}. Reply if it isn’t sorted.` }),
    HI: (v) => ({ title: `टिकट ${v.ticket} हल हुआ`, body: `${v.subject}. ठीक न हो तो जवाब दें।` }),
    KN: (v) => ({ title: `ಟಿಕೆಟ್ ${v.ticket} ಪರಿಹಾರವಾಗಿದೆ`, body: `${v.subject}. ಸರಿಯಾಗದಿದ್ದರೆ ಉತ್ತರಿಸಿ.` }),
  },
  // ---- Partners: labs (no test names — health data)
  LAB_BOOKING: {
    EN: (v) => ({ title: `New booking ${v.bookingNumber}`, body: `${v.when} · ${v.type === 'HOME' ? 'home collection' : 'walk-in'}${v.rx ? ' · check prescription' : ''}` }),
    HI: (v) => ({ title: `नई बुकिंग ${v.bookingNumber}`, body: `${v.when} · ${v.type === 'HOME' ? 'घर से सैंपल' : 'वॉक-इन'}` }),
    KN: (v) => ({ title: `ಹೊಸ ಬುಕಿಂಗ್ ${v.bookingNumber}`, body: `${v.when} · ${v.type === 'HOME' ? 'ಮನೆಯಿಂದ ಮಾದರಿ' : 'ವಾಕ್-ಇನ್'}` }),
  },
  LAB_CANCELLED: {
    EN: (v) => ({ title: `Booking ${v.bookingNumber} cancelled`, body: 'The slot is free again.' }),
    HI: (v) => ({ title: `बुकिंग ${v.bookingNumber} रद्द`, body: 'स्लॉट फिर से खाली है।' }),
    KN: (v) => ({ title: `ಬುಕಿಂಗ್ ${v.bookingNumber} ರದ್ದಾಗಿದೆ`, body: 'ಸ್ಲಾಟ್ ಮತ್ತೆ ಲಭ್ಯವಿದೆ.' }),
  },
  // ---- Partners: account
  DOC_VERIFIED: {
    EN: (v) => ({ title: 'Document approved', body: `${v.label} for ${v.store} was verified.` }),
    HI: (v) => ({ title: 'दस्तावेज़ स्वीकृत', body: `${v.store} का ${v.label} सत्यापित हुआ।` }),
    KN: (v) => ({ title: 'ದಾಖಲೆ ಅನುಮೋದನೆ', body: `${v.store} ನ ${v.label} ಪರಿಶೀಲಿಸಲಾಗಿದೆ.` }),
  },
  DOC_REJECTED: {
    EN: (v) => ({ title: 'Document needs re-upload', body: `${v.label} for ${v.store}: ${v.reason ?? 'please upload again'}` }),
    HI: (v) => ({ title: 'दस्तावेज़ दोबारा अपलोड करें', body: `${v.store} का ${v.label}: ${v.reason ?? 'फिर से अपलोड करें'}` }),
    KN: (v) => ({ title: 'ದಾಖಲೆ ಮತ್ತೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ', body: `${v.store} ನ ${v.label}: ${v.reason ?? 'ಮತ್ತೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ'}` }),
  },
  STORE_STATUS: {
    EN: (v) => ({ title: `${v.store} ${STATUS_TEXT.EN[String(v.to)] ?? 'was updated'}`, body: v.reason ? String(v.reason) : v.to === 'LIVE' ? 'Open your store to start getting orders.' : 'Open the app for details.' }),
    HI: (v) => ({ title: `${v.store} ${STATUS_TEXT.HI[String(v.to)] ?? 'अपडेट हुआ'}`, body: v.reason ? String(v.reason) : 'विवरण के लिए ऐप खोलें।' }),
    KN: (v) => ({ title: `${v.store} ${STATUS_TEXT.KN[String(v.to)] ?? 'ನವೀಕರಿಸಲಾಗಿದೆ'}`, body: v.reason ? String(v.reason) : 'ವಿವರಗಳಿಗೆ ಆ್ಯಪ್ ತೆರೆಯಿರಿ.' }),
  },
  ADMIN_NOTICE: {
    EN: (v) => ({ title: `Message from Delivez · ${v.store}`, body: String(v.message ?? '') }),
    HI: (v) => ({ title: `Delivez से संदेश · ${v.store}`, body: String(v.message ?? '') }),
    KN: (v) => ({ title: `Delivez ಸಂದೇಶ · ${v.store}`, body: String(v.message ?? '') }),
  },
  STAFF_ADDED: {
    EN: (v) => ({ title: `You were added to ${v.store}`, body: `Role: ${String(v.role).replace(/_/g, ' ').toLowerCase()}. Log in to start.` }),
    HI: (v) => ({ title: `आपको ${v.store} में जोड़ा गया`, body: 'शुरू करने के लिए लॉग इन करें।' }),
    KN: (v) => ({ title: `ನಿಮ್ಮನ್ನು ${v.store} ಗೆ ಸೇರಿಸಲಾಗಿದೆ`, body: 'ಪ್ರಾರಂಭಿಸಲು ಲಾಗಿನ್ ಮಾಡಿ.' }),
  },
  BANK_STATUS: {
    EN: (v) => ({ title: v.ok ? 'Bank account verified' : 'Bank account check failed', body: v.ok ? `Payouts for ${v.store} will go to this account.` : `Check the account details for ${v.store}.` }),
    HI: (v) => ({ title: v.ok ? 'बैंक खाता सत्यापित' : 'बैंक खाता जाँच विफल', body: String(v.store) }),
    KN: (v) => ({ title: v.ok ? 'ಬ್ಯಾಂಕ್ ಖಾತೆ ಪರಿಶೀಲಿಸಲಾಗಿದೆ' : 'ಬ್ಯಾಂಕ್ ಖಾತೆ ಪರಿಶೀಲನೆ ವಿಫಲ', body: String(v.store) }),
  },
  TEST: {
    EN: () => ({ title: 'Delivez alerts are on', body: 'This device will get new-order alerts.' }),
    HI: () => ({ title: 'Delivez अलर्ट चालू हैं', body: 'इस डिवाइस पर नए ऑर्डर के अलर्ट आएँगे।' }),
    KN: () => ({ title: 'Delivez ಅಲರ್ಟ್‌ಗಳು ಆನ್ ಆಗಿವೆ', body: 'ಈ ಸಾಧನಕ್ಕೆ ಹೊಸ ಆರ್ಡರ್ ಅಲರ್ಟ್‌ಗಳು ಬರುತ್ತವೆ.' }),
  },
  // ---- Admin console (English)
  ADMIN_SLA: {
    EN: (v) => ({
      title: `${{ PREP_STUCK: 'Order stuck in the kitchen', NO_RIDER: 'No rider for a ready order', DOOR_WAIT: 'Rider waiting at the door' }[String(v.kind)] ?? 'Order SLA'} · ${v.orderNumber}`,
      body: `${v.store} · ${v.minutes} min. Call the shop / rider, or cancel with a reason code.`,
    }),
  },
  // ---- Account managers (English)
  AM_SLA: {
    EN: (v) => ({ title: `🚨 SLA breach · ${v.store}`, body: `${v.orderNumber} ${v.label} (${v.minutes} min). Tap to see the store.` }),
  },
  AM_CHURN: {
    EN: (v) => ({ title: `🔴 Churn risk ${v.risk}/100 · ${v.store}`, body: 'Open the store to see why and what to do.' }),
  },
  AM_DROP: {
    EN: (v) => ({ title: `📉 Orders down ${v.pct}% · ${v.store}`, body: `${v.from} → ${v.to} orders this week. Worth a call.` }),
  },
  AM_COMPLAINT: {
    EN: (v) => ({ title: `Complaint · ${v.store}`, body: `Items were returned at the door on ${v.orderNumber}.` }),
  },
  AM_ESCALATED: {
    EN: (v) => ({ title: `Escalated by account manager · ${v.store}`, body: String(v.title ?? '') }),
  },
  OPS_ESCALATED: {
    EN: (v) => ({ title: `🚨 Escalated · ${v.orderNumber} · ${v.store}`, body: `SLA breached. Escalated by ${v.by}${v.note ? ` — ${v.note}` : ''}.` }),
  },
  ADMIN_SUPPORT: {
    EN: (v) => ({ title: `New support ticket · ${v.store}`, body: `${v.ticket}: ${v.subject}` }),
  },
  ADMIN_SUPPORT_REPLY: {
    EN: (v) => ({ title: `${v.store} replied · ${v.ticket}`, body: String(v.subject ?? '') }),
  },
  ADMIN_REVIEW: { EN: (v) => ({ title: `New application: ${v.store}`, body: `Readiness ${v.score}% · ${v.city ?? 'no city'} — review and approve.` }) },
  ADMIN_DOC: { EN: (v) => ({ title: `Document to verify · ${v.store}`, body: `${v.label} was uploaded.` }) },
};

export function render(code: string, lang: string, vars: Vars) {
  const t = TEMPLATES[code];
  const l = (['EN', 'HI', 'KN'].includes(lang) ? lang : 'EN') as Lang;
  return (t[l] ?? t.EN)(vars);
}
