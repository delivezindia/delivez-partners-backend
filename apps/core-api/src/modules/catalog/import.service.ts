import { Injectable } from '@nestjs/common';
import type { Vertical } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../onboarding/onboarding.service';
import { productCreateSchema } from './catalog.schemas';
import { CatalogService } from './catalog.service';

/** Column headers accepted in CSV (case-insensitive), with friendly aliases. */
const COLUMNS: Record<string, string[]> = {
  name: ['name', 'item', 'item name', 'product', 'product name'],
  price: ['price', 'selling price', 'sp', 'rate'],
  mrp: ['mrp'],
  category: ['category', 'section'],
  unit: ['unit', 'uom'],
  stock: ['stock', 'qty', 'quantity'],
  sku: ['sku', 'code', 'item code'],
  barcode: ['barcode', 'ean'],
  description: ['description', 'desc'],
  veg: ['veg', 'is veg', 'veg/non-veg', 'type'],
  rx: ['rx', 'prescription', 'prescription required'],
  sample: ['sample', 'sample type', 'specimen'],
  fasting: ['fasting', 'fasting hours', 'fasting_hours'],
  report: ['report hours', 'report_hours', 'tat', 'tat hours', 'report time'],
  home: ['home', 'home collection', 'home_collection'],
  walkin: ['walkin', 'walk-in', 'walk in'],
  parameters: ['parameters', 'tests included', 'params'],
  schedule: ['schedule', 'drug schedule'],
  salt: ['salt', 'composition', 'salt composition'],
  tax: ['gst', 'tax', 'gst %', 'tax %'],
};

export const CSV_TEMPLATE: Record<Vertical, string> = {
  EAT: 'name,price,mrp,category,veg,description\nChicken Biryani,320,,Biryani,non-veg,Hyderabadi dum biryani\nPaneer Tikka,260,,Starters,veg,\n',
  GROCERY: 'name,price,mrp,category,unit,stock,sku,barcode\nToor Dal 1 kg,165,180,Pulses,pack,40,TD1KG,8901234567890\nAmul Butter 100 g,58,60,Dairy,pack,25,AB100,\n',
  PHARMACY: 'name,price,mrp,category,stock,schedule,salt,rx\nDolo 650 (15 tabs),30,32,Fever,100,OTC,Paracetamol 650 mg,no\nAzithral 500 (3 tabs),110,119,Antibiotics,20,H,Azithromycin 500 mg,yes\n',
  LOCAL_STORES: 'name,price,mrp,category,unit,stock,sku\nRose bouquet (12),499,,Bouquets,piece,10,RB12\n',
  DIAGNOSTICS:
    'name,price,mrp,category,sample,fasting_hours,report_hours,home,walkin,rx,parameters\nComplete Blood Count (CBC),350,450,Blood tests,blood,0,12,yes,yes,no,24\nThyroid Profile (T3 T4 TSH),550,700,Thyroid,blood,0,24,yes,yes,no,3\nHbA1c,450,600,Diabetes,blood,0,24,yes,yes,yes,1\n',
  RUSH: 'name,price,mrp,category,unit,stock,sku\n',
  FETCH: 'name,price,mrp,category,unit,stock,sku\n',
};

interface PreviewRow {
  row: number;
  action: 'CREATE' | 'UPDATE' | 'ERROR';
  name: string;
  price: number | null;
  category: string | null;
  stock: number | null;
  errors: string[];
  data?: Record<string, unknown>;
  matchId?: string;
}

const MAX_ROWS = 2000;

// CSV / spreadsheet import with a validation preview (plan §5.4.1): nothing is written until the partner confirms.
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async preview(storeId: string, csv: string, updateExisting: boolean) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { vertical: true } });
    const table = parseCsv(csv);
    if (table.length < 2) return { rows: [], valid: 0, errors: 0, problems: ['The file needs a header row and at least one item'] };
    const header = table[0].map((h) => h.trim().toLowerCase());
    const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, aliases]) => [k, header.findIndex((h) => aliases.includes(h))]));
    const problems: string[] = [];
    if (col.name < 0) problems.push('Missing a "name" column');
    if (col.price < 0) problems.push('Missing a "price" column');
    if (problems.length) return { rows: [], valid: 0, errors: 0, problems };

    const existing = await this.prisma.product.findMany({ where: { storeId, deletedAt: null }, select: { id: true, name: true, sku: true } });
    const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku!.toLowerCase(), p.id]));
    const byName = new Map(existing.map((p) => [p.name.toLowerCase(), p.id]));
    const seen = new Set<string>();

    const rows: PreviewRow[] = table
      .slice(1, MAX_ROWS + 1)
      .map((cells, i) => ({ cells, row: i + 2 }))
      .filter(({ cells }) => cells.some((c) => c.trim()))
      .map(({ cells, row }) => {
        const get = (k: string) => (col[k] >= 0 ? (cells[col[k]] ?? '').trim() : '');
        const errors: string[] = [];
        const name = get('name');
        const price = rupeesToPaise(get('price'));
        const mrp = get('mrp') ? rupeesToPaise(get('mrp')) : null;
        const stockRaw = get('stock');
        const stock = stockRaw ? Number(stockRaw) : null;
        if (price === null) errors.push('Price must be a number');
        if (mrp === null && get('mrp')) errors.push('MRP must be a number');
        if (stockRaw && (!Number.isInteger(stock) || stock! < 0)) errors.push('Stock must be a whole number');
        const veg = get('veg').toLowerCase();
        const schedule = get('schedule').toUpperCase() || undefined;
        const data = {
          name,
          price: price ?? 0,
          mrp,
          description: get('description') || null,
          unit: normaliseUnit(get('unit')),
          sku: get('sku') || null,
          barcode: get('barcode') || null,
          taxRatePct: get('tax') ? Number(get('tax')) : undefined,
          isVeg: store.vertical === 'EAT' && veg ? !/non|egg|n$|^no/.test(veg) : undefined,
          prescriptionRequired: store.vertical === 'PHARMACY' || store.vertical === 'DIAGNOSTICS' ? /^(y|yes|true|1)$/i.test(get('rx')) : undefined,
          drugSchedule: store.vertical === 'PHARMACY' && schedule ? schedule : undefined,
          saltComposition: store.vertical === 'PHARMACY' ? get('salt') || null : undefined,
          ...(store.vertical === 'DIAGNOSTICS' ? labColumns(get) : {}),
          stock: stock !== null && Number.isInteger(stock) ? { trackStock: true, stockQty: stock } : undefined,
        };
        const parsed = productCreateSchema.safeParse(data);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            const field = String(issue.path[0] ?? '');
            if (field === 'price' && price === null) continue; // already reported above
            if (field === 'mrp' && mrp === null && get('mrp')) continue;
            errors.push(field ? `${field}: ${issue.message}` : issue.message);
          }
        }
        if (data.drugSchedule === 'X') errors.push('Schedule X medicines cannot be sold');
        const key = (data.sku ?? name).toLowerCase();
        if (key && seen.has(key)) errors.push('Duplicate row in this file');
        seen.add(key);

        const matchId = data.sku ? bySku.get(data.sku.toLowerCase()) : byName.get(name.toLowerCase());
        const action: PreviewRow['action'] = errors.length ? 'ERROR' : matchId && updateExisting ? 'UPDATE' : 'CREATE';
        return { row, action, name: name || '(no name)', price, category: get('category') || null, stock, errors, data: errors.length ? undefined : (parsed.success ? (parsed.data as Record<string, unknown>) : undefined), matchId: action === 'UPDATE' ? matchId : undefined };
      });

    if (table.length - 1 > MAX_ROWS) problems.push(`Only the first ${MAX_ROWS} rows are imported at a time`);
    return {
      rows: rows.map(({ data: _d, matchId: _m, ...r }) => r),
      valid: rows.filter((r) => r.action !== 'ERROR').length,
      errors: rows.filter((r) => r.action === 'ERROR').length,
      creates: rows.filter((r) => r.action === 'CREATE').length,
      updates: rows.filter((r) => r.action === 'UPDATE').length,
      problems,
      _rows: rows,
    };
  }

  /** Imports every valid row; invalid rows are skipped and reported back. */
  async run(storeId: string, csv: string, updateExisting: boolean, actor: Actor) {
    const preview = await this.preview(storeId, csv, updateExisting);
    if (!('_rows' in preview) || !preview._rows) return { created: 0, updated: 0, skipped: 0, problems: preview.problems };

    const categoryIds = new Map<string, string>();
    const { categories } = await this.catalog.categories(storeId);
    for (const c of categories) categoryIds.set(c.name.toLowerCase(), c.id);

    let created = 0;
    let updated = 0;
    const failed: { row: number; error: string }[] = [];
    for (const r of preview._rows) {
      if (r.action === 'ERROR' || !r.data) continue;
      try {
        let categoryId: string | undefined;
        if (r.category) {
          categoryId = categoryIds.get(r.category.toLowerCase());
          if (!categoryId) {
            const c = await this.catalog.createCategory(storeId, { name: r.category }, actor);
            categoryId = c.id;
            categoryIds.set(r.category.toLowerCase(), c.id);
          }
        }
        const payload = { ...r.data, ...(categoryId ? { categoryId } : {}) } as Parameters<CatalogService['create']>[1];
        if (r.action === 'UPDATE' && r.matchId) {
          await this.catalog.update(storeId, r.matchId, payload, actor);
          updated++;
        } else {
          await this.catalog.create(storeId, payload, actor);
          created++;
        }
      } catch (err) {
        failed.push({ row: r.row, error: (err as Error).message });
      }
    }
    return { created, updated, skipped: preview.errors + failed.length, failed, problems: preview.problems };
  }
}

function rupeesToPaise(v: string): number | null {
  const n = Number(v.replace(/[₹,\s]/g, ''));
  return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function normaliseUnit(v: string) {
  const u = v.toLowerCase();
  const map: Record<string, string> = { pc: 'piece', pcs: 'piece', piece: 'piece', plate: 'plate', kg: 'kg', g: 'g', gm: 'g', l: 'litre', ltr: 'litre', litre: 'litre', ml: 'ml', pack: 'pack', pkt: 'pack', dozen: 'dozen', strip: 'strip', bottle: 'bottle', box: 'box' };
  return (map[u] ?? undefined) as 'piece' | undefined;
}

/** RFC 4180-ish parser: quoted fields, escaped quotes, commas/newlines inside quotes, BOM, CRLF, tabs (pasted from sheets). */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const YES = /^(y|yes|true|1)$/i;
const NO = /^(n|no|false|0)$/i;
/** Lab-test columns → product fields (blank cells are left unset). */
function labColumns(get: (k: string) => string) {
  const num = (v: string) => (v === '' ? undefined : Number(v));
  const bool = (v: string) => (YES.test(v) ? true : NO.test(v) ? false : undefined);
  const sample = get('sample').toUpperCase();
  return {
    labSampleType: sample ? (sample as 'BLOOD') : undefined,
    labFastingHours: num(get('fasting')),
    labReportHours: num(get('report')),
    labHomeCollection: bool(get('home')) ?? true,
    labWalkIn: bool(get('walkin')) ?? true,
    labParameters: num(get('parameters')),
  };
}
