/**
 * LIbris — Firebase Authentication Service
 * Handles Email/Password, Google OAuth, Session State, and Role-Based User Profiles
 */

class FirebaseAuthService {
  constructor() {
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.authStateListeners = [];
  }

  init() {
    if (typeof firebase === 'undefined' || !window.fbAuth) {
      console.warn('[FirebaseAuth] Firebase Auth not initialized.');
      return;
    }
    this.auth = window.fbAuth;
    this.db = window.fbDb;

    // Listen to Firebase Auth state changes
    this.auth.onAuthStateChanged(async (user) => {
      if (user) {
        console.log('[FirebaseAuth] User signed in:', user.email);
        const profile = await this.syncUserProfile(user);
        this.currentUser = profile;
        this.notifyListeners(profile);
      } else {
        console.log('[FirebaseAuth] User signed out');
        this.currentUser = null;
        this.notifyListeners(null);
      }
    });
  }

  onAuthStateChanged(callback) {
    if (typeof callback === 'function') {
      this.authStateListeners.push(callback);
      if (this.currentUser !== null) {
        callback(this.currentUser);
      }
    }
  }

  notifyListeners(user) {
    this.authStateListeners.forEach((cb) => {
      try {
        cb(user);
      } catch (e) {
        console.error('[FirebaseAuth] Error in auth listener callback:', e);
      }
    });
  }

  // Fetch or create user profile document in Firestore (/users/{uid})
  async syncUserProfile(firebaseUser) {
    if (!this.db) return null;
    const userRef = this.db.collection('users').doc(firebaseUser.uid);
    try {
      const doc = await userRef.get();
      if (doc.exists) {
        const data = doc.data();
        return {
          id: firebaseUser.uid,
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: data.name || firebaseUser.displayName || 'Alex Mercer',
          regNo: data.regNo || 'REG-2024-8842',
          department: data.department || 'Computer Science',
          semester: data.semester || 6,
          // Roles are administrator-managed Firestore data. Never infer privileges from email text.
          role: data.role || 'student',
          avatar: data.avatar || '#2563eb',
          borrowedBooks: data.borrowedBooks || [],
          bookmarks: data.bookmarks || [],
          readingHistory: data.readingHistory || [],
          reservedBooks: data.reservedBooks || [],
          interestScores: data.interestScores || {},
          searchHistory: data.searchHistory || [],
          aiMemory: data.aiMemory || null,
          studyStreak: data.studyStreak || 3,
          totalDownloads: data.totalDownloads || 0,
          contributions: data.contributions || 0,
          achievements: data.achievements || [1, 2],
          photoURL: firebaseUser.photoURL || null
        };
      } else {
        // Create initial profile in Firestore
        const newProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
          regNo: 'REG-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000),
          department: 'Computer Science',
          semester: 1,
          role: 'student',
          avatar: '#2563eb',
          borrowedBooks: [],
          bookmarks: [],
          readingHistory: [],
          reservedBooks: [],
          interestScores: {},
          searchHistory: [],
          aiMemory: null,
          studyStreak: 1,
          totalDownloads: 0,
          contributions: 0,
          achievements: [1],
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        await userRef.set(newProfile);
        return { id: firebaseUser.uid, ...newProfile };
      }
    } catch (err) {
      console.error('[FirebaseAuth] Error syncing user profile from Firestore:', err);
      // Fallback profile if Firestore permission is pending
      return {
        id: firebaseUser.uid,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        name: firebaseUser.displayName || 'User',
        role: 'student',
        borrowedBooks: [],
        bookmarks: [],
        readingHistory: [],
        interestScores: {},
        searchHistory: [],
        aiMemory: null,
        studyStreak: 1
      };
    }
  }

  async signInWithEmail(email, password) {
    if (!this.auth) throw new Error('Firebase Auth not available');
    return await this.auth.signInWithEmailAndPassword(email, password);
  }

  async signUpWithEmail(email, password, extraData = {}) {
    if (!this.auth) throw new Error('Firebase Auth not available');
    const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
    const user = userCredential.user;
    
    // Create detailed Firestore user record
    if (this.db) {
      const userRef = this.db.collection('users').doc(user.uid);
      const profile = {
        uid: user.uid,
        email: user.email,
        name: extraData.name || user.email.split('@')[0],
        regNo: extraData.regNo || 'REG-2024-' + Math.floor(1000 + Math.random() * 9000),
        department: extraData.department || 'Computer Science',
        semester: parseInt(extraData.semester) || 1,
        // Public registration can only create a student account. Staff roles are assigned by admins.
        role: 'student',
        avatar: extraData.avatar || '#3b82f6',
        borrowedBooks: [],
        bookmarks: [],
        readingHistory: [],
        reservedBooks: [],
        interestScores: {},
        studyStreak: 1,
        totalDownloads: 0,
        contributions: 0,
        achievements: [1],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await userRef.set(profile);
    }
    return userCredential;
  }

  async signInWithGoogle() {
    if (!this.auth) throw new Error('Firebase Auth not available');
    const provider = new firebase.auth.GoogleAuthProvider();
    return await this.auth.signInWithPopup(provider);
  }

  async signOut() {
    if (!this.auth) return;
    await this.auth.signOut();
  }

  async updateProfile(updates) {
    if (!this.currentUser || !this.db) return;
    const userRef = this.db.collection('users').doc(this.currentUser.uid || this.currentUser.id);
    await userRef.set(updates, { merge: true });
    this.currentUser = { ...this.currentUser, ...updates };
    this.notifyListeners(this.currentUser);
  }
}

window.FirebaseAuth = new FirebaseAuthService();
