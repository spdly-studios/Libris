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
