const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, collection, getDocs, writeBatch } = require('firebase/firestore');

let env;
let student;
let admin;
let outsider;
function order(overrides = {}) {
  return {
    token: 'C12345', userId: 'student', status: 'Placed', total: 80,
    customerInfo: 'Synthetic student', createdAt: Date.now(),
    items: [{ id: '1', name: 'Veg Roll', price: 40, qty: 2 }],
    orderLocation: { latitude: 22.572927, longitude: 88.437494,
      accuracyMeters: 20, distanceFromCanteenMeters: 0 },
    clientLocationCheck: { passed: true, radiusMeters: 200, checkedAt: Date.now() },
    ...overrides,
  };
}
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-smart-canteen',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  student = env.authenticatedContext('student').firestore();
  admin = env.authenticatedContext('operator', { admin: true }).firestore();
  outsider = env.authenticatedContext('other', { email: 'not-an-admin@example.test' }).firestore();
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (let i = 1; i <= 10; i++) {
      await setDoc(doc(db, 'menu', String(i)), { name: i === 1 ? 'Veg Roll' : `Item ${i}`,
        price: 40, available: i !== 6 });
    }
  });
});

test('authenticated student can create a correctly priced owned order and read its document', async () => {
  await assertSucceeds(setDoc(doc(student, 'orders', 'valid'), order()));
  const snap = await assertSucceeds(getDoc(doc(student, 'orders', 'valid')));
  assert.equal(snap.data().total, 80);
  await assertFails(getDoc(doc(outsider, 'orders', 'valid')));
  await assertSucceeds(getDoc(doc(admin, 'orders', 'valid')));
});

test('anonymous request, impersonated UID, pre-completed status and extra fields are denied', async () => {
  const unauthenticated = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(unauthenticated, 'orders', 'no-auth'), order()));
  for (const overrides of [{ userId: 'other' }, { status: 'Ready' }, { admin: true }]) {
    await assertFails(setDoc(doc(student, 'orders', 'invalid'), order(overrides)));
  }
});

test('forged prices, totals, names, quantities, unavailable and missing items are denied', async () => {
  for (const overrides of [
    { total: 1 },
    { items: [{ id: '1', name: 'Veg Roll', price: 1, qty: 2 }], total: 2 },
    { items: [{ id: '1', name: 'Fake', price: 40, qty: 2 }] },
    { items: [{ id: '1', name: 'Veg Roll', price: 40, qty: 0 }], total: 0 },
    { items: [{ id: '1', name: 'Veg Roll', price: 40, qty: 21 }], total: 840 },
    { items: [{ id: '1', name: 'Veg Roll', price: 40, qty: 1.5 }], total: 60 },
    { items: [{ id: '6', name: 'Item 6', price: 40, qty: 2 }] },
    { items: [{ id: 'absent', name: 'Missing', price: 40, qty: 2 }] },
    { items: [], total: 0 },
  ]) {
    await assertFails(setDoc(doc(student, 'orders', 'invalid'), order(overrides)));
  }
});

test('each line is checked and totals include all lines, up to the ten-document budget', async () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: String(i + 1), name: i === 0 ? 'Veg Roll' : `Item ${i + 1}`, price: 40, qty: 1,
  }));
  await assertSucceeds(updateDoc(doc(admin, 'menu', '6'), { available: true }));
  await assertSucceeds(setDoc(doc(student, 'orders', 'ten-items'), order({ items, total: 400 })));
  for (let i = 0; i < items.length; i++) {
    const forged = items.map((item, index) => index === i ? { ...item, price: 1 } : item);
    await assertFails(setDoc(doc(student, 'orders', `forged-${i}`), order({ items: forged, total: 361 })));
  }
  await assertFails(setDoc(doc(student, 'orders', 'wrong-sum'), order({ items, total: 399 })));
  await assertFails(setDoc(doc(student, 'orders', 'eleven-items'), order({ items: [...items, items[0]], total: 440 })));
});

test('location assertion must be present, true and consistent with the 200 m radius', async () => {
  for (const check of [{}, { passed: false, radiusMeters: 200, checkedAt: Date.now() },
    { passed: true, radiusMeters: 5000, checkedAt: Date.now() }]) {
    await assertFails(setDoc(doc(student, 'orders', 'location'), order({ clientLocationCheck: check })));
  }
  for (const accuracyMeters of [201, -1]) {
    await assertFails(setDoc(doc(student, 'orders', 'location'), order({
      orderLocation: { ...order().orderLocation, accuracyMeters },
    })));
  }
  await assertSucceeds(setDoc(doc(student, 'orders', 'accuracy-boundary'), order({
    orderLocation: { ...order().orderLocation, accuracyMeters: 200 },
  })));
});

test('only admins may advance status; order prices and ownership remain immutable', async () => {
  await setDoc(doc(student, 'orders', 'status'), order());
  await assertFails(updateDoc(doc(student, 'orders', 'status'), { status: 'Preparing' }));
  await assertFails(updateDoc(doc(outsider, 'orders', 'status'), { status: 'Preparing' }));
  await assertFails(updateDoc(doc(admin, 'orders', 'status'), { status: 'Collected' }));
  await assertSucceeds(updateDoc(doc(admin, 'orders', 'status'), { status: 'Preparing' }));
  await assertFails(updateDoc(doc(admin, 'orders', 'status'), { total: 1 }));
});

test('seating is readable by students, and only trusted admins may write bounded counts', async () => {
  await assertFails(setDoc(doc(student, 'settings', 'seating'), { count: 23 }));
  await assertFails(setDoc(doc(outsider, 'settings', 'seating'), { count: 23 }));
  await assertSucceeds(setDoc(doc(admin, 'settings', 'seating'), { count: 23 }));
  assert.equal((await assertSucceeds(getDoc(doc(student, 'settings', 'seating')))).data().count, 23);
  for (const data of [{ count: -1 }, { count: 101 }, { count: 2.5 }, { count: 12, extra: true }]) {
    await assertFails(setDoc(doc(admin, 'settings', 'seating'), data));
  }
});

test('full menu seed is allowed for admins and denied atomically for students', async () => {
  for (const [db, allowed] of [[admin, true], [student, false]]) {
    const batch = writeBatch(db);
    for (let i = 1; i <= 6; i++) {
      batch.set(doc(db, 'menu', `new-${i}`), { name: `New ${i}`, price: 20, available: true });
    }
    await (allowed ? assertSucceeds(batch.commit()) : assertFails(batch.commit()));
  }
  assert.equal((await assertSucceeds(getDocs(collection(student, 'menu')))).size, 16);
});
