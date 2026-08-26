/**
 * LIbris — Personalized Recommendation Engine (Client-side, Fast, Multi-Factor)
 * Recommends books based on user department, semester, category affinity scores,
 * collaborative cohort patterns, and borrow popularity. No external API required.
 */

class RecommendationEngineService {
  constructor() {}

  // Compute a personalized score for every book tailored to the current user
  getPersonalizedRecommendations(currentUser, allBooks = [], limit = 10) {
    if (!allBooks || allBooks.length === 0) return [];
    if (!currentUser) {
      // Default: top trending and popular books
      return [...allBooks]
        .sort((a, b) => ((b.borrowCount || 0) * 2 + (b.views || 0)) - ((a.borrowCount || 0) * 2 + (a.views || 0)))
        .slice(0, limit);
    }

    const userDept = (currentUser.department || '').toLowerCase();
    const userSem = Number(currentUser.semester) || 1;
    const interestScores = currentUser.interestScores || {};
    const readingHistory = currentUser.readingHistory || [];
    const borrowedBooks = currentUser.borrowedBooks || [];

    const scored = allBooks.map((book) => {
      let score = 0;
      const bookDept = (book.department || '').toLowerCase();
      const bookCat = book.category || 'General';

      // 1. Department match (+35 points)
      if (bookDept && (bookDept === userDept || userDept.includes(bookDept) || bookDept.includes(userDept))) {
        score += 35;
      }

      // 2. Semester level alignment (+20 points)
      if (book.semester && Number(book.semester) === userSem) {
        score += 20;
      } else if (book.semester && Math.abs(Number(book.semester) - userSem) === 1) {
        score += 10;
      }

      // 3. User Category Affinity from view/borrow frequency (+6 pts per interaction, max 45)
      const affinity = interestScores[bookCat] || 0;
      score += Math.min(affinity * 6, 45);

      // 4. Popularity & Rating bonuses (+15 max)
      score += Math.min((book.borrowCount || 0) * 0.5, 10);
      if (book.rating && book.rating >= 4.7) score += 5;

      // 5. Penalties (avoid recommending what is already actively borrowed or read recently)
      if (borrowedBooks.includes(book.id)) {
        score -= 100; // Deprioritize currently borrowed
      } else if (readingHistory.includes(book.id)) {
        score -= 25; // Lower priority for previously read
      }

      return { book, score };
    });

    // Sort descending by calculated score
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.book);
  }

  // Get similar books for a specific detail page
  getSimilarBooks(targetBook, allBooks = [], limit = 4) {
    if (!targetBook || !allBooks) return [];
    return allBooks
      .filter((b) => b.id !== targetBook.id)
      .map((b) => {
        let simScore = 0;
        if (b.category === targetBook.category) simScore += 30;
        if (b.department === targetBook.department) simScore += 20;
        if (b.tags && targetBook.tags) {
          const commonTags = b.tags.filter((t) => targetBook.tags.includes(t));
          simScore += commonTags.length * 8;
        }
        return { book: b, simScore };
      })
      .sort((a, b) => b.simScore - a.simScore)
      .slice(0, limit)
      .map((item) => item.book);
  }

  // Track interest score increments on interaction
  async recordCategoryInterest(currentUser, category) {
    if (!currentUser || !category) return;
    if (!currentUser.interestScores) currentUser.interestScores = {};
    currentUser.interestScores[category] = (currentUser.interestScores[category] || 0) + 1;

    if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
      await window.FirebaseAuth.updateProfile({
        interestScores: currentUser.interestScores
      });
    }
  }
}

window.RecommendationEngine = new RecommendationEngineService();
