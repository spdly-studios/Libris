/**
 * LIbris — Firestore Initial Data Migration / Seeder
 * Run this once via browser console: window.seedFirestoreDatabase()
 * It uploads the curated catalog, users, transactions, and study materials to Cloud Firestore.
 */

window.seedFirestoreDatabase = async function() {
  if (!window.fbDb) {
    alert('Firebase Firestore is not initialized. Check firebase-config.js credentials.');
    return;
  }
  const db = window.fbDb;
  const data = window.LibraryData;
  if (!data) {
    alert('data.js is not loaded.');
    return;
  }

  console.log('[LIbris Seeder] Starting Firestore data migration...');
  const statusEl = document.createElement('div');
  statusEl.style.cssText = 'position:fixed;top:20px;right:20px;background:#1e293b;color:#fff;padding:16px 24px;border-radius:8px;z-index:999999;box-shadow:0 10px 25px rgba(0,0,0,0.5);font-family:sans-serif;font-size:14px;';
  statusEl.innerHTML = '⏳ Seeding Firestore collections (Books, Users, Notes, Trans)...';
  document.body.appendChild(statusEl);

  try {
    const batch = db.batch();

    // 1. Seed Books
    if (data.books && data.books.length > 0) {
      console.log(`[LIbris Seeder] Uploading ${data.books.length} books...`);
      for (const book of data.books) {
        const ref = db.collection('books').doc(String(book.id));
        batch.set(ref, book, { merge: true });
      }
    }

    // 2. Seed Notes & Resources
    if (data.notes && data.notes.length > 0) {
      for (const note of data.notes) {
        const ref = db.collection('notes').doc(String(note.id));
        batch.set(ref, note, { merge: true });
      }
    }

    // 3. Seed Question Papers
    if (data.questionPapers && data.questionPapers.length > 0) {
      for (const qp of data.questionPapers) {
        const ref = db.collection('notes').doc(String(qp.id));
        batch.set(ref, { ...qp, type: 'paper' }, { merge: true });
      }
    }

    // 4. Seed Transactions
    if (data.transactions && data.transactions.length > 0) {
      for (const tx of data.transactions) {
        const ref = db.collection('transactions').doc(String(tx.id));
        batch.set(ref, tx, { merge: true });
      }
    }

    // 5. Seed Fines
    if (data.fines && data.fines.length > 0) {
      for (const fine of data.fines) {
        const ref = db.collection('fines').doc(String(fine.id));
        batch.set(ref, fine, { merge: true });
      }
    }

    // 5b. Seed Student Profiles into /users
    if (data.students && data.students.length > 0) {
      for (const student of data.students) {
        const ref = db.collection('users').doc(String(student.id));
        batch.set(ref, {
          ...student,
          role: student.role || 'student',
          interestScores: student.interestScores || { "Algorithms": 10, "Machine Learning": 15 },
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    }

    // 6. Seed Platform Analytics baseline doc
    const analyticsRef = db.collection('analytics').doc('platform');
    batch.set(analyticsRef, {
      totalBorrows: data.transactions ? data.transactions.length : 145,
      totalUsers: (data.students ? data.students.length : 18) + 2,
      departmentStats: (data.analytics && data.analytics.departmentStats) || { CS: 45, ECE: 30, ME: 25, PHY: 20 },
      monthlyBorrows: (data.analytics && data.analytics.monthlyBorrows) || [65, 80, 110, 95, 120, 140, 130, 155, 170, 160, 185, 200],
      seededAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();
    console.log('[LIbris Seeder] ✅ Firestore seeded successfully!');
    statusEl.style.background = '#10b981';
    statusEl.innerHTML = '✅ Firestore collections seeded successfully! Reloading...';
    setTimeout(() => {
      statusEl.remove();
      window.location.reload();
    }, 2000);
  } catch (err) {
    console.error('[LIbris Seeder] Error seeding Firestore:', err);
    statusEl.style.background = '#ef4444';
    statusEl.innerHTML = '❌ Seeding Error: ' + err.message;
  }
};

window.resetAndSeedInitialData = async function () {
  if (!window.fbDb || !window.fbAuth || !window.LibraryData) return alert('Firebase is not ready.');
  if (!window.FirebaseAuth?.currentUser || window.FirebaseAuth.currentUser.role !== 'admin') {
    return alert('Only an authenticated administrator can reset and seed data.');
  }
  if (!confirm('This permanently deletes Firestore data in this project. Continue?')) return;
  const collections = ['users', 'books', 'notes', 'transactions', 'fines', 'seatBookings', 'roomBookings', 'notifications', 'analytics'];
  try {
    for (const name of collections) {
      let snapshot;
      do {
        snapshot = await window.fbDb.collection(name).limit(400).get();
        if (!snapshot.empty) {
          const batch = window.fbDb.batch();
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
      } while (!snapshot.empty);
    }
    const accounts = [{ email: 'admin@libris.test', name: 'Libris Administrator', role: 'admin', department: 'Library Services', semester: 0 }, ...Array.from({ length: 5 }, (_, i) => ({ email: `student${i + 1}@libris.test`, name: `Test Student ${i + 1}`, role: 'student', department: ['Computer Science', 'Electronics', 'Mechanical', 'Physics', 'Civil'][i], semester: i + 1 }))];
    for (const account of accounts) {
      let credential;
      try { credential = await window.fbAuth.createUserWithEmailAndPassword(account.email, 'Libris-Test-2026!'); }
      catch (error) { if (error.code === 'auth/email-already-in-use') continue; throw error; }
      await window.fbDb.collection('users').doc(credential.user.uid).set({ uid: credential.user.uid, email: account.email, ...account, borrowedBooks: [], bookmarks: [], readingHistory: [], interestScores: {}, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      await window.fbAuth.signOut();
    }
    // Re-authenticate as the seed administrator before writing shared catalog data.
    await window.fbAuth.signInWithEmailAndPassword('admin@libris.test', 'Libris-Test-2026!');
    const adminUser = window.fbAuth.currentUser;
    await window.fbDb.collection('users').doc(adminUser.uid).set({ uid: adminUser.uid, email: adminUser.email, name: 'Libris Administrator', role: 'admin', department: 'Library Services', semester: 0, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    await window.seedFirestoreDatabase();
  } catch (error) {
    console.error('[LIbris Seeder] Reset failed:', error);
    alert(`Reset failed: ${error.message}`);
  }
};
