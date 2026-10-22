# 🍽️ Smart Canteen

A web-based **college canteen management and online food-ordering system** designed to reduce waiting time, minimize queues, and make canteen operations more efficient.

## 📌 About the Project

Smart Canteen provides a digital platform that connects **students and canteen administrators**. Students can browse the digital menu and place orders online, while administrators can monitor and manage incoming orders.

The project was developed to address common problems in traditional college canteens such as long queues, waiting time, manual order management, and difficulty tracking multiple orders during peak hours.

## ✨ Features

* 👨‍🎓 **Student Portal** – Browse the menu and place food orders.
* 🧑‍💼 **Admin Portal** – View and manage student orders.
* 📋 **Digital Menu** – Display food items with prices.
* ⚡ **Online Ordering** – Place orders digitally before reaching the counter.
* 📍 **Location-Based Ordering** – Restrict ordering to the designated canteen area.
* 📊 **Order Management** – Organize and track incoming orders.
* 📱 **Responsive Web Interface** – Designed for convenient use on different devices.
* 🔥 **Firebase Integration** – Backend services and database management using Firebase.

## 🛠️ Technologies Used

| Technology       | Purpose                            |
| ---------------- | ---------------------------------- |
| HTML             | Web structure                      |
| CSS              | Styling and responsive design      |
| JavaScript       | Application logic and interactions |
| Firebase         | Backend services                   |
| Cloud Firestore  | Database                           |
| Firebase Hosting | Web hosting                        |

## 🔄 How It Works

```text
Student
   ↓
Open Smart Canteen
   ↓
View Digital Menu
   ↓
Select Food Items
   ↓
Place Order
   ↓
Firebase / Firestore
   ↓
Admin Dashboard
   ↓
Order Management
   ↓
Food Preparation & Collection
```

## 🎯 Problem Statement

Traditional college canteens can experience:

* Long queues during peak hours
* High waiting times
* Manual order handling
* Difficulty managing multiple orders
* Lack of real-time order organization

Smart Canteen provides a digital ordering workflow to make the process more organized and convenient.

## 🌐 Live Demo

**Live Website:**
https://smart-canteen-e699d.web.app/

## Run the corrected source locally

The runnable frontend is now in the repository root. The ZIP is the original
prototype and does not contain the checkout fixes.

1. Copy `config.example.js` to `config.js` and enter your Firebase web app configuration.
2. Enable Anonymous sign-in in Firebase Authentication and configure Firestore.
3. Run `python3 -m http.server 8000` from the repository root.
4. Open `http://localhost:8000` and allow location access. Ordering requires being
   within the configured 200 m canteen zone in `app.js`.

Run checkout regression tests with `node --test tests/checkout.test.cjs` (Node 24).
These tests use synthetic Firebase responses and do not write to the live database.
Deploy the corrected root frontend through your existing Firebase Hosting setup
to apply the fix to the live website.

## 📂 Project Structure

```text
Smart-Canteen/
│
├── index.html
├── app.js
├── style.css
├── firebase.json
├── .firebaserc
├── functions/
│   └── ...
└── assets/
    └── ...
```

> The exact project structure may vary depending on the latest version of the project.

## 🚀 Future Improvements

* 💳 Online payment integration
* 🔔 Real-time order notifications
* 📈 Sales and order analytics
* 🤖 AI-based demand prediction
* ♻️ Food-waste reduction through demand analysis
* 📱 Progressive Web App support
* ⭐ Student feedback and rating system

## 👨‍💻 Project

**Smart Canteen**
A digital solution for a faster, more organized, and student-friendly college canteen experience.

---

### ⭐ If you find this project useful

Feel free to explore the project, suggest improvements, or contribute to its development.
