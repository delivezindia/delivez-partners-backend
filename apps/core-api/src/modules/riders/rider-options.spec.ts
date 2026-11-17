import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ageOn, isLicenceNo, isPlate, normalizeLicence, normalizePlate, requiredDocuments, STEPS } from './rider-options';

const future = `${new Date().getUTCFullYear() + 3}-06-30`;
const errs = (step: keyof typeof STEPS, body: unknown): Record<string, string[] | undefined> => {
  const r = STEPS[step].schema.safeParse(body);
  return r.success ? {} : r.error.flatten().fieldErrors;
};
const ok = (step: keyof typeof STEPS, body: unknown) => {
  const r = STEPS[step].schema.safeParse(body);
  assert.ok(r.success, JSON.stringify(r.success ? '' : r.error.flatten()));
  return r.data as Record<string, unknown>;
};

describe('rider sign-up rules', () => {
  it('age is counted on the birthday, not the year', () => {
    assert.equal(ageOn('2008-06-15', '2026-06-14'), 17);
    assert.equal(ageOn('2008-06-15', '2026-06-15'), 18);
  });

  it('personal info: name, 18+, pincode, optional email', () => {
    const d = ok('personal-info', { fullName: '  Ravi   Kumar ', dob: '1995-01-20', pincode: '560034' });
    assert.equal(d.fullName, 'Ravi Kumar');
    const e = errs('personal-info', { fullName: '1', dob: `${new Date().getUTCFullYear() - 16}-01-01`, pincode: '012345', email: 'nope' });
    assert.deepEqual(Object.keys(e).sort(), ['dob', 'email', 'fullName', 'pincode']);
  });

  it('number plates and licence numbers are cleaned up and checked', () => {
    assert.equal(normalizePlate('ka 51 ab-1234'), 'KA51AB1234');
    assert.ok(isPlate('KA51AB1234') && isPlate('22BH1234AA') && !isPlate('KA51'));
    assert.equal(normalizeLicence('KA01 2019-0001234'), 'KA0120190001234');
    assert.ok(isLicenceNo('KA0120190001234') && !isLicenceNo('12345'));
  });

  it('a motorbike needs a two-wheeler licence, plate, expiry in the future and the declaration', () => {
    const base = { idType: 'AADHAAR', idLast4: '1234', vehicleType: 'BIKE', vehicleOwnership: 'OWNED', vehicleCondition: 'GOOD' };
    assert.deepEqual(Object.keys(errs('legal-vehicle', base)).sort(), ['licenceDeclaration', 'licenceExpiry', 'licenceNumber', 'licenceType', 'vehicleRegistration']);
    const wrongClass = errs('legal-vehicle', { ...base, vehicleRegistration: 'KA 51 AB 1234', licenceType: 'LMV', licenceNumber: 'KA0120190001234', licenceExpiry: future, licenceDeclaration: true });
    assert.match(String(wrongClass.licenceType), /does not cover/);
    const expired = errs('legal-vehicle', { ...base, vehicleRegistration: 'KA 51 AB 1234', licenceType: 'MCWG', licenceNumber: 'KA0120190001234', licenceExpiry: '2020-01-01', licenceDeclaration: true });
    assert.match(String(expired.licenceExpiry), /expired/);
    const d = ok('legal-vehicle', { ...base, vehicleRegistration: 'ka 51 ab 1234', licenceType: 'MCWG', licenceNumber: 'ka01 2019 0001234', licenceExpiry: future, licenceDeclaration: true });
    assert.equal(d.vehicleRegistration, 'KA51AB1234');
  });

  it('a bicycle needs no licence, and stale licence fields are dropped', () => {
    const d = ok('legal-vehicle', { idType: 'PAN', idLast4: 'ab1c', vehicleType: 'BICYCLE', vehicleOwnership: 'OWNED', vehicleCondition: 'FAIR', licenceType: 'MCWG', licenceNumber: 'X' });
    assert.equal(d.licenceType, null);
    assert.equal(d.licenceNumber, null);
    assert.equal(d.idLast4, 'AB1C');
    assert.deepEqual(requiredDocuments('BICYCLE'), ['PHOTO', 'BANK_PROOF']);
    assert.equal(requiredDocuments('BIKE').length, 5);
  });

  it('every training module and every declaration must be accepted', () => {
    const all = ['DELIVERY_SOP', 'PICKUP_SOP', 'NAVIGATION_APP', 'CUSTOMER_CONDUCT', 'ROAD_SAFETY'];
    assert.ok(errs('training-role', { completedModules: all.slice(1), trainingNeeds: ['NONE'] }).completedModules);
    assert.ok(errs('training-role', { completedModules: all, trainingNeeds: ['NONE', 'APP'] }).trainingNeeds);
    ok('training-role', { completedModules: all, trainingNeeds: ['APP', 'CASH'] });
    assert.ok(errs('hyperlocal', { jobTypes: [] }).jobTypes);
    const safety = { HELMET_SPEED: true, PHONE_MOUNTED: true, CONDUCT: true, REPORT_INCIDENTS: true, NO_INTOXICATION: true };
    const stat = { VALID_LICENCE: true, VEHICLE_PAPERS: true, POLICE_VERIFICATION: true, ACCURATE_INFO: true };
    assert.ok(errs('safety-compliance', { safetyDeclarations: { ...safety, CONDUCT: false }, statutoryDeclarations: stat }).safetyDeclarations);
    const d = ok('safety-compliance', { safetyDeclarations: { ...safety, EXTRA: true }, statutoryDeclarations: stat });
    assert.deepEqual(Object.keys(d.safetyDeclarations as object).length, 5);
  });
});
