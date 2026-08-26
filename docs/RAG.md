# Smart Library Platform — Architecture & Codebase Map

## Executive Summary
Smart Library Platform is a single-page web application (SPA) built using **pure HTML, CSS, and Vanilla JavaScript** without React, Vue, Angular, jQuery, Tailwind, Bootstrap, npm dependencies, or backend frameworks. Data persistence and state management rely entirely on browser `LocalStorage` and in-memory singletons.

---

## Workspace Directory Structure

```text
e:/Projects/Smart Library/
├── index.html        # Main SPA shell containing HTML sections for all 13 routes
├── style.css         # Custom CSS design system, CSS custom properties, and dark mode theme
├── app.js            # Core SPA Router, State Manager, Controller, AI Engine & UI Renderer (4,150+ lines)
├── data.js           # Default seed datasets (Books, Users, Transactions, Fines, Occupancy)
├── search.js         # Pure Vanilla JS Substring & Fuzzy Search Engine (Levenshtein Distance)
├── charts.js         # HTML5 Canvas Charting Engine (Line, Bar, Donut, Heatmap, Gauge)
├── manifest.json     # Web App Manifest for Progressive Web App (PWA) installation
├── sw.js             # Cache-first Service Worker for offline resiliency
└── docs/             # Technical & Presentation Documentation
    ├── RAG.md        # Comprehensive Agent Prompt & System Context Map
    ├── ARCHITECTURE.md # Technical Data Schema & Component Specifications
    └── PRESENTATION_DOCUMENTATION.md # Complete slide-by-slide guide & presentation deck notes
```

---

## Component Specifications

### 1. `index.html`
- **Role**: Single Page Application structure.
- **Section Router**: Encapsulates 13 SPA routes inside `<section class="page" id="page-{route}">`:
  - `#page-home`: Welcome greeting, occupancy gauge, reading stats, and trending carousel.
  - `#page-search`: Google-grade search hero, filter chips, results grid/list view toggles.
  - `#page-library`: Real-time occupancy gauge, hourly chart, 7-day heatmap, 48-seat map, collaborative study rooms.
  - `#page-resources`: Senior notes, question papers, lab manuals, and Syllabus-to-Book Auto-Mapper.
  - `#page-dashboard`: Reading progress chart, active loans, study streak calendar, and leaderboard.
  - `#page-profile`: Student ID card, reading history, bookmarks, and Digital Library Pass modal trigger.
  - `#page-admin`: Batch CSV/JSON catalog importer, ISBN barcode scanner, borrow trends, and circulation control.
  - `#page-settings`: Theme switcher (Light/Dark), notification toggles, privacy settings.
  - `#page-book-detail`: Full book metadata, physical shelf/rack location, borrow/reserve actions, and related titles.
  - `#page-ai-librarian`: Nova AI conversational reasoning engine, rich action chips, and interactive widgets.
  - `#page-notifications`: System announcements, due date warnings, reservation alerts.
  - `#page-fines`: Total due, paid balances, Cashfree Sandbox gateway, and Academic Merit Credit waiver card.
  - `#page-upload`: Drag-and-drop resource uploader with file validation.
- **Top Bar**: Search shortcut (`Ctrl+K`), Digital ID button (`🪪 Digital ID`), Notification bell counter badge, and User auth profile dropdown.

### 2. `app.js`
- **Class**: `LibraryApp`
- **Core Subsystems**:
  - **SPA Router**: Hashchange navigation with role guards and smooth fade-in animations.
  - **On-Device AI Librarian NLP Engine**: Contextual memory, 15+ intent vectors, IEEE/APA 7th citation generation, and inline widgets.
  - **Pure SVG QR Generator**: 21x21 matrix algorithm generating scalable vector QR tickets.
  - **Collaborative Study Rooms Manager**: 4 multimedia suites, slot reservations, and group member tagging.
  - **Syllabus Auto-Mapper**: Topic concept extraction and 320+ book catalog keyword matching.
  - **Academic Merit Credits & Fine Waiver Engine**: Daily streak + contribution point accrual and 10 pts = $1.00 fine offset.
  - **Cashfree Sandbox Gateway**: Online fine clearance simulation with order tracking.
  - **Batch CSV/JSON Importer & ISBN Barcode Scanner**: Local file reading and instant catalog lookups.

### 3. `search.js`
- **Class**: `SearchEngine`
- **Features**: Weighted token scoring, Levenshtein distance typo tolerance ($\le 2$ edit distance), Did-You-Mean suggestions, autocomplete dropdown, and search history caching.

### 4. `charts.js`
- **Global Host**: `window.Charts`
- **Features**: Standalone HTML5 2D Canvas charting library supporting Line, Bar, Donut, Area, Heatmap, and Gauge charts with crisp HiDPI canvas rendering.

---

## LocalStorage Schema Keys
| Key | Type | Description |
| :--- | :--- | :--- |
| `smart_lib_books` | Array<Book> | Overridden book catalog array with live copy numbers & shelf locations |
| `smart_lib_users` | Array<User> | Registered student and admin profiles |
| `smart_lib_current_user` | User | Currently authenticated session user with streak, merit credits, and bookmarks |
| `smart_lib_transactions` | Array<Transaction> | Active, returned, and overdue loan logs |
| `smart_lib_notes` | Array<Resource> | Student uploaded notes & question papers |
| `smart_lib_fines` | Array<Fine> | Outstanding and paid fine records |
| `smart_lib_room_bookings` | Array<Booking> | Collaborative group study room reservations with slot and attendee tokens |
| `smart_lib_seats` | Array<Seat> | 48-seat interactive floor plan status records |
