/**
 * Search Engine for Smart Library Platform
 * Provides advanced search capabilities including fuzzy matching,
 * weighted scoring, natural language parsing, and autocomplete.
 */

(function () {
    const STOP_WORDS = new Set([
        'the', 'a', 'an', 'in', 'of', 'for', 'to', 'and', 'is', 'by', 'on', 'with', 'about'
    ]);

    class SearchEngineClass {
        constructor() {
            this.books = [];
            this.initialized = false;
        }

        /**
         * Initialize the search engine with data
         */
        init() {
            if (window.LibraryData && window.LibraryData.books) {
                this.books = window.LibraryData.books;
                this.initialized = true;
            } else {
                const stored = localStorage.getItem('smart_lib_books');
                if (stored) {
                    try {
                        this.books = JSON.parse(stored);
                        this.initialized = true;
                    } catch(e) {}
                }
            }
        }

        /**
         * Calculate Levenshtein distance between two strings
         */
        _levenshtein(a, b) {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;

            const matrix = [];

            for (let i = 0; i <= b.length; i++) {
                matrix[i] = [i];
            }

            for (let j = 0; j <= a.length; j++) {
                matrix[0][j] = j;
            }

            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    if (b.charAt(i - 1) === a.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1, // substitution
                            Math.min(
                                matrix[i][j - 1] + 1, // insertion
                                matrix[i - 1][j] + 1  // deletion
                            )
                        );
                    }
                }
            }
            return matrix[b.length][a.length];
        }

        /**
         * Check if two words are fuzzy matches (distance <= 2)
         */
        _isFuzzyMatch(word1, word2) {
            const dist = this._levenshtein(word1, word2);
            // Allow up to 2 edits for longer words, 1 edit for shorter words
            const threshold = Math.max(word1.length, word2.length) > 5 ? 2 : 1;
            return dist <= threshold;
        }

        /**
         * Tokenize query, remove stop words, handle quotes
         */
        _tokenize(query) {
            if (!query) return [];
            query = query.toLowerCase();
            const tokens = [];
            
            // Extract quoted phrases
            const regex = /"([^"]+)"/g;
            let match;
            while ((match = regex.exec(query)) !== null) {
                tokens.push(match[1]);
                query = query.replace(match[0], ' ');
            }

            // Split remaining by spaces and punctuation
            const rawTokens = query.split(/[\s,.-]+/);
            
            for (const t of rawTokens) {
                const clean = t.trim();
                if (clean && !STOP_WORDS.has(clean)) {
                    tokens.push(clean);
                }
            }
            return tokens;
        }

        /**
         * Simple natural language parsing
         */
        _parseNL(query) {
            const parsed = {
                author: null,
                category: null,
                department: null,
                semester: null,
                isbn: null,
                topic: null,
                keywords: []
            };

            if (!query) return parsed;
            const lowerQuery = query.toLowerCase();

            // Extract ISBN
            const isbnMatch = lowerQuery.match(/isbn\s*([\d-]+)/);
            if (isbnMatch) parsed.isbn = isbnMatch[1].replace(/-/g, '');

            // Extract author (books by X)
            const authorMatch = lowerQuery.match(/(?:books? by|written by)\s+([a-z\s]+)/);
            if (authorMatch) {
                parsed.author = authorMatch[1].trim();
            }

            // Extract topic/category (books about X, X books)
            const topicMatch = lowerQuery.match(/(?:books? about|books? on)\s+([a-z\s]+)/);
            if (topicMatch) {
                parsed.topic = topicMatch[1].trim();
            } else {
                const prefixTopicMatch = lowerQuery.match(/([a-z\s]+)\s+books?/);
                if (prefixTopicMatch && !prefixTopicMatch[1].includes('by')) {
                    parsed.category = prefixTopicMatch[1].trim();
                }
            }

            // Extract semester
            const semMatch = lowerQuery.match(/semester\s+(\d)|sem\s+(\d)/);
            if (semMatch) parsed.semester = parseInt(semMatch[1] || semMatch[2]);

            // CS / IT / MECH department hints
            if (lowerQuery.includes('cs') || lowerQuery.includes('computer science')) parsed.department = 'Computer Science';
            else if (lowerQuery.includes('it') || lowerQuery.includes('information technology')) parsed.department = 'Information Technology';
            else if (lowerQuery.includes('mech') || lowerQuery.includes('mechanical')) parsed.department = 'Mechanical';
            
            parsed.keywords = this._tokenize(query);

            return parsed;
        }

        /**
         * Score a book against tokens and parsed data
         */
        _scoreBook(book, tokens, parsedData) {
            let score = 0;
            const bTitle = (book.title || '').toLowerCase();
            const bAuthor = (book.author || '').toLowerCase();
            const bCategory = (book.category || '').toLowerCase();
            const bTags = (book.tags || []).map(t => t.toLowerCase());
            const bDept = (book.department || '').toLowerCase();
            const bPub = (book.publisher || '').toLowerCase();
            const bDesc = (book.description || '').toLowerCase();
            const bIsbn = (book.isbn || '').replace(/-/g, '');

            // Exact ISBN match
            if (parsedData.isbn && bIsbn.includes(parsedData.isbn)) {
                score += 100;
            }

            // Natural Language matches
            if (parsedData.author && bAuthor.includes(parsedData.author)) score += 15;
            if (parsedData.category && bCategory.includes(parsedData.category)) score += 10;
            if (parsedData.department && bDept.includes(parsedData.department)) score += 10;
            if (parsedData.topic && (bTitle.includes(parsedData.topic) || bDesc.includes(parsedData.topic))) score += 8;
            if (parsedData.semester && book.semester === parsedData.semester) score += 5;

            // Token matching
            for (const token of tokens) {
                if (!token || token.length === 0) continue;
                
                if (bTitle.includes(token)) score += 12;
                else if (bTitle.split(/\s+/).some(w => w.includes(token) || token.includes(w) || this._isFuzzyMatch(w, token))) score += 8;

                if (bAuthor.includes(token)) score += 10;
                else if (bAuthor.split(/\s+/).some(w => w.includes(token) || token.includes(w) || this._isFuzzyMatch(w, token))) score += 6;

                if (bCategory.includes(token)) score += 8;
                if (bTags.some(t => t.includes(token) || token.includes(t))) score += 6;
                if (bDept.includes(token)) score += 5;
                if (bPub.includes(token)) score += 3;
                if (bDesc.includes(token)) score += 2;
            }

            return score;
        }

        /**
         * Apply dynamic boosts to base score
         */
        _boostScore(score, book) {
            if (score === 0) return 0; // Don't boost if no match

            // Popularity boost
            const maxBorrowCount = 500; // Arbitrary high number for scaling
            const borrowBoost = ((book.borrowCount || 0) / maxBorrowCount) * 2;
            score += borrowBoost;

            // Rating boost
            const ratingBoost = ((book.rating || 0) / 5) * 1.5;
            score += ratingBoost;

            // Trending boost
            if (book.trending) {
                score += 3;
            }

            // Recency boost (simple heuristic based on addedDate string or assume newer ID)
            if (book.addedDate) {
                const added = new Date(book.addedDate).getTime();
                const now = new Date().getTime();
                const daysOld = (now - added) / (1000 * 3600 * 24);
                if (daysOld < 30) score += 2;
                else if (daysOld < 90) score += 1;
            }

            return score;
        }

        /**
         * Attempt to find corrected query
         */
        _getDidYouMean(query) {
            const tokens = this._tokenize(query);
            if (tokens.length === 0) return null;

            // Build a dictionary of known words from library data
            const dictionary = new Set();
            this.books.forEach(b => {
                b.title.split(/\s+/).forEach(w => dictionary.add(w.toLowerCase()));
                b.author.split(/\s+/).forEach(w => dictionary.add(w.toLowerCase()));
                if (b.category) dictionary.add(b.category.toLowerCase());
                if (b.tags) b.tags.forEach(t => dictionary.add(t.toLowerCase()));
            });

            let corrected = false;
            const newTokens = tokens.map(token => {
                if (dictionary.has(token)) return token; // already valid
                
                let bestMatch = token;
                let minEdit = Infinity;

                dictionary.forEach(word => {
                    const dist = this._levenshtein(token, word);
                    if (dist < minEdit && dist <= 2) {
                        minEdit = dist;
                        bestMatch = word;
                    }
                });

                if (bestMatch !== token) corrected = true;
                return bestMatch;
            });

            return corrected ? newTokens.join(' ') : null;
        }

        /**
         * Filter results based on provided filters object
         */
        filterResults(results, filters) {
            if (!filters || Object.keys(filters).length === 0) return results;

            return results.filter(item => {
                const book = item.book || item; // Handle both scored wrappers and plain book objects
                
                if (filters.department && filters.department !== 'all') {
                    if (!book.department || book.department.toLowerCase() !== filters.department.toLowerCase()) return false;
                }
                if (filters.semester && filters.semester !== 'all') {
                    if (book.semester != filters.semester) return false;
                }
                if (filters.category && filters.category !== 'all') {
                    const filterCat = filters.category.toLowerCase();
                    const bookCat = (book.category || '').toLowerCase();
                    const bookDept = (book.department || '').toLowerCase();
                    // Match category or department or tag
                    const matchesCategory = bookCat.includes(filterCat) || filterCat.includes(bookCat) || bookDept.includes(filterCat);
                    if (!matchesCategory) return false;
                }
                if (filters.language && filters.language !== 'all') {
                    if (!book.language || book.language.toLowerCase() !== filters.language.toLowerCase()) return false;
                }
                if (filters.availability && filters.availability !== 'all') {
                    const available = (book.availableCopies || 0) > 0;
                    if (filters.availability === 'available' && !available) return false;
                }
                return true;
            });
        }

        /**
         * Perform search on library data
         */
        search(query, filters = {}) {
            if (!this.initialized) this.init();
            const startTime = performance.now();
            
            const parsedData = this._parseNL(query);
            const tokens = this._tokenize(query);
            
            let scoredResults = [];

            if (tokens.length === 0 && !parsedData.author && !parsedData.category && !parsedData.isbn && !parsedData.semester && !parsedData.department) {
                // Return all books if empty query (just apply filters/sort)
                scoredResults = this.books.map(b => ({ book: b, score: 1 }));
            } else {
                for (const book of this.books) {
                    let baseScore = this._scoreBook(book, tokens, parsedData);
                    let finalScore = this._boostScore(baseScore, book);
                    if (finalScore > 0) {
                        scoredResults.push({ book, score: finalScore });
                    }
                }
            }

            // Apply Sort
            const sortBy = filters.sortBy || 'relevance';
            scoredResults.sort((a, b) => {
                if (sortBy === 'relevance') return b.score - a.score;
                if (sortBy === 'title') return a.book.title.localeCompare(b.book.title);
                if (sortBy === 'author') return a.book.author.localeCompare(b.book.author);
                if (sortBy === 'rating') return (b.book.rating || 0) - (a.book.rating || 0);
                if (sortBy === 'newest') {
                    const dateA = a.book.addedDate ? new Date(a.book.addedDate).getTime() : 0;
                    const dateB = b.book.addedDate ? new Date(b.book.addedDate).getTime() : 0;
                    return dateB - dateA;
                }
                if (sortBy === 'popular') return (b.book.borrowCount || 0) - (a.book.borrowCount || 0);
                return b.score - a.score;
            });

            // Extract books from scored wrappers
            let finalResults = scoredResults.map(r => r.book);

            // Apply Filters
            finalResults = this.filterResults(finalResults, filters);

            const searchTime = performance.now() - startTime;
            
            // Did you mean
            let didYouMean = null;
            if (finalResults.length === 0 && query && query.length > 2) {
                didYouMean = this._getDidYouMean(query);
            }

            // Record history if query is not empty
            if (query && query.trim().length > 0) {
                this.addToHistory(query);
            }

            return {
                results: finalResults,
                totalResults: finalResults.length,
                searchTime: searchTime.toFixed(2),
                suggestions: this.getRelatedSearches(query),
                didYouMean: didYouMean
            };
        }

        /**
         * Autocomplete suggestions for search input
         */
        autocomplete(query) {
            if (!this.initialized) this.init();
            if (!query || query.length < 2) return [];

            const lowerQuery = query.toLowerCase();
            const suggestions = [];
            const seen = new Set();

            const addSuggestion = (text, type, icon) => {
                if (!seen.has(text.toLowerCase()) && suggestions.length < 8) {
                    seen.add(text.toLowerCase());
                    suggestions.push({ text, type, icon });
                }
            };

            // 1. Check departments
            const depts = this.getAvailableFilters().departments;
            depts.forEach(d => {
                if (d.toLowerCase().includes(lowerQuery)) addSuggestion(d, 'Department', '🏫');
            });

            // 2. Check categories
            const cats = this.getAvailableFilters().categories;
            cats.forEach(c => {
                if (c.toLowerCase().includes(lowerQuery)) addSuggestion(c, 'Category', '📑');
            });

            // 3. Check authors
            this.books.forEach(b => {
                if (b.author && b.author.toLowerCase().includes(lowerQuery)) {
                    addSuggestion(b.author, 'Author', '👤');
                }
            });

            // 4. Check titles (prefix match prioritized)
            this.books.forEach(b => {
                if (b.title && b.title.toLowerCase().startsWith(lowerQuery)) {
                    addSuggestion(b.title, 'Book', '📖');
                }
            });
            this.books.forEach(b => {
                if (b.title && b.title.toLowerCase().includes(lowerQuery) && !b.title.toLowerCase().startsWith(lowerQuery)) {
                    addSuggestion(b.title, 'Book', '📖');
                }
            });

            return suggestions;
        }

        /**
         * Manage Search History
         */
        addToHistory(query) {
            if (!query) return;
            const q = query.trim();
            let history = this.getHistory();
            // Remove if exists to move to front
            history = history.filter(item => item.toLowerCase() !== q.toLowerCase());
            history.unshift(q);
            if (history.length > 20) history = history.slice(0, 20);
            localStorage.setItem('searchHistory', JSON.stringify(history));
        }

        getHistory() {
            try {
                return JSON.parse(localStorage.getItem('searchHistory')) || [];
            } catch (e) {
                return [];
            }
        }

        clearHistory() {
            localStorage.removeItem('searchHistory');
        }

        /**
         * Get popular searches from LibraryData
         */
        getPopularSearches() {
            if (window.LibraryData && window.LibraryData.analytics && window.LibraryData.analytics.popularSearches) {
                return window.LibraryData.analytics.popularSearches;
            }
            return ['Artificial Intelligence', 'Data Structures', 'Algorithms', 'Web Development'];
        }

        /**
         * Generate related searches
         */
        getRelatedSearches(query) {
            if (!query || query.length < 3) return [];
            const tokens = this._tokenize(query);
            if (tokens.length === 0) return [];
            
            // Simple heuristic: return categories or tags that match tokens
            const related = new Set();
            this.books.forEach(b => {
                if (b.category && tokens.some(t => b.category.toLowerCase().includes(t))) {
                    related.add(`${b.category} books`);
                }
                if (b.tags) {
                    b.tags.forEach(tag => {
                        if (tokens.some(t => tag.toLowerCase().includes(t))) {
                            related.add(tag);
                        }
                    });
                }
            });
            return Array.from(related).slice(0, 5);
        }

        /**
         * Highlight matched text in results
         */
        highlightText(text, query) {
            if (!text || !query) return text;
            const tokens = this._tokenize(query);
            if (tokens.length === 0) return text;

            let highlighted = text;
            // Sort by length desc to prevent partial replacements of larger tokens
            tokens.sort((a, b) => b.length - a.length);

            tokens.forEach(token => {
                if (token.length < 3) return; // Skip very short tokens to avoid over-highlighting
                const regex = new RegExp(`(${token})`, 'gi');
                highlighted = highlighted.replace(regex, '<mark>$1</mark>');
            });

            return highlighted;
        }

        /**
         * Get available filter options from the dataset
         */
        getAvailableFilters() {
            if (!this.initialized) this.init();
            
            const departments = new Set();
            const categories = new Set();
            const semesters = new Set();
            const languages = new Set();

            this.books.forEach(b => {
                if (b.department) departments.add(b.department);
                if (b.category) categories.add(b.category);
                if (b.semester) semesters.add(b.semester);
                if (b.language) languages.add(b.language);
            });

            return {
                departments: Array.from(departments).sort(),
                categories: Array.from(categories).sort(),
                semesters: Array.from(semesters).sort((a, b) => a - b),
                languages: Array.from(languages).sort()
            };
        }
    }

    // Expose globally
    window.SearchEngine = new SearchEngineClass();

})();
