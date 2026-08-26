/**
 * LIbris — Firestore Database Service (Free Tier Client SDK)
 * Uses asynchronous Firestore collections and real-time listeners as the persistence layer.
 */

class FirestoreDBService {
  constructor() {
    this.db = null;
    this.cachedBooks = [];
    this.cachedUsers = [];
    this.cachedTransactions = [];
    this.listeners = [];
  }

  init() {
    if (typeof firebase === 'undefined' || !window.fbDb) {
      console.warn('[FirestoreDB] Firestore SDK not loaded.');
      return;
    }
    this.db = window.fbDb;
  }

  // ==========================================
  // BOOKS
  // ==========================================
  async getBooks() {
    if (!this.db) return this.cachedBooks;
    try {
      const snap = await this.db.collection('books').get();
      if (!snap.empty) {
        this.cachedBooks = snap.docs.map(doc => ({ id: isNaN(doc.id) ? doc.id : Number(doc.id), ...doc.data() }));
        return this.cachedBooks;
      }
    } catch (err) {
      console.warn('[FirestoreDB] getBooks error (falling back to cache/local):', err);
    }
    return this.cachedBooks;
  }

  async getBookById(id) {
    if (!this.db) return this.cachedBooks.find(b => b.id == id);
    try {
      const doc = await this.db.collection('books').doc(String(id)).get();
      if (doc.exists) return { id: isNaN(doc.id) ? doc.id : Number(doc.id), ...doc.data() };
    } catch (e) {
      console.warn('[FirestoreDB] getBookById error:', e);
    }
    return this.cachedBooks.find(b => b.id == id);
  }

  async saveBook(book) {
    if (!this.db) return;
    const docId = String(book.id || Date.now());
    book.id = isNaN(docId) ? docId : Number(docId);
    await this.db.collection('books').doc(docId).set(book, { merge: true });
    
    // Update local cache
    const idx = this.cachedBooks.findIndex(b => b.id == book.id);
    if (idx >= 0) this.cachedBooks[idx] = book;
    else this.cachedBooks.unshift(book);
  }

  async deleteBook(bookId) {
    if (!this.db) return;
    await this.db.collection('books').doc(String(bookId)).delete();
    this.cachedBooks = this.cachedBooks.filter(b => b.id != bookId);
  }

  onBooksChange(callback) {
    if (!this.db) return () => {};
    const unsub = this.db.collection('books').onSnapshot(snap => {
      this.cachedBooks = snap.docs.map(doc => ({ id: isNaN(doc.id) ? doc.id : Number(doc.id), ...doc.data() }));
      callback(this.cachedBooks);
    }, err => console.warn('[FirestoreDB] Books live listener error:', err));
    this.listeners.push(unsub);
    return unsub;
  }

  // ==========================================
  // TRANSACTIONS
  // ==========================================
  async getTransactions(userId = null) {
    if (!this.db) return this.cachedTransactions;
    try {
      let query = this.db.collection('transactions');
      if (userId) query = query.where('userId', '==', userId);
      const snap = await query.orderBy('borrowDate', 'desc').get();
      this.cachedTransactions = snap.docs.map(doc => ({ id: isNaN(doc.id) ? doc.id : Number(doc.id), ...doc.data() }));
      return this.cachedTransactions;
    } catch (err) {
      console.warn('[FirestoreDB] getTransactions fallback:', err);
      return this.cachedTransactions;
    }
  }

  async saveTransaction(trans) {
    if (!this.db) return;
    const docId = String(trans.id || Date.now());
    trans.id = isNaN(docId) ? docId : Number(docId);
    await this.db.collection('transactions').doc(docId).set(trans, { merge: true });
    const idx = this.cachedTransactions.findIndex(t => t.id == trans.id);
    if (idx >= 0) this.cachedTransactions[idx] = trans;
    else this.cachedTransactions.unshift(trans);
  }

  // ==========================================
  // SEAT BOOKINGS (REAL-TIME LIVE MAP)
  // ==========================================
  async getSeatBookings() {
    if (!this.db) return [];
    try {
      const snap = await this.db.collection('seatBookings').get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      return [];
    }
  }

  async saveSeatBooking(booking) {
    if (!this.db) return;
    const docId = String(booking.id || ('SB-' + Date.now()));
    booking.id = docId;
    await this.db.collection('seatBookings').doc(docId).set(booking, { merge: true });
  }

  async deleteSeatBooking(bookingId) {
    if (!this.db) return;
    await this.db.collection('seatBookings').doc(String(bookingId)).delete();
  }

  onSeatBookingsChange(callback) {
    if (!this.db) return () => {};
    const unsub = this.db.collection('seatBookings').onSnapshot(snap => {
      const bookings = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(bookings);
    }, err => console.warn('[FirestoreDB] Live seat listener error:', err));
    this.listeners.push(unsub);
    return unsub;
  }

  // ==========================================
  // STUDY ROOM BOOKINGS
  // ==========================================
  async getRoomBookings() {
    if (!this.db) return [];
    try {
      const snap = await this.db.collection('roomBookings').get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      return [];
    }
  }

  async saveRoomBooking(booking) {
    if (!this.db) return;
    const docId = String(booking.id || ('RB-' + Date.now()));
    booking.id = docId;
    await this.db.collection('roomBookings').doc(docId).set(booking, { merge: true });
  }

  // ==========================================
  // FINES
  // ==========================================
  async getFines(userId = null) {
    if (!this.db) return [];
    try {
      let query = this.db.collection('fines');
      if (userId) query = query.where('studentId', '==', userId);
      const snap = await query.get();
      return snap.docs.map(doc => ({ id: isNaN(doc.id) ? doc.id : Number(doc.id), ...doc.data() }));
    } catch (e) {
      return [];
    }
  }

  async saveFine(fine) {
    if (!this.db) return;
    const docId = String(fine.id || Date.now());
    fine.id = isNaN(docId) ? docId : Number(docId);
    await this.db.collection('fines').doc(docId).set(fine, { merge: true });
  }

  async payFine(fineId, userId, payment = {}) {
    if (!this.db || !fineId || !userId) throw new Error('Authenticated Firestore connection required');
    const ref = this.db.collection('fines').doc(String(fineId));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Fine not found');
      const fine = snap.data();
      if (fine.studentId !== userId && fine.userId !== userId) throw new Error('You cannot pay this fine');
      if (fine.status === 'paid') return;
      tx.update(ref, {
        status: 'paid',
        paidAt: firebase.firestore.FieldValue.serverTimestamp(),
        paidBy: userId,
        paymentProvider: payment.provider || 'cashfree-sandbox',
        paymentReference: payment.reference || `LIB-${userId}-${fineId}-${Date.now()}`,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    return { id: fineId, status: 'paid' };
  }

  // ==========================================
  // NOTIFICATIONS
  // ==========================================
  async getNotifications(userId) {
    if (!this.db || !userId) return [];
    try {
      const snap = await this.db.collection('notifications')
        .where('userId', 'in', [userId, 'all', 0])
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      return [];
    }
  }

  onNotificationsChange(userId, callback) {
    if (!this.db || !userId) return () => {};
    const unsub = this.db.collection('notifications')
      .where('userId', 'in', [userId, 'all', 0])
      .onSnapshot(snap => {
        const notifs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        callback(notifs);
      }, err => console.warn('[FirestoreDB] Notification listener error:', err));
    this.listeners.push(unsub);
    return unsub;
  }

  // ==========================================
  // NOTES / DIGITAL RESOURCES
  // ==========================================
  async getNotes() {
    if (!this.db) return [];
    try {
      const snap = await this.db.collection('notes').orderBy('uploadDate', 'desc').get();
      return snap.docs.map(doc => ({ id: isNaN(doc.id) ? doc.id : Number(doc.id), ...doc.data() }));
    } catch (e) {
      return [];
    }
  }

  async saveNote(note) {
    if (!this.db) return;
    const docId = String(note.id || Date.now());
    note.id = isNaN(docId) ? docId : Number(docId);
    await this.db.collection('notes').doc(docId).set(note, { merge: true });
  }

  // ==========================================
  // PLATFORM ANALYTICS DOC
  // ==========================================
  async getPlatformAnalytics() {
    if (!this.db) return null;
    try {
      const doc = await this.db.collection('analytics').doc('platform').get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      return null;
    }
  }

  async saveLeaderboardEntry(user) {
    if (!this.db || !user?.uid) throw new Error('Authenticated Firestore connection required');
    const booksRead = (user.readingHistory || []).length;
    const streak = Number(user.studyStreak || 0);
    const contributions = Number(user.contributions || 0);
    const score = booksRead * 10 + streak * 5 + contributions * 20;
    await this.db.collection('leaderboard').doc(user.uid).set({
      uid: user.uid, name: user.name || 'Student', department: user.department || 'General',
      booksRead, streak, contributions, score, updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  async getLeaderboard(limit = 20) {
    if (!this.db) return [];
    const snap = await this.db.collection('leaderboard').orderBy('score', 'desc').limit(limit).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async getUsers() {
    if (!this.db) return [];
    const snap = await this.db.collection('users').get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async updatePlatformAnalytics(data) {
    if (!this.db) return;
    await this.db.collection('analytics').doc('platform').set(data, { merge: true });
  }
}

window.FirestoreDB = new FirestoreDBService();
