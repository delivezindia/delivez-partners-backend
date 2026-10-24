// GST on a shop's bill. Menu and shelf prices on Delivez include GST (like an MRP), so tax is worked
// backwards from each line: taxable = price × 100 / (100 + rate). Intra-state sale → half CGST, half SGST.
// Packaging goes with the main supply (a composite supply), so it takes the highest item rate on the bill.
// Delivery is Delivez's own service and is not on the shop's invoice. All amounts in paise.

export interface GstLine {
  name: string;
  hsn: string | null;
  qty: number;
  ratePct: number;
  total: number; // incl. GST
}

export interface GstRow extends GstLine {
  taxable: number;
  cgst: number;
  sgst: number;
}

export interface GstBill {
  registered: boolean;
  rows: GstRow[];
  byRate: { ratePct: number; taxable: number; cgst: number; sgst: number; total: number }[];
  taxable: number;
  cgst: number;
  sgst: number;
  total: number;
}

export function splitGst(total: number, ratePct: number): { taxable: number; cgst: number; sgst: number } {
  if (ratePct <= 0 || total <= 0) return { taxable: Math.max(0, total), cgst: 0, sgst: 0 };
  const taxable = Math.round((total * 100) / (100 + ratePct));
  const tax = total - taxable;
  const cgst = Math.floor(tax / 2);
  return { taxable, cgst, sgst: tax - cgst };
}

/** The bill's tax picture. Unregistered shops (no GSTIN) issue a bill of supply with no tax lines. */
export function gstBill(items: GstLine[], packaging: number, registered: boolean): GstBill {
  const lines: GstLine[] = [...items];
  if (packaging > 0) lines.push({ name: 'Packaging charges', hsn: null, qty: 1, ratePct: Math.max(0, ...items.map((i) => i.ratePct)), total: packaging });
  const rows: GstRow[] = lines.map((l) => ({ ...l, ...(registered ? splitGst(l.total, l.ratePct) : { taxable: l.total, cgst: 0, sgst: 0 }) }));
  const rates = new Map<number, { ratePct: number; taxable: number; cgst: number; sgst: number; total: number }>();
  for (const r of rows) {
    const k = registered ? r.ratePct : 0;
    const g = rates.get(k) ?? { ratePct: k, taxable: 0, cgst: 0, sgst: 0, total: 0 };
    g.taxable += r.taxable;
    g.cgst += r.cgst;
    g.sgst += r.sgst;
    g.total += r.total;
    rates.set(k, g);
  }
  const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'total') => rows.reduce((n, r) => n + r[k], 0);
  return { registered, rows, byRate: [...rates.values()].sort((a, b) => a.ratePct - b.ratePct), taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), total: sum('total') };
}

/** A GSTIN looks like 29ABCDE1234F1Z5 (state code, PAN, entity, Z, check). */
export const isGstin = (s: string | null | undefined) => !!s && /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s.trim().toUpperCase());
