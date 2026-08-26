# Smart Library Platform (LIbris) — Full-Stack Architecture & System Documentation

## 1. System Architecture Overview

LIbris has evolved into a **full-stack, cloud-backed web application** deployed via **Firebase Hosting** and backed by **Cloud Firestore** and **Firebase Authentication (Free Tier)**. It maintains zero server runtime overhead while providing real-time data synchronization, live seat maps, rule-based recommendation algorithms, and advanced circulation analytics.

```
+-------------------------------------------------------------------------+
|                              LIbris Frontend SPA                         |
|  (index.html, style.css, app.js, charts.js, search.js, PWA sw.js)      |
+------------------------------------+------------------------------------+
                                     |
           +-------------------------+-------------------------+
           |                         |                         |
+----------v-----------+  +----------v-----------+  +----------v-----------+
|    Firebase Auth     |  |    Cloud Firestore   |  |  Firebase Analytics |
|  - Email / Password  |  |  - Real-time Sync    |  |  - Telemetry Log     |
|  - Google OAuth 2.0  |  |  - Offline Cache     |  |  - Peak Hour Metrics |
|  - Role Resolution   |  |  - Multi-collection  |  |  - Free-tier Tier    |
+----------------------+  +----------------------+  +----------------------+
```

---

## 2. Core Full-Stack Services

### 2.1. Authentication Service (`firebase-auth.js`)
* **Service Class**: `FirebaseAuthService` exposed as `window.FirebaseAuth`
* **Features**:
  - Email/Password and Google OAuth pop-up login (`signInWithPopup`).
  - Automatically loads or initializes Firestore user profile under `/users/{uid}`.
  - Role resolution (`admin` vs `student`) used by App route guards.
  - Active session persistence across browser reloads.

### 2.2. Database & Real-Time Sync Service (`firebase-db.js`)
* **Service Class**: `FirestoreDBService` exposed as `window.FirestoreDB`
* **Firestore Collections**:
  - `/books`: Book catalog items with stock, tags, authors, shelf, rack, rating, borrow counts.
  - `/users`: Detailed student profiles, reading history, bookmarks, interest score maps.
  - `/transactions`: Active and historical loans, renewals, due dates.
  - `/seatBookings`: Real-time seat reservations with live floor plan `onSnapshot` listeners.
  - `/roomBookings`: Collaborative multimedia tech suite reservations.
  - `/notes`: Student uploaded lecture notes, question papers, and lab manuals.
  - `/fines`: Fine balances and payment settlement statuses.
  - `/analytics`: Platform-wide aggregation metrics for the admin console.

### 2.3. Analytics Engine (`firebase-analytics.js`)
* **Service Class**: `AnalyticsEngineService` exposed as `window.AnalyticsEngine`
* **Features**:
  - Client-side event logging (`book_borrow`, `seat_booking`, `user_register`).
  - Real-time hourly heatmap calculation for study zone peak traffic.
  - Dynamic circulation trends and fine recovery calculations for the Admin dashboard.

### 2.4. Personalized Recommendation Engine (`firebase-recommendations.js`)
* **Service Class**: `RecommendationEngineService` exposed as `window.RecommendationEngine`
* **Scoring Factors**:
  1. **Department Match**: +35 points for matching user's enrolled department.
  2. **Semester Level Alignment**: +20 points for current semester coursework textbooks.
  3. **Category Affinity**: Multi-point bonus based on user interaction frequency (views, searches, borrows).
  4. **Popularity**: Velocity bonus based on global borrow metrics.
  5. **Deduplication / Penalty**: Excludes currently borrowed books (-100 pts) and downweights read history.

---

## 3. Data Dictionary & Firestore Schemas

### 3.1. Book Document (`/books/{bookId}`)
```json
{
  "id": 101,
  "title": "Introduction to Algorithms",
  "author": "Thomas H. Cormen",
  "isbn": "978-0262033848",
  "publisher": "MIT Press",
  "publicationYear": 2009,
  "edition": "3rd Edition",
  "department": "CS",
  "category": "Algorithms",
  "semester": 3,
  "pages": 1292,
  "description": "Comprehensive reference and textbook covering fundamental algorithms and data structures.",
  "cover": "#2563eb",
  "shelf": "A-04",
  "rack": "R-12",
  "totalCopies": 10,
  "availableCopies": 7,
  "rating": 4.8,
  "ratingCount": 142,
  "borrowCount": 389,
  "views": 1240,
  "tags": ["Algorithms", "Data Structures", "Core CS"]
}
```

### 3.2. User Document (`/users/{uid}`)
```json
{
  "uid": "usr_948842",
  "name": "Alex Mercer",
  "email": "alex.mercer@university.edu",
  "regNo": "REG-2024-8842",
  "role": "student",
  "department": "Computer Science",
  "semester": 6,
  "avatar": "#2563eb",
  "studyStreak": 14,
  "borrowedBooks": [214, 18],
  "reservedBooks": [61],
  "readingHistory": [101, 104, 110],
  "bookmarks": [198, 201],
  "interestScores": {
    "Algorithms": 14,
    "Machine Learning": 22,
    "Operating Systems": 18
  },
  "achievements": [1, 2, 3]
}
```

### 3.3. Seat Booking Document (`/seatBookings/{id}`)
```json
{
  "id": "ST-BK-884102",
  "isGroup": false,
  "seatId": 14,
  "seatCode": "S-14",
  "seatIds": [14],
  "zone": "Silent Study Pods",
  "floor": "Floor 2",
  "studentId": "usr_948842",
  "studentName": "Alex Mercer",
  "studentRegNo": "REG-2024-8842",
  "startTime": "2026-08-26T10:00:00.000Z",
  "endTime": "2026-08-26T12:00:00.000Z",
  "durationHours": 2,
  "status": "active"
}
```

---

## 4. Public API & Controller Methods (`window.App`)

- **`App.loginWithGoogle()`**: Trigger Google OAuth sign-in pop-up and syncs user record.
- **`App.login(email, pass)` / `App.register(data)`**: Firebase Auth handler with demo fallbacks.
- **`App.borrowBook(bookId)`**: Validates availability, updates Firestore catalog and transactions.
- **`App.renewBook(transactionId)`**: Enforces the 3-day renewal rule (extends due date by 14 days).
- **`App.returnBookAdmin(transactionId)`**: Admin control marking loans as returned and replenishing inventory.
- **`App.generateQRCodeSVG(text, size)`**: Client-side vector SVG generator for campus passes.
- **`App.showDigitalIDModal()`**: Displays interactive Student Library Pass with QR turnstile verification.
- **`App.renderStudyRooms()`**: Renders 4 multimedia suites with live reservation triggers.
- **`App.renderSyllabusMapper(container)`**: Maps course syllabus units to library shelf coordinates.
- **`App.calculateMeritCredits()` / `App.redeemMeritCredits()`**: Academic merit point redemption for fine waivers (10 pts = ₹1.00).
- **`window.seedFirestoreDatabase()`**: One-time cloud seeder uploading all local collections to Firebase.

---

## 5. Deployment & Configuration Guide

1. **Configure Credentials**:
   Edit `firebase-config.js` with your Firebase project credentials from the Firebase Console.
2. **Setup Firebase CLI**:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```
3. **Deploy Hosting & Security Rules**:
   ```bash
   firebase deploy
   ```
4. **Seed Cloud Collections**:
   Open the deployed site, open the browser DevTools Console (`F12`), and run:
   ```javascript
   window.seedFirestoreDatabase();
   ```
