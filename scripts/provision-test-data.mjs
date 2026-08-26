import admin from 'firebase-admin';

if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error('Set FIREBASE_SERVICE_ACCOUNT_JSON to a service-account JSON string.');
}
if (process.argv[2] !== '--confirm-reset') {
  throw new Error('This command resets Firebase Authentication and Firestore. Re-run with --confirm-reset.');
}
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) });
const auth = admin.auth();
const db = admin.firestore();

const collections = ['users', 'books', 'notes', 'transactions', 'fines', 'seatBookings', 'roomBookings', 'notifications', 'analytics'];
async function deleteCollection(name) {
  while (true) {
    const snapshot = await db.collection(name).limit(400).get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

console.log('Resetting Firebase Authentication and Firestore...');
let nextPageToken;
do {
  const page = await auth.listUsers(1000, nextPageToken);
  if (page.users.length) await auth.deleteUsers(page.users.map((user) => user.uid));
  nextPageToken = page.pageToken;
} while (nextPageToken);
for (const collection of collections) await deleteCollection(collection);
console.log('Reset complete. Seeding initial deployment data...');

const users = [
  { email: 'admin@libris.test', name: 'Libris Administrator', role: 'admin', department: 'Library Services', semester: 0 },
  ...Array.from({ length: 5 }, (_, i) => ({
    email: `student${i + 1}@libris.test`, name: `Test Student ${i + 1}`,
    role: 'student', department: ['Computer Science', 'Electronics', 'Mechanical', 'Physics', 'Civil'][i], semester: i + 1
  }))
];

const accountIds = [];
for (const profile of users) {
  let account;
  try { account = await auth.getUserByEmail(profile.email); }
  catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  if (!account) account = await auth.createUser({ email: profile.email, password: 'Libris-Test-2026!', displayName: profile.name, emailVerified: true });
  accountIds.push({ ...profile, uid: account.uid });
  await db.collection('users').doc(account.uid).set({
    uid: account.uid, email: profile.email, name: profile.name, role: profile.role,
    department: profile.department, semester: profile.semester, borrowedBooks: [], bookmarks: [],
    readingHistory: [], reservedBooks: [], interestScores: {}, studyStreak: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`${profile.role}: ${profile.email} (${account.uid})`);
}

const books = [
  { id: 'test-book-1', title: 'Algorithms in Practice', author: 'Libris Press', category: 'Algorithms', department: 'Computer Science', semester: 1, availableCopies: 4, borrowCount: 12, rating: 4.8, tags: ['algorithms', 'programming'] },
  { id: 'test-book-2', title: 'Signals and Systems', author: 'Libris Press', category: 'Electronics', department: 'Electronics', semester: 2, availableCopies: 3, borrowCount: 8, rating: 4.5, tags: ['signals', 'systems'] },
  { id: 'test-book-3', title: 'Engineering Mechanics', author: 'Libris Press', category: 'Mechanics', department: 'Mechanical', semester: 3, availableCopies: 2, borrowCount: 5, rating: 4.4, tags: ['mechanics'] }
];
const batch = db.batch();
for (const book of books) batch.set(db.collection('books').doc(book.id), book, { merge: true });
for (const profile of accountIds.filter((user) => user.role === 'student')) {
  batch.set(db.collection('fines').doc(`test-fine-${profile.uid}`), {
    id: `test-fine-${profile.uid}`, studentId: profile.uid, userId: profile.uid,
    amount: 25, reason: 'Overdue test fine', status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}
await batch.commit();
console.log('Provisioned 1 admin, 5 test users, and mock catalog data.');
