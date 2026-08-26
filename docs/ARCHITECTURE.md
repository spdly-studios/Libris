# Libris — Production Architecture

**Team:** SpDly Studios  
**Project:** Libris  
**Team Leader:** Shivaprasad V

Libris is a Firebase-backed single-page library platform. Firebase Authentication and Cloud Firestore are the source of truth; the browser does not use localStorage, sessionStorage, IndexedDB, or fake runtime records for application data.

## Architecture

```text
Browser SPA (index.html + assets/)
        │
        ├── Firebase Authentication
        ├── Cloud Firestore
        │     └── users, books, transactions, fines, bookings, notes,
        │         leaderboard, notifications, analytics
        ├── Firebase Analytics
        └── Firebase Hosting
```

## Source layout

- `index.html` — application shell and page sections.
- `assets/css/style.css` — responsive design system.
- `assets/js/app.js` — routing, UI orchestration, and feature controllers.
- `assets/js/firebase-auth.js` — authenticated profile synchronization.
- `assets/js/firebase-db.js` — Firestore reads, writes, queries, and listeners.
- `assets/js/firebase-recommendations.js` — account-specific ranking engine.
- `assets/js/search.js` — catalog search and user-scoped history.
- `assets/js/seed-firestore.js` — explicitly confirmed browser bootstrap helper.
- `scripts/provision-test-data.mjs` — privileged reset, Auth provisioning, and seed workflow.

## Firestore collections

| Collection | Purpose | Ownership |
|---|---|---|
| `users/{uid}` | Profile, role, history, bookmarks, preferences | Member owns profile; admin manages roles |
| `books/{bookId}` | Catalog, inventory, metadata, availability | Public read; librarian/admin write |
| `transactions/{id}` | Borrow, renewal, return history | Member reads own; staff manages |
| `fines/{id}` | Balances and settlements | Member reads own; restricted payment transition |
| `seatBookings/{id}` | Live seat reservations | Authenticated users; owner/staff mutation |
| `roomBookings/{id}` | Study-room reservations | Authenticated users; owner/staff mutation |
| `notes/{id}` | Academic resources | Public read; uploader/staff mutation |
| `leaderboard/{uid}` | Derived score and ranking entry | Member updates own; authenticated read |
| `notifications/{id}` | Account/platform notifications | User-scoped read; staff creation |
| `analytics/{id}` | Staff aggregates | Librarian/admin only |

## Authentication and authorization

Firebase Auth establishes identity. On sign-in, `/users/{uid}` is loaded or created. Registration can only create a student profile. Admin and librarian roles are assigned through trusted provisioning or an existing administrator. Client-side guards improve UX, but `firestore.rules` is the actual security boundary.

The bootstrap administrator is `vshivaprasad07@gmail.com`. The email is never used as a password or stored credential; its administrator role is established in Firestore through provisioning and the matching security policy.

## Personalization and leaderboard

Reading history, bookmarks, department, semester, category interests, AI memory, and search history are stored in the authenticated profile. Recommendations score Firestore catalog records against that profile and use the authenticated UID for deterministic per-user ordering. Leaderboard records are updated from reading history, streak, and contributions, then ranked from Firestore rather than bundled data.

## Deployment

```powershell
firebase deploy
```

For an initial full reset and seed, use a Firebase Admin service account outside the public site:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_JSON = Get-Content .\service-account.json -Raw
$env:LIBRIS_ADMIN_EMAIL = "vshivaprasad07@gmail.com"
node scripts\provision-test-data.mjs --confirm-reset
```

The browser reset control is explicitly confirmed and administrator-gated. It cannot and should not delete Firebase Auth users; complete Auth deletion belongs to the Admin SDK script.

## Operational guarantees

- No browser persistence APIs.
- No demo login fallback.
- User actions persist through Firestore service methods.
- Fine payment uses a Firestore transaction and records settlement metadata.
- Live seat and catalog listeners refresh the UI from Firestore.
- Backend rules enforce ownership and roles even if UI checks are bypassed.
