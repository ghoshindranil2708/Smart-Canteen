import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";

import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  doc,
  setDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";


/* =========================================================
   FIREBASE
========================================================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


/* =========================================================
   APP STATE
========================================================= */

let uid = null;
let cart = [];
let menu = [];
let seatCount = 18;

let unsubscribeOrders = null;
let adminOrdersUnsubscribe = null;
let locationWatchId = null;
let orderSubmissionPending = false;

const CANTEEN_LOCATION = {
  latitude: 22.572927,
  longitude: 88.437494,
  radiusMeters: 200,
  name: "Salt Lake Sector-V Metro Station"
};

let locationState = {
  ready: false,
  inside: false,
  distance: null,
  accuracy: null,
  lat: null,
  lng: null,
  error: null
};


/* =========================================================
   FALLBACK MENU
========================================================= */

const fallbackMenu = [
  {
    id: "1",
    name: "Veg Roll",
    price: 40,
    emoji: "🌯",
    desc: "Fresh vegetable roll",
    available: true
  },
  {
    id: "2",
    name: "Chowmein",
    price: 60,
    emoji: "🍜",
    desc: "Hot wok-tossed noodles",
    available: true
  },
  {
    id: "3",
    name: "Fried Rice",
    price: 70,
    emoji: "🍚",
    desc: "Vegetable fried rice",
    available: true
  },
  {
    id: "4",
    name: "Chicken Roll",
    price: 60,
    emoji: "🌯",
    desc: "Chicken roll",
    available: true
  },
  {
    id: "5",
    name: "Sandwich",
    price: 50,
    emoji: "🥪",
    desc: "Fresh sandwich",
    available: true
  },
  {
    id: "6",
    name: "Cold Coffee",
    price: 50,
    emoji: "🥤",
    desc: "Chilled coffee",
    available: false
  }
];


/* =========================================================
   AUTHENTICATION
========================================================= */

/*
   IMPORTANT:

   We DO NOT call signInAnonymously() immediately.

   Firebase first checks whether there is already a
   logged-in user.

   If there is an email -> Admin
   If there is no email -> Student
*/

onAuthStateChanged(auth, async (user) => {

  if (user) {

    uid = user.uid;

    console.log(
      "Firebase user:",
      user.email || "Anonymous Student"
    );

    await loadMenu();
    startLocationTracking();

    /*
       Email/password account = Admin
       Anonymous account = Student
    */

    if (user.email) {
      showAdminDashboard();
    } else {
      showStudent();
    }

    return;
  }


  /*
     No user currently logged in.

     Automatically create anonymous student session.
  */

  try {

    console.log(
      "No user found. Creating student session..."
    );

    await signInAnonymously(auth);

  } catch (error) {

    console.error(
      "Anonymous authentication failed:",
      error
    );

    renderBase(`
      <div class="card">
        <h2>⚠️ Authentication Error</h2>

        <p>
          Unable to connect to Firebase Authentication.
        </p>

        <p>
          Please check your Firebase Authentication settings.
        </p>
      </div>
    `);

  }

});


/* =========================================================
   LOCATION / GEOFENCE
========================================================= */

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function locationErrorMessage(error) {
  if (!error) return "Location unavailable.";
  if (error.code === 1) return "Location permission denied. Please allow location access.";
  if (error.code === 2) return "Your location could not be determined.";
  if (error.code === 3) return "Location request timed out. Please try again.";
  return "Unable to access your location.";
}

function updateLocationFromPosition(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const distance = distanceMeters(
    latitude,
    longitude,
    CANTEEN_LOCATION.latitude,
    CANTEEN_LOCATION.longitude
  );

  locationState = {
    ready: true,
    inside: distance <= CANTEEN_LOCATION.radiusMeters,
    distance,
    accuracy,
    lat: latitude,
    lng: longitude,
    error: null
  };

  updateLocationUI();
}

function startLocationTracking() {
  if (!navigator.geolocation) {
    locationState.error = "Geolocation is not supported by this browser.";
    updateLocationUI();
    return;
  }

  if (locationWatchId !== null) return;

  locationWatchId = navigator.geolocation.watchPosition(
    updateLocationFromPosition,
    (error) => {
      locationState.ready = false;
      locationState.error = locationErrorMessage(error);
      updateLocationUI();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

function locationCard() {
  if (!locationState.ready) {
    return `
      <div class="notice" id="locationStatus" style="margin-bottom:20px;">
        📍 <b>${locationState.error || "Checking your location..."}</b>
        <br>
        <small>Allow location permission so ordering can be enabled.</small>
        ${locationState.error ? `<br><br><button class="ghost" onclick="retryLocation()">📍 Try again</button>` : ""}
      </div>
    `;
  }

  if (locationState.inside) {
    return `
      <div class="notice" id="locationStatus" style="margin-bottom:20px;">
        📍 <b>Ordering enabled</b> — You are inside the 200 m ordering zone.
        <br>
        <small>Distance: ${Math.round(locationState.distance)} m from ${CANTEEN_LOCATION.name}.</small>
      </div>
    `;
  }

  return `
    <div class="notice" id="locationStatus" style="margin-bottom:20px;">
      🚫 <b>Ordering disabled</b> — You are outside the 200 m ordering zone.
      <br>
      <small>Distance: ${Math.round(locationState.distance)} m. Move within 200 m of ${CANTEEN_LOCATION.name} to order.</small>
      <br><br>
      <button class="ghost" onclick="retryLocation()">📍 Check my location again</button>
    </div>
  `;
}

function updateLocationUI() {
  const status = document.getElementById("locationStatus");
  if (!status) return;

  status.outerHTML = locationCard();

  document.querySelectorAll("button[data-add-id]").forEach((button) => {
    const id = button.dataset.addId;
    const item = menu.find((m) => m.id === id);

    if (!item) return;

    const allowed = item.available && locationState.inside;
    button.disabled = !allowed;
    button.classList.toggle("disabled", !allowed);
    button.textContent = !item.available
      ? "Unavailable"
      : locationState.inside
        ? "Add to cart"
        : "Outside zone";
  });
}

window.retryLocation = function () {
  locationState.error = null;
  locationState.ready = false;
  updateLocationUI();

  if (!navigator.geolocation) {
    locationState.error = "Geolocation is not supported by this browser.";
    updateLocationUI();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    updateLocationFromPosition,
    (error) => {
      locationState.error = locationErrorMessage(error);
      updateLocationUI();
      alert(locationState.error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000
    }
  );
};

function getFreshLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported by this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => reject(new Error(locationErrorMessage(error))),
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
      }
    );
  });
}

/* =========================================================
   GENERAL FUNCTIONS
========================================================= */

async function loadMenu() {

  try {

    const snap =
      await getDocs(
        collection(db, "menu")
      );

    if (snap.empty) {

      menu = fallbackMenu;

    } else {

      menu =
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data()
        }));

    }

  } catch (error) {

    console.error(
      "Menu loading error:",
      error
    );

    menu = fallbackMenu;

  }

}


function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

function total() {

  return cart.reduce(
    (sum, item) =>
      sum + item.price * item.qty,
    0
  );

}


function renderBase(content) {

  const appElement =
    document.getElementById("app");

  if (!appElement) {

    console.error(
      "Element #app not found."
    );

    return;

  }

  appElement.innerHTML = `
    <div class="wrap">
      ${content}
    </div>
  `;

}


/* =========================================================
   GLOBAL FUNCTIONS
========================================================= */

window.showStudent = showStudent;
window.showAdmin = showAdmin;
window.loginAdmin = loginAdmin;
window.logoutAdmin = logoutAdmin;
window.nextStatus = nextStatus;
window.changeSeats = changeSeats;
window.toggleMenu = toggleMenu;
window.add = add;
window.openCart = openCart;
window.placeOrder = placeOrder;


/* =========================================================
   STUDENT PAGE
========================================================= */

function readRecentOrders() {
  try {
    const orders = JSON.parse(localStorage.getItem("lastOrders") || "[]");
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

function showStudent() {

  const orders = readRecentOrders();


  renderBase(`

    <section class="hero">

      <h1>
        Eat smarter. Wait less.
      </h1>

      <p>
        Order before reaching the counter
        and collect using your digital token.
      </p>


      <div class="stats">

        <div class="stat">

          🪑 Seats available

          <b id="seatCount">
            ${seatCount}
          </b>

        </div>


        <div class="stat">

          🎫 Your recent orders

          <b>
            ${orders.length}
          </b>

        </div>


        <div class="stat">

          ⏱️ Est. wait

          <b>
            5–10 min
          </b>

        </div>

      </div>

    </section>

    ${locationCard()}

    <h2>
      Today's Menu
    </h2>


    <div class="grid">

      ${menu.map((m) => `

        <div class="card">

          <div class="emoji">
            ${escapeHtml(m.emoji)}
          </div>

          <h3>
            ${escapeHtml(m.name)}
          </h3>

          <span class="pill ${m.available ? "ok" : "no"}">

            ${
              m.available
                ? "Available"
                : "Sold out"
            }

          </span>

          <p>
            ${escapeHtml(m.desc)}
          </p>

          <b>
            ₹${escapeHtml(m.price)}
          </b>


          <button
            class="btn"
            ${m.available ? "" : "disabled"}
            data-add-id="${escapeHtml(m.id)}"
          >

            ${
              m.available
                ? "Add to cart"
                : "Unavailable"
            }

          </button>

        </div>

      `).join("")}

    </div>


    <h2>
      🪑 Seating
    </h2>


    <div class="seat">

      <b>
        ${seatCount}
        seats currently available
      </b>

      <br>

      <small>
        Ask the canteen operator to update
        the live count.
      </small>

    </div>


    ${
      cart.length
        ? `

        <button
          class="btn"
          style="
            position:fixed;
            right:20px;
            bottom:20px;
            width:auto;
            padding:15px 20px;
          "
          onclick="openCart()"
        >

          🛒
          ${cart.length}
          item(s)
          ·
          ₹${total()}

        </button>

        `
        : ""
    }


    <div
      style="
        margin-top:30px;
        text-align:center;
      "
    >

      <button
        class="ghost"
        onclick="showAdmin()"
      >

        🔐 Admin Login

      </button>

    </div>

  `);

  document.querySelectorAll("button[data-add-id]").forEach(button => {
    button.addEventListener("click", () => add(button.dataset.addId));
  });

}


/* =========================================================
   ADD TO CART
========================================================= */

function add(id) {

  if (!locationState.inside) {
    alert(
      "Ordering is available only within 200 metres of " +
      CANTEEN_LOCATION.name + "."
    );
    return;
  }

  const item =
    menu.find(
      (x) => x.id === id
    );

  if (!item || !item.available) {
    return;
  }


  const existing =
    cart.find(
      (x) => x.id === id
    );


  if (existing) {

    existing.qty++;

  } else {

    cart.push({
      ...item,
      qty: 1
    });

  }


  showStudent();

}


/* =========================================================
   CART
========================================================= */

function openCart() {

  document.body.insertAdjacentHTML(
    "beforeend",

    `

    <div
      class="modal"
      onclick="
        if(event.target===this)
          this.remove()
      "
    >

      <div class="panel">

        <button
          class="close"
          onclick="
            this.closest('.modal').remove()
          "
        >
          ✕
        </button>


        <h2>
          Your Order
        </h2>


        ${cart.map((x) => `

          <div class="row">

            <span>
              ${escapeHtml(x.emoji)}
              ${escapeHtml(x.name)}
              ×
              ${escapeHtml(x.qty)}
            </span>

            <b>
              ₹${x.price * x.qty}
            </b>

          </div>

        `).join("")}


        <h3>
          Total ₹${total()}
        </h3>


        <label>
          Pickup name / class
        </label>


        <input
          class="input"
          id="customerInfo"
          placeholder="e.g. Indranil, CSE 1st Year"
        >


        <button
          class="btn"
          onclick="placeOrder()"
        >
          Confirm Order
        </button>

      </div>

    </div>

    `
  );

}


/* =========================================================
   PLACE ORDER
========================================================= */

async function placeOrder() {

  const button =
    document.querySelector(
      ".modal .btn"
    );

  if (!button || orderSubmissionPending) {
    return;
  }

  const modal = button.closest(".modal");
  orderSubmissionPending = true;
  button.disabled = true;

  try {

    if (!uid) {
      throw new Error("User is not authenticated.");
    }

    if (!cart || cart.length === 0) {
      throw new Error("Your cart is empty.");
    }

    // Perform a fresh GPS check immediately before placing the order.
    const position = await getFreshLocation();
    const {
      latitude,
      longitude,
      accuracy
    } = position.coords;

    const distance =
      distanceMeters(
        latitude,
        longitude,
        CANTEEN_LOCATION.latitude,
        CANTEEN_LOCATION.longitude
      );

    // Spark-plan version:
    // location is checked in the browser before the Firestore write.
    if (
      distance >
      CANTEEN_LOCATION.radiusMeters
    ) {

      throw new Error(
        `Order blocked. You are about ${Math.round(distance)} m from ${CANTEEN_LOCATION.name}. You must be within ${CANTEEN_LOCATION.radiusMeters} m to order.`
      );

    }

    if (
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > 5000
    ) {

      throw new Error(
        "Your GPS accuracy is too low. Please try again."
      );

    }

    const customerInput =
      document.getElementById(
        "customerInfo"
      );

    const customerInfo =
      customerInput
        ? String(
            customerInput.value || ""
          )
            .trim()
            .slice(0, 200)
        : "";

    // Re-check menu locally before creating the order.
    const sanitizedItems = [];
    let orderTotal = 0;

    for (const item of cart) {

      const menuItem =
        menu.find(
          (x) =>
            String(x.id) ===
            String(item.id)
        );

      if (!menuItem) {
        throw new Error(
          "One of the selected items is no longer available."
        );
      }

      if (
        menuItem.available !== true
      ) {
        throw new Error(
          `${menuItem.name} is currently sold out.`
        );
      }

      const qty =
        Number(item.qty);

      if (
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 20
      ) {
        throw new Error(
          `Invalid quantity for ${menuItem.name}.`
        );
      }

      const price =
        Number(menuItem.price);

      if (
        !Number.isFinite(price) ||
        price < 0
      ) {
        throw new Error(
          `Invalid price configured for ${menuItem.name}.`
        );
      }

      sanitizedItems.push({
        id: String(menuItem.id),
        name: String(menuItem.name),
        price,
        qty
      });

      orderTotal +=
        price * qty;

    }

    const token =
      "C" +
      String(Date.now()).slice(-5);

    const order = {

      token,

      userId: uid,

      items:
        sanitizedItems,

      total:
        orderTotal,

      status:
        "Placed",

      customerInfo,

      createdAt:
        Date.now(),

      orderLocation: {

        latitude:
          Number(latitude),

        longitude:
          Number(longitude),

        accuracyMeters:
          Number(accuracy),

        distanceFromCanteenMeters:
          Math.round(distance)

      },

      clientLocationCheck: {

        passed: true,

        radiusMeters:
          CANTEEN_LOCATION.radiusMeters,

        checkedAt:
          Date.now()

      }

    };

    const orderRef =
      doc(
        collection(
          db,
          "orders"
        )
      );

    await setDoc(
      orderRef,
      order
    );

    // Browser storage is optional: the order is already saved in Firestore.
    try {
      localStorage.setItem("smartCanteenToken", token);
      localStorage.setItem("smartCanteenOrderId", orderRef.id);
      localStorage.setItem("lastOrders", JSON.stringify([
        ...readRecentOrders(),
        { id: orderRef.id, token }
      ].slice(-20)));
    } catch (error) {
      console.warn("Could not save the order on this device:", error);
    }

    cart = [];

    modal?.remove();

    showOrder({
      id: orderRef.id,
      ...order
    });

    console.log(
      "Order placed successfully:",
      orderRef.id
    );

  } catch (error) {

    console.error(
      "Order placement error:",
      error
    );

    alert(
      error?.message ||
      "Could not place the order. Please try again."
    );

  } finally {

    orderSubmissionPending = false;
    button.disabled = false;

  }

}

/* =========================================================
   ORDER PAGE
========================================================= */

function showOrder(order) {

  renderBase(`

    <div class="card">

      <h2>
        Order confirmed 🎉
      </h2>


      <div class="token">

        Your digital token

        <strong>
          #${escapeHtml(order.token)}
        </strong>

        <div>
          ₹${escapeHtml(order.total)}
        </div>

      </div>


      <div class="notice">

        ⏱️ Estimated preparation time:
        5–10 minutes

      </div>


      <div class="timeline">

        ${
          [
            "Placed",
            "Preparing",
            "Ready",
            "Collected"
          ]
            .map(
              (status, index) => `

                <div
                  class="step ${
                    index === 0
                      ? "on"
                      : ""
                  }"
                >

                  <div class="dot"></div>

                  ${status}

                </div>

              `
            )
            .join("")
        }

      </div>


      <button
        class="btn"
        onclick="showStudent()"
      >
        Back to menu
      </button>

    </div>

  `);


  listenToOrder(
    order.id
  );

}


/* =========================================================
   STUDENT ORDER LISTENER
========================================================= */

function listenToOrder(orderId) {

  if (unsubscribeOrders) {
    unsubscribeOrders();
  }


  // Read only this student's order; collection-wide queries are denied by
  // the owner-only Firestore rules and tokens may be shared by two orders.
  const orderRef = doc(db, "orders", orderId);


  unsubscribeOrders =
    onSnapshot(
      orderRef,

      (snap) => {

        const order = snap.exists() ? snap.data() : null;


        if (
          order &&
          document.querySelector(
            ".token strong"
          )
        ) {

          updateTimeline(
            order.status
          );

        }

      },

      (error) => {

        console.error(
          "Order listener error:",
          error
        );

      }
    );

}


/* =========================================================
   UPDATE TIMELINE
========================================================= */

function updateTimeline(status) {

  const states = [
    "Placed",
    "Preparing",
    "Ready",
    "Collected"
  ];


  const index =
    states.indexOf(status);


  document
    .querySelectorAll(".step")
    .forEach(
      (element, number) => {

        element.classList.toggle(
          "on",
          number <= index
        );

      }
    );

}


/* =========================================================
   ADMIN LOGIN SCREEN
========================================================= */

function showAdmin() {

  renderBase(`

    <div
      class="card"
      style="
        max-width:500px;
        margin:40px auto;
      "
    >

      <h2>
        🔐 Admin Login
      </h2>


      <p>
        Only authorized canteen administrators
        can access the dashboard.
      </p>


      <label>
        Email
      </label>


      <input
        class="input"
        id="adminEmail"
        type="email"
        autocomplete="username"
        placeholder="Enter admin email"
      >


      <br>


      <label>
        Password
      </label>


      <input
        class="input"
        id="adminPassword"
        type="password"
        autocomplete="current-password"
        placeholder="Enter password"
      >


      <br>


      <button
        type="button"
        class="btn"
        id="adminLoginButton"
        onclick="window.loginAdmin()"
      >
        Login
      </button>


      <button
        type="button"
        class="ghost"
        onclick="showStudent()"
        style="
          margin-top:10px;
        "
      >
        ← Back to Student
      </button>


      <p
        id="adminLoginError"
        style="
          color:#c62828;
          margin-top:15px;
        "
      ></p>


    </div>

  `);

}


/* =========================================================
   ADMIN LOGIN
========================================================= */

async function loginAdmin() {

  console.log(
    "Admin login button clicked"
  );


  const emailElement =
    document.getElementById(
      "adminEmail"
    );


  const passwordElement =
    document.getElementById(
      "adminPassword"
    );


  const button =
    document.getElementById(
      "adminLoginButton"
    );


  const errorElement =
    document.getElementById(
      "adminLoginError"
    );


  if (
    !emailElement ||
    !passwordElement
  ) {

    console.error(
      "Login fields not found."
    );

    return;

  }


  const email =
    emailElement.value.trim();


  const password =
    passwordElement.value;


  if (!email || !password) {

    errorElement.textContent =
      "Please enter both email and password.";

    return;

  }


  button.disabled = true;

  button.textContent =
    "Logging in...";

  errorElement.textContent =
    "";


  try {

    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );


    console.log(
      "Admin login successful"
    );


  } catch (error) {

    console.error(
      "Firebase Admin Login Error:",
      error
    );


    let message =
      "Login failed.";


    switch (error.code) {

      case "auth/invalid-credential":

        message =
          "Incorrect email or password.";

        break;


      case "auth/invalid-email":

        message =
          "Please enter a valid email address.";

        break;


      case "auth/user-not-found":

        message =
          "No account exists with this email.";

        break;


      case "auth/wrong-password":

        message =
          "Incorrect password.";

        break;


      case "auth/operation-not-allowed":

        message =
          "Email/Password login is not enabled in Firebase.";

        break;


      case "auth/too-many-requests":

        message =
          "Too many attempts. Please try again later.";

        break;


      default:

        message =
          error.message ||
          "Unable to login.";

    }


    errorElement.textContent =
      message;


    button.disabled = false;

    button.textContent =
      "Login";

  }

}


/* =========================================================
   ADMIN DASHBOARD
========================================================= */

function showAdminDashboard() {

  renderBase(`

    <div class="hero">

      <h1>
        👨‍🍳 Admin Dashboard
      </h1>


      <p>
        Manage orders, menu availability
        and seating.
      </p>


      <button
        class="ghost"
        onclick="logoutAdmin()"
      >
        🚪 Logout
      </button>

    </div>


    <div
      class="grid"
      style="
        grid-template-columns:1fr 1fr
      "
    >


      <div class="card">

        <h2>
          📋 Live Orders
        </h2>


        <div id="orders">
          Loading…
        </div>

      </div>


      <div class="card">

        <h2>
          🪑 Seating
        </h2>


        <div class="seat">

          <b id="adminSeats">
            ${seatCount}
            seats available
          </b>

        </div>


        <button
          class="btn"
          onclick="changeSeats(5)"
        >
          +5 seats
        </button>


        <button
          class="btn"
          onclick="changeSeats(-5)"
        >
          −5 seats
        </button>


        <div class="notice" style="margin-top:20px;">
          📍 <b>Ordering Zone</b>
          <br>
          ${CANTEEN_LOCATION.name}
          <br>
          <small>Students can place orders only within ${CANTEEN_LOCATION.radiusMeters} metres.</small>
        </div>

        <h2>
          🍔 Menu
        </h2>


        <div id="adminMenu"></div>

      </div>

    </div>

  `);


  renderAdminMenu();

  listenAdmin();

}


/* =========================================================
   ADMIN SEATING
========================================================= */

function changeSeats(number) {

  seatCount =
    Math.max(
      0,
      Math.min(
        100,
        seatCount + number
      )
    );


  const adminElement =
    document.getElementById(
      "adminSeats"
    );


  if (adminElement) {

    adminElement.textContent =
      seatCount +
      " seats available";

  }


  const studentElement =
    document.getElementById(
      "seatCount"
    );


  if (studentElement) {

    studentElement.textContent =
      seatCount;

  }

}


/* =========================================================
   ADMIN MENU
========================================================= */

function renderAdminMenu() {

  const element =
    document.getElementById(
      "adminMenu"
    );


  if (!element) {
    return;
  }


  element.innerHTML =
    menu
      .map(
        (m) => `

          <div class="row">

            <span>
              ${escapeHtml(m.emoji)}
              ${escapeHtml(m.name)}
            </span>


            <button
              class="ghost"
              data-menu-id="${escapeHtml(m.id)}"
            >

              ${
                m.available
                  ? "Sold out"
                  : "Available"
              }

            </button>

          </div>

        `
      )
      .join("");

  element.querySelectorAll("button[data-menu-id]").forEach(button => {
    button.addEventListener("click", () => toggleMenu(button.dataset.menuId));
  });

}


async function toggleMenu(id) {

  const item =
    menu.find(
      (x) => x.id === id
    );


  if (!item) {
    return;
  }


  const oldValue =
    item.available;


  item.available =
    !item.available;


  try {

    await setDoc(
      doc(
        db,
        "menu",
        id
      ),
      item
    );


    renderAdminMenu();


  } catch (error) {

    console.error(
      "Menu update error:",
      error
    );


    item.available =
      oldValue;


    alert(
      "Could not update menu. Check Firebase permissions."
    );

  }

}


/* =========================================================
   ADMIN ORDERS
========================================================= */

function listenAdmin() {

  if (adminOrdersUnsubscribe) {

    adminOrdersUnsubscribe();

  }


  const q =
    query(
      collection(db, "orders"),
      orderBy(
        "createdAt",
        "desc"
      ),
      limit(30)
    );


  adminOrdersUnsubscribe =
    onSnapshot(

      q,

      (snap) => {

        const element =
          document.getElementById(
            "orders"
          );


        if (!element) {
          return;
        }


        if (snap.empty) {

          element.innerHTML =
            "<p>No orders yet.</p>";

          return;

        }


        element.innerHTML =
          snap.docs
            .map(
              (d) => {

                const order = {
                  id: d.id,
                  ...d.data()
                };


                return `

                  <div class="row">

                    <div>

                      <b>
                        #${escapeHtml(order.token)}
                      </b>

                      <br>

                      <small>
                        ₹${escapeHtml(order.total)}
                        ·
                        ${escapeHtml(order.status)}
                      </small>


                      ${
                        order.customerInfo
                          ? `

                            <br>

                            <small>
                              👤
                              ${escapeHtml(order.customerInfo)}
                            </small>

                          `
                          : ""
                      }

                    </div>


                    ${
                      order.status !==
                      "Collected"

                        ? `

                          <button
                            class="ghost"
                            data-order-id="${escapeHtml(order.id)}"
                            data-order-status="${escapeHtml(order.status)}"
                          >
                            Next
                          </button>

                        `

                        : `

                          <span class="pill ok">
                            Completed
                          </span>

                        `
                    }

                  </div>

                `;

              }
            )
            .join("");

        element.querySelectorAll("button[data-order-id]").forEach(button => {
          button.addEventListener("click", () => {
            nextStatus(button.dataset.orderId, button.dataset.orderStatus);
          });
        });

      },

      (error) => {

        console.error(
          "Admin orders error:",
          error
        );


        const element =
          document.getElementById(
            "orders"
          );


        if (element) {

          element.innerHTML = `
            <p>
              Unable to load orders.
            </p>
          `;

        }

      }

    );

}


/* =========================================================
   NEXT STATUS
========================================================= */

async function nextStatus(
  id,
  status
) {

  const states = [
    "Placed",
    "Preparing",
    "Ready",
    "Collected"
  ];


  const index =
    states.indexOf(status);


  if (
    index === -1 ||
    index >= states.length - 1
  ) {

    return;

  }


  const next =
    states[index + 1];


  try {

    await updateDoc(
      doc(
        db,
        "orders",
        id
      ),
      {
        status: next
      }
    );


  } catch (error) {

    console.error(
      "Status update error:",
      error
    );


    alert(
      "Could not update order status. Check Firebase rules."
    );

  }

}


/* =========================================================
   ADMIN LOGOUT
========================================================= */

async function logoutAdmin() {

  try {

    if (adminOrdersUnsubscribe) {

      adminOrdersUnsubscribe();

      adminOrdersUnsubscribe =
        null;

    }


    await signOut(auth);


    /*
       onAuthStateChanged will automatically
       create a new anonymous student session.
    */


  } catch (error) {

    console.error(
      "Admin logout error:",
      error
    );


    alert(
      "Could not log out. Please refresh the page."
    );

  }

}
