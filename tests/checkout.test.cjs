const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the actual frontend with synthetic Firebase and browser boundaries.
// No requests reach Firebase and no real orders or users are created.
const source = fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8')
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];/gm, '');

function checkout({ writeError, storageError, locationError, writeGate } = {}) {
  const saved = [];
  const alerts = [];
  const listeners = [];
  const storage = new Map();
  const root = { innerHTML: '' };
  const modal = { removed: false, remove() { this.removed = true; } };
  const button = { disabled: false, closest: () => modal };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    window: {},
    firebaseConfig: {},
    initializeApp: () => ({}),
    getAuth: () => ({}),
    getFirestore: () => ({}),
    onAuthStateChanged() {},
    collection: (_db, path) => ({ path }),
    query: ref => ref,
    orderBy: () => ({}),
    limit: () => ({}),
    doc: (...args) => args.length === 1
      ? { path: 'orders', id: 'synthetic-order-123' }
      : { path: args[1], id: args[2] },
    async setDoc(ref, order) {
      if (writeGate) await writeGate;
      if (writeError) throw new Error('Permission denied');
      saved.push({ ref, order });
    },
    onSnapshot(ref, callback) {
      const listener = { ref, callback, stopped: false };
      listeners.push(listener);
      return () => { listener.stopped = true; };
    },
    localStorage: {
      setItem(key, value) {
        if (storageError) throw new Error('Storage unavailable');
        storage.set(key, value);
      },
      getItem(key) {
        if (storageError) throw new Error('Storage unavailable');
        return storage.get(key) ?? null;
      },
    },
    navigator: {
      geolocation: {
        getCurrentPosition(success, failure) {
          if (locationError) return failure({ code: 1 });
          success({ coords: { latitude: 22.572927, longitude: 88.437494, accuracy: 10 } });
        },
      },
    },
    document: {
      querySelector: selector => selector === '.modal .btn' ? button : null,
      getElementById: id => id === 'app' ? root : id === 'customerInfo' ? { value: 'Test student' } : null,
      querySelectorAll: () => [],
    },
    alert: message => alerts.push(message),
  });
  vm.runInContext(source, context);
  vm.runInContext('uid = "synthetic-student"; menu = fallbackMenu.map(item => ({...item})); cart = [{...menu[0], qty: 2}];', context);
  return { context, saved, alerts, listeners, storage, root, modal, button,
    run: () => vm.runInContext('placeOrder()', context),
    cartLength: () => vm.runInContext('cart.length', context) };
}

test('saved order displays its token, closes cart, and tracks its document', async () => {
  const app = checkout();
  await app.run();
  assert.equal(app.saved.length, 1);
  assert.equal(app.saved[0].order.total, 80);
  assert.equal(app.saved[0].order.userId, 'synthetic-student');
  assert.match(app.root.innerHTML, /Order confirmed/);
  assert.ok(app.root.innerHTML.includes(`#${app.saved[0].order.token}`));
  assert.equal(app.modal.removed, true);
  assert.equal(app.cartLength(), 0);
  assert.equal(app.alerts.length, 0);
  assert.equal(app.button.disabled, false);
  assert.equal(app.storage.get('smartCanteenOrderId'), 'synthetic-order-123');
  assert.equal(JSON.parse(app.storage.get('lastOrders'))[0].id, 'synthetic-order-123');
  assert.equal(app.listeners[0].ref.path, 'orders');
  assert.equal(app.listeners[0].ref.id, 'synthetic-order-123');
});

test('blocked browser storage does not hide a successfully saved token', async () => {
  const app = checkout({ storageError: true });
  await app.run();
  assert.equal(app.saved.length, 1);
  assert.match(app.root.innerHTML, /Order confirmed/);
  assert.equal(app.modal.removed, true);
  assert.equal(app.cartLength(), 0);
  assert.equal(app.alerts.length, 0);
  vm.runInContext('showStudent()', app.context);
  assert.match(app.root.innerHTML, /Today.s Menu/);
});

test('corrupt or non-array order history does not break the student menu', () => {
  const app = checkout();
  for (const value of ['{broken', '{}', 'null']) {
    app.storage.set('lastOrders', value);
    vm.runInContext('showStudent()', app.context);
    assert.match(app.root.innerHTML, /Today.s Menu/);
  }
});

test('failed Firebase write preserves cart and permits retry', async () => {
  const app = checkout({ writeError: true });
  await app.run();
  assert.equal(app.saved.length, 0);
  assert.equal(app.modal.removed, false);
  assert.equal(app.cartLength(), 1);
  assert.match(app.alerts[0], /Permission denied/);
  assert.equal(app.button.disabled, false);
  assert.doesNotMatch(app.root.innerHTML, /Order confirmed/);
  await app.run();
  assert.equal(app.alerts.length, 2);
});

test('denied location prevents order creation and preserves cart', async () => {
  const app = checkout({ locationError: true });
  await app.run();
  assert.equal(app.saved.length, 0);
  assert.equal(app.cartLength(), 1);
  assert.equal(app.modal.removed, false);
  assert.match(app.alerts[0], /Location permission denied/);
  assert.equal(app.button.disabled, false);
});

test('repeated confirmation while saving creates only one order', async () => {
  let release;
  const writeGate = new Promise(resolve => { release = resolve; });
  const app = checkout({ writeGate });
  const first = app.run();
  await app.run();
  assert.equal(app.button.disabled, true);
  release();
  await first;
  assert.equal(app.saved.length, 1);
  assert.equal(app.button.disabled, false);
});

test('document updates advance the token timeline and replace old subscriptions', async () => {
  const app = checkout();
  await app.run();
  const steps = Array.from({ length: 4 }, () => ({
    active: false,
    classList: { toggle(_name, value) { this.owner.active = value; } },
  }));
  steps.forEach(step => { step.classList.owner = step; });
  app.context.document.querySelector = () => ({});
  app.context.document.querySelectorAll = () => steps;
  app.listeners[0].callback({ exists: () => true, data: () => ({ status: 'Ready' }) });
  assert.deepEqual(steps.map(step => step.active), [true, true, true, false]);
  app.listeners[0].callback({ exists: () => false });
  vm.runInContext('listenToOrder("second-order")', app.context);
  assert.equal(app.listeners[0].stopped, true);
  assert.equal(app.listeners[1].ref.id, 'second-order');
});

test('order and menu content is escaped and action values stay out of JavaScript', () => {
  const app = checkout();
  const payload = `<img src=x onerror="alert('test')">`;
  const orderId = `');alert('test');//`;
  app.context.payload = payload;
  app.context.orderId = orderId;
  const actions = [];
  const ordersRoot = {
    innerHTML: '',
    querySelectorAll: () => [{
      dataset: { orderId, orderStatus: 'Placed' },
      addEventListener: (_event, handler) => actions.push(handler),
    }],
  };
  app.context.document.getElementById = id => id === 'orders' ? ordersRoot : app.root;
  const updates = [];
  app.context.updateDoc = (ref, data) => { updates.push({ ref, data }); };
  vm.runInContext('listenAdmin()', app.context);
  app.listeners[0].callback({ empty: false, docs: [{
    id: orderId,
    data: () => ({ token: payload, total: payload, status: 'Placed', customerInfo: payload }),
  }] });
  assert.doesNotMatch(ordersRoot.innerHTML, /<img/);
  assert.match(ordersRoot.innerHTML, /&lt;img/);
  assert.doesNotMatch(ordersRoot.innerHTML, /onclick/);
  assert.equal(actions.length, 1);
  actions[0]();
  assert.equal(updates[0].ref.id, orderId);
  assert.equal(updates[0].data.status, 'Preparing');
  vm.runInContext('menu[0].name = payload; menu[0].desc = payload; menu[0].id = orderId; showStudent()', app.context);
  assert.doesNotMatch(app.root.innerHTML, /<img/);
  assert.match(app.root.innerHTML, /&lt;img/);
  assert.doesNotMatch(app.root.innerHTML, /onclick="add/);
  vm.runInContext('showOrder({id: orderId, token: payload, total: 80})', app.context);
  assert.doesNotMatch(app.root.innerHTML, /<img/);
  assert.match(app.root.innerHTML, /&lt;img/);
});
