/**
 * LIbris — Firebase Configuration & Initialization
 * Free-Tier Firebase Integration
 */

const firebaseConfig = {
  apiKey: "AIzaSyD2tBVwZvVfBtBHGyBBCAgvkXDxHh-JQI0",
  authDomain: "club-management-mit.firebaseapp.com",
  projectId: "club-management-mit",
  storageBucket: "club-management-mit.firebasestorage.app",
  messagingSenderId: "1037830153502",
  appId: "1:1037830153502:web:49da56958d155529d1950f",
  measurementId: "G-YYTS787N75"
};

// Check if Firebase SDK is loaded
if (typeof firebase === 'undefined') {
  console.warn('[LIbris] Firebase SDK not detected. Mock mode or waiting for CDN scripts.');
} else {
  // Initialize Firebase App
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Initialize Services
  window.fbAuth = firebase.auth();
  window.fbDb = firebase.firestore();
  
  try {
    window.fbAnalytics = firebase.analytics();
  } catch (err) {
    console.warn('[LIbris] Analytics initialization skipped (likely local environment):', err.message);
    window.fbAnalytics = null;
  }

  // Enable Firestore offline persistence for instant load & offline resilience
  window.fbDb.enablePersistence({ synchronizeTabs: true })
    .then(() => {
      console.log('[LIbris] Firestore offline persistence enabled successfully.');
    })
    .catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn('[LIbris] Persistence failed: Multiple tabs open simultaneously.');
      } else if (err.code === 'unimplemented') {
        console.warn('[LIbris] Browser does not support Firestore persistence.');
      }
    });
}
