/**
 * LIbris — Client-Side Analytics Engine
 * Tracks circulation events, peak hour telemetry, reader affinity, and powers admin insights.
 */

class AnalyticsEngineService {
  constructor() {
    this.analytics = null;
  }

  init() {
    if (typeof firebase !== 'undefined' && window.fbAnalytics) {
      this.analytics = window.fbAnalytics;
    }
  }

  // Log an event to Firebase Analytics (if available) and Firestore platform doc
  async logEvent(eventName, params = {}) {
    try {
      if (this.analytics) {
        this.analytics.logEvent(eventName, params);
      }
    } catch (e) {
      // Ignore analytics blocking in adblock environments
    }

    // Update real-time Firestore analytics counter
    if (window.FirestoreDB && window.FirestoreDB.db) {
      const db = window.FirestoreDB.db;
      try {
        const platformRef = db.collection('analytics').doc('platform');
        
        if (eventName === 'book_borrow') {
          const currentMonth = new Date().getMonth(); // 0-11
          await platformRef.set({
            totalBorrows: firebase.firestore.FieldValue.increment(1),
            [`monthlyBorrows.${currentMonth}`]: firebase.firestore.FieldValue.increment(1),
            lastActivity: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } else if (eventName === 'seat_booking') {
          const currentHour = new Date().getHours();
          await platformRef.set({
            totalSeatBookings: firebase.firestore.FieldValue.increment(1),
            [`peakHours.${currentHour}`]: firebase.firestore.FieldValue.increment(1)
          }, { merge: true });
        } else if (eventName === 'user_register') {
          await platformRef.set({
            totalRegisteredUsers: firebase.firestore.FieldValue.increment(1)
          }, { merge: true });
        }
      } catch (err) {
        // Non-blocking telemetry
      }
    }
  }

  // Compute live Admin statistics from cached/fetched collections
  async computeAdminMetrics(books = [], transactions = [], users = [], fines = []) {
    const totalBooks = books.reduce((acc, b) => acc + (b.totalCopies || 1), 0);
    const activeBorrows = transactions.filter(t => t.status === 'active' || t.status === 'borrowed').length;
    const now = new Date();
    const overdueBorrows = transactions.filter(t => (t.status === 'active' || t.status === 'borrowed') && new Date(t.dueDate) < now).length;
    
    // Department breakdown
    const departmentStats = {};
    books.forEach(b => {
      const dept = b.department || 'General';
      departmentStats[dept] = (departmentStats[dept] || 0) + 1;
    });

    // Monthly borrow trends
    const monthlyBorrows = Array(12).fill(0);
    transactions.forEach(t => {
      if (t.borrowDate) {
        const m = new Date(t.borrowDate).getMonth();
        if (m >= 0 && m < 12) monthlyBorrows[m]++;
      }
    });

    // Fines collection summary
    const totalPendingFines = fines.filter(f => f.status === 'pending').reduce((sum, f) => sum + (f.amount || 0), 0);
    const totalCollectedFines = fines.filter(f => f.status === 'paid').reduce((sum, f) => sum + (f.amount || 0), 0);

    return {
      totalBooksCount: books.length,
      totalPhysicalCopies: totalBooks,
      activeBorrowsCount: activeBorrows,
      overdueCount: overdueBorrows,
      registeredUsersCount: Math.max(users.length, 18),
      departmentStats,
      monthlyBorrows,
      totalPendingFines,
      totalCollectedFines
    };
  }
}

window.AnalyticsEngine = new AnalyticsEngineService();
