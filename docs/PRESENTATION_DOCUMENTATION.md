# Libris — Presentation Documentation

**Team:** SpDly Studios  
**Project:** Libris  
**Team Leader:** Shivaprasad V

## Presentation purpose

By the end of the presentation, the audience should understand how Libris turns library discovery, circulation, study-space access, personalization, and administration into one deployable Firebase-backed platform.

## Nine-slide narrative

1. **Title** — SpDly Studios, Libris, and team leader Shivaprasad V.
2. **The library experience is fragmented** — discovery, seats, rooms, resources, and fines live in disconnected workflows.
3. **Libris unifies the journey** — one authenticated platform for students and library staff.
4. **Production architecture** — Firebase Auth, Firestore, Analytics, Hosting, and the SPA asset structure.
5. **Personalized discovery with Nova** — Firestore-backed profile signals drive account-specific recommendations and AI book cards.
6. **Real operations, not mock screens** — transactions, seat/room bookings, resources, fines, and payment records persist to Firestore.
7. **Trust, roles, and live administration** — rules enforce ownership; admin workflows manage catalog, analytics, leaderboard, and reseeding.
8. **Deployment and measurable outcomes** — responsive SPA, live listeners, no browser persistence, reproducible Admin SDK provisioning.
9. **Thank You** — Libris / SpDly Studios closing slide.

## Technology summary

- HTML5, CSS3, and vanilla JavaScript SPA.
- Firebase Authentication for identity and role resolution.
- Cloud Firestore for all persistent application records.
- Firebase Analytics for operational events.
- Firebase Hosting for deployment.
- Responsive full-page AI workspace and mobile layouts.

## Integrity statements

- The leaderboard is calculated from Firestore-backed user activity.
- Recommendations are account-specific and use the authenticated UID for ordering.
- Fine payments are written transactionally with payment metadata.
- No localStorage, sessionStorage, IndexedDB, or local demo authentication is used.
- The Admin SDK provisioning script handles destructive Auth resets; browser reset is explicitly confirmed and administrator-gated.
