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
  SUB_ACCEPTED: {
    EN: (v) => ({ title: `Replacement accepted · ${v.orderNumber}`, body: `${v.detail}. Pack the replacement.` }),
    HI: (v) => ({ title: `बदला हुआ आइटम स्वीकार · ${v.orderNumber}`, body: `${v.detail}. बदला हुआ आइटम पैक करें।` }),
    KN: (v) => ({ title: `ಬದಲಿ ಸ್ವೀಕರಿಸಲಾಗಿದೆ · ${v.orderNumber}`, body: `${v.detail}. ಬದಲಿ ವಸ್ತುವನ್ನು ಪ್ಯಾಕ್ ಮಾಡಿ.` }),
  },
  SUB_DECLINED: {
    EN: (v) => ({ title: `Replacement declined · ${v.orderNumber}`, body: `${v.expired ? 'No answer from the customer — the item was removed.' : 'The customer said no — the item was removed.'} Pack the rest.` }),
    HI: (v) => ({ title: `बदला हुआ आइटम अस्वीकार · ${v.orderNumber}`, body: 'आइटम हटा दिया गया। बाकी पैक करें।' }),
    KN: (v) => ({ title: `ಬದಲಿ ತಿರಸ್ಕರಿಸಲಾಗಿದೆ · ${v.orderNumber}`, body: 'ವಸ್ತುವನ್ನು ತೆಗೆಯಲಾಗಿದೆ. ಉಳಿದವನ್ನು ಪ್ಯಾಕ್ ಮಾಡಿ.' }),
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
  LAB_RESCHEDULED: {
    EN: (v) => ({ title: `Booking ${v.bookingNumber} moved`, body: `New slot: ${v.when}.` }),
    HI: (v) => ({ title: `बुकिंग ${v.bookingNumber} का समय बदला`, body: `नया स्लॉट: ${v.when}` }),
    KN: (v) => ({ title: `ಬುಕಿಂಗ್ ${v.bookingNumber} ಸಮಯ ಬದಲಾಗಿದೆ`, body: `ಹೊಸ ಸ್ಲಾಟ್: ${v.when}` }),
  },
  // ---- Customers (customer app): order progress
  CUST_ACCEPTED: {
    EN: (v) => ({ title: `${v.store} accepted your order`, body: `${v.orderNumber} is being prepared${v.minutes ? ` · ready in about ${v.minutes} min` : ''}.` }),
    HI: (v) => ({ title: `${v.store} ने आपका ऑर्डर स्वीकार किया`, body: `${v.orderNumber} तैयार हो रहा है${v.minutes ? ` · लगभग ${v.minutes} मिनट` : ''}।` }),
    KN: (v) => ({ title: `${v.store} ನಿಮ್ಮ ಆರ್ಡರ್ ಸ್ವೀಕರಿಸಿದೆ`, body: `${v.orderNumber} ತಯಾರಾಗುತ್ತಿದೆ${v.minutes ? ` · ಸುಮಾರು ${v.minutes} ನಿಮಿಷ` : ''}.` }),
  },
  CUST_REJECTED: {
    EN: (v) => ({ title: `${v.store} couldn’t take ${v.orderNumber}`, body: `${Number(v.refund) > 0 ? `${rs(v.refund)} is being refunded to you.` : 'You have not been charged.'}` }),
    HI: (v) => ({ title: `${v.store} ${v.orderNumber} नहीं ले सका`, body: Number(v.refund) > 0 ? `${rs(v.refund)} आपको वापस किया जा रहा है।` : 'आपसे कोई पैसा नहीं लिया गया।' }),
    KN: (v) => ({ title: `${v.store} ${v.orderNumber} ಸ್ವೀಕರಿಸಲಾಗಲಿಲ್ಲ`, body: Number(v.refund) > 0 ? `${rs(v.refund)} ಮರುಪಾವತಿ ಆಗುತ್ತಿದೆ.` : 'ನಿಮ್ಮಿಂದ ಹಣ ಪಡೆದಿಲ್ಲ.' }),
  },
  CUST_ON_WAY: {
    EN: (v) => ({ title: `${v.orderNumber} is on the way`, body: `The rider has picked it up from ${v.store}.` }),
    HI: (v) => ({ title: `${v.orderNumber} रास्ते में है`, body: `राइडर ने ${v.store} से ऑर्डर ले लिया है।` }),
    KN: (v) => ({ title: `${v.orderNumber} ದಾರಿಯಲ್ಲಿದೆ`, body: `ರೈಡರ್ ${v.store} ನಿಂದ ಆರ್ಡರ್ ಪಡೆದಿದ್ದಾರೆ.` }),
  },
  CUST_ARRIVED: {
    EN: (v) => ({ title: 'Your rider is here', body: `${v.orderNumber} is at your door. Share your delivery code with the rider.` }),
    HI: (v) => ({ title: 'राइडर आ गया है', body: `${v.orderNumber} आपके दरवाज़े पर है। राइडर को डिलीवरी कोड बताएँ।` }),
    KN: (v) => ({ title: 'ರೈಡರ್ ಬಂದಿದ್ದಾರೆ', body: `${v.orderNumber} ನಿಮ್ಮ ಬಾಗಿಲಲ್ಲಿದೆ. ಡೆಲಿವರಿ ಕೋಡ್ ತಿಳಿಸಿ.` }),
  },
  CUST_DELIVERED: {
    EN: (v) => ({ title: `${v.orderNumber} delivered`, body: 'Enjoy! Something wrong? Report it from the order.' }),
    HI: (v) => ({ title: `${v.orderNumber} डिलीवर हुआ`, body: 'कोई समस्या? ऑर्डर से बताएँ।' }),
    KN: (v) => ({ title: `${v.orderNumber} ತಲುಪಿದೆ`, body: 'ಸಮಸ್ಯೆಯಿದೆಯೇ? ಆರ್ಡರ್‌ನಿಂದ ತಿಳಿಸಿ.' }),
  },
  CUST_CANCELLED: {
    EN: (v) => ({ title: `${v.orderNumber} was cancelled`, body: `${v.reason ? `${v.reason}. ` : ''}${Number(v.refund) > 0 ? `${rs(v.refund)} is being refunded to you.` : ''}`.trim() }),
    HI: (v) => ({ title: `${v.orderNumber} रद्द हुआ`, body: Number(v.refund) > 0 ? `${rs(v.refund)} आपको वापस किया जा रहा है।` : '' }),
    KN: (v) => ({ title: `${v.orderNumber} ರದ್ದಾಗಿದೆ`, body: Number(v.refund) > 0 ? `${rs(v.refund)} ಮರುಪಾವತಿ ಆಗುತ್ತಿದೆ.` : '' }),
  },
  CUST_FAILED: {
    EN: (v) => ({ title: `We couldn’t deliver ${v.orderNumber}`, body: `${v.reason ? `${v.reason}. ` : ''}${Number(v.refund) > 0 ? `${rs(v.refund)} is being refunded to you.` : 'Open the order for details.'}` }),
    HI: (v) => ({ title: `${v.orderNumber} डिलीवर नहीं हो सका`, body: Number(v.refund) > 0 ? `${rs(v.refund)} आपको वापस किया जा रहा है।` : 'विवरण के लिए ऑर्डर खोलें।' }),
    KN: (v) => ({ title: `${v.orderNumber} ತಲುಪಿಸಲಾಗಲಿಲ್ಲ`, body: Number(v.refund) > 0 ? `${rs(v.refund)} ಮರುಪಾವತಿ ಆಗುತ್ತಿದೆ.` : 'ವಿವರಗಳಿಗೆ ಆರ್ಡರ್ ತೆರೆಯಿರಿ.' }),
  },
  CUST_DELAYED: {
    EN: (v) => ({ title: `${v.orderNumber} is running late`, body: `${v.store} needs about ${v.minutes} more min. Sorry for the wait.` }),
    HI: (v) => ({ title: `${v.orderNumber} में देर हो रही है`, body: `${v.store} को लगभग ${v.minutes} मिनट और लगेंगे।` }),
    KN: (v) => ({ title: `${v.orderNumber} ತಡವಾಗುತ್ತಿದೆ`, body: `${v.store} ಗೆ ಇನ್ನೂ ಸುಮಾರು ${v.minutes} ನಿಮಿಷ ಬೇಕು.` }),
  },
  CUST_ITEM_OUT: {
    EN: (v) => ({ title: `An item in ${v.orderNumber} is unavailable`, body: `${v.reason ?? 'One item was removed'}.${Number(v.refund) > 0 ? ` ${rs(v.refund)} is being refunded.` : ''}` }),
    HI: (v) => ({ title: `${v.orderNumber} में एक आइटम उपलब्ध नहीं`, body: Number(v.refund) > 0 ? `${rs(v.refund)} वापस किया जा रहा है।` : 'एक आइटम हटाया गया।' }),
    KN: (v) => ({ title: `${v.orderNumber} ನಲ್ಲಿ ಒಂದು ವಸ್ತು ಲಭ್ಯವಿಲ್ಲ`, body: Number(v.refund) > 0 ? `${rs(v.refund)} ಮರುಪಾವತಿ ಆಗುತ್ತಿದೆ.` : 'ಒಂದು ವಸ್ತುವನ್ನು ತೆಗೆಯಲಾಗಿದೆ.' }),
  },
  CUST_RX_OK: {
    EN: (v) => ({ title: 'Prescription approved', body: `The pharmacist at ${v.store} checked it — ${v.orderNumber} is going to the counter.` }),
    HI: (v) => ({ title: 'पर्चा स्वीकृत', body: `${v.store} के फार्मासिस्ट ने जाँच लिया — ${v.orderNumber} तैयार होगा।` }),
    KN: (v) => ({ title: 'ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್ ಅನುಮೋದನೆ', body: `${v.store} ಫಾರ್ಮಸಿಸ್ಟ್ ಪರಿಶೀಲಿಸಿದ್ದಾರೆ — ${v.orderNumber} ತಯಾರಾಗುತ್ತದೆ.` }),
  },
  CUST_SUB_OFFER: {
    EN: (v) => ({ title: `${v.store} suggests a replacement`, body: `${v.reason ?? 'An item ran out'}. Accept or decline within 5 minutes.` }),
    HI: (v) => ({ title: `${v.store} ने बदले में दूसरा आइटम सुझाया`, body: `${v.reason ?? 'एक आइटम खत्म हो गया'}। 5 मिनट में हाँ या ना कहें।` }),
    KN: (v) => ({ title: `${v.store} ಬದಲಿ ವಸ್ತು ಸೂಚಿಸಿದೆ`, body: `${v.reason ?? 'ಒಂದು ವಸ್ತು ಖಾಲಿಯಾಗಿದೆ'}. 5 ನಿಮಿಷದಲ್ಲಿ ಒಪ್ಪಿ ಅಥವಾ ನಿರಾಕರಿಸಿ.` }),
  },
  CUST_LAB_CONFIRMED: {
    EN: (v) => ({ title: 'Lab booking confirmed', body: `${v.store} confirmed ${v.bookingNumber}.` }),
    HI: (v) => ({ title: 'लैब बुकिंग पक्की', body: `${v.store} ने ${v.bookingNumber} पक्की की।` }),
    KN: (v) => ({ title: 'ಲ್ಯಾಬ್ ಬುಕಿಂಗ್ ಖಚಿತ', body: `${v.store} ${v.bookingNumber} ಖಚಿತಪಡಿಸಿದೆ.` }),
  },
  CUST_LAB_REJECTED: {
    EN: (v) => ({ title: 'Lab booking not accepted', body: `${v.bookingNumber}: ${v.reason ?? 'the lab couldn’t take it'}. Any payment is refunded.` }),
    HI: (v) => ({ title: 'लैब बुकिंग स्वीकार नहीं हुई', body: `${v.bookingNumber}: ${v.reason ?? 'लैब इसे नहीं ले सकी'}।` }),
    KN: (v) => ({ title: 'ಲ್ಯಾಬ್ ಬುಕಿಂಗ್ ಸ್ವೀಕರಿಸಿಲ್ಲ', body: `${v.bookingNumber}: ${v.reason ?? 'ಲ್ಯಾಬ್ ಇದನ್ನು ತೆಗೆದುಕೊಳ್ಳಲಾಗಲಿಲ್ಲ'}.` }),
  },
  CUST_LAB_COLLECTOR: {
    EN: (v) => ({ title: 'Sample collector assigned', body: `${v.store} assigned someone for ${v.bookingNumber}. Keep your booking code ready.` }),
    HI: (v) => ({ title: 'सैंपल लेने वाला तय हुआ', body: `${v.bookingNumber} के लिए ${v.store} ने किसी को भेजा है। बुकिंग कोड तैयार रखें।` }),
    KN: (v) => ({ title: 'ಮಾದರಿ ಸಂಗ್ರಾಹಕರು ನಿಯೋಜಿತ', body: `${v.bookingNumber} ಗೆ ${v.store} ಒಬ್ಬರನ್ನು ಕಳುಹಿಸಿದೆ. ಬುಕಿಂಗ್ ಕೋಡ್ ಸಿದ್ಧವಿಡಿ.` }),
  },
  CUST_LAB_REPORT: {
    EN: (v) => ({ title: 'Your lab report is ready', body: `${v.bookingNumber} · open the app to view it.` }),
    HI: (v) => ({ title: 'आपकी लैब रिपोर्ट तैयार है', body: `${v.bookingNumber} · देखने के लिए ऐप खोलें।` }),
    KN: (v) => ({ title: 'ನಿಮ್ಮ ಲ್ಯಾಬ್ ವರದಿ ಸಿದ್ಧ', body: `${v.bookingNumber} · ನೋಡಲು ಆ್ಯಪ್ ತೆರೆಯಿರಿ.` }),
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
