/**
 * Items leave a bill that had a coupon (the shop ran out, the customer handed them back at the door…): the coupon's
 * share of those items leaves with them. The refund is what the customer actually paid for them, and
 * items − discount + fees still equals the total. Without a coupon the share is 0 and nothing changes.
 */
export function itemsLeave(bill: { itemsSubtotal: number; discountAmount: number }, removed: number) {
  const share = bill.itemsSubtotal > 0 ? Math.min(bill.discountAmount, Math.round((bill.discountAmount * removed) / bill.itemsSubtotal)) : 0;
  return {
    refund: removed - share,
    share,
    update: { itemsSubtotal: { decrement: removed }, discountAmount: { decrement: share }, grandTotal: { decrement: removed - share } },
  };
}
