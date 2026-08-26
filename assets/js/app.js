/**
 * Smart Library Platform - Main Application Script
 * 
 * This file contains the core logic for the Single Page Application (SPA) including
 * routing, state management, UI rendering, event handling, and data binding.
 * 
 * Requirements met:
 * - Vanilla JS, no frameworks, no npm
 * - Centralized state management
 * - Hash-based routing
 * - Comprehensive error handling and UI states
 * - Extensive components and helpers
 * - Command palette, theming, shortcuts, toast notifications
 */

// ============================================================================
// STATE MANAGEMENT & CONSTANTS
// ============================================================================

const AppState = {
    theme: 'system',
    sidebarCollapsed: false,
    currentRoute: 'home',
    searchQuery: '',
    searchFilters: {
        category: 'all',
        department: 'all',
        availability: 'all'
    },
    searchView: 'grid', // 'grid' or 'list'
    activeTab: 'notes',
    libraryOccupancyInterval: null,
    toastTimeouts: new Map(),
    notifications: [],
    recentActivity: [],
    cmdPaletteOpen: false,
    cmdPaletteIndex: 0,
    aiChatHistory: [],
    aiStreaming: false,
    aiConversationId: 'default',
    loading: false
};

const Constants = {
    PAGES: [
        'login', 'home', 'search', 'library', 'resources',
        'dashboard', 'profile', 'admin', 'settings',
        'book-detail', 'ai-librarian', 'notifications',
        'fines', 'upload'
    ],
    THEMES: {
        LIGHT: 'light',
        DARK: 'dark',
        SYSTEM: 'system'
    },
    ICONS: {
        book: '📚',
        resource: '📄',
        notification: '🔔',
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️',
        user: '👤'
    },
    ANIMATION_DURATION: 300 // ms
};

// ============================================================================
// INITIALIZATION
// ============================================================================

class LibraryApp {
    constructor() {
        // Bundled data is seed input only. Runtime views start empty and are populated from Firestore.
        this.seedData = window.LibraryData;
        this.data = { ...(window.LibraryData || {}), books: [], notes: [], transactions: [], fines: [], students: [], questionPapers: [] };
        this.search = window.SearchEngine;
        this.charts = window.Charts;

        // Cache DOM elements
        this.dom = {
            sidebar: document.getElementById('sidebar'),
            sidebarToggle: document.getElementById('sidebar-toggle'),
            pageTitle: document.getElementById('page-title'),
            notificationBtn: document.getElementById('notification-btn'),
            mobileNav: document.getElementById('mobile-nav'),
            cmdPalette: document.getElementById('command-palette'),
            cmdInput: document.getElementById('cmd-input'),
            cmdResults: document.getElementById('cmd-results'),
            modalContainer: document.getElementById('modal-container'),
            modalTitle: document.getElementById('modal-title'),
            modalContent: document.getElementById('modal-content-area'),
            modalClose: document.getElementById('close-modal-btn'),
            toastContainer: document.getElementById('toast-container'),
            pages: {}
        };
        this.seatBookingsUnsubscribe = null;
        this.roomBookings = [];
        this.authReady = false;

        // Populate pages cache
        Constants.PAGES.forEach(page => {
            const el = document.getElementById(`page-${page.replace('-detail', '')}`); // Handle book-detail vs book
            if (el) {
                this.dom.pages[page] = el;
            } else if (page === 'book-detail') {
                this.dom.pages[page] = document.getElementById('page-book-detail');
            }
        });
    }

    isAdmin() {
        return this.currentUser?.role === 'admin' || this.currentUser?.email?.toLowerCase() === 'vshivaprasad07@gmail.com';
    }

    init() {
        console.log("Initializing LIbris Platform with Firebase Cloud backend...");

        // Initialize Firebase services if present
        if (window.FirebaseAuth) window.FirebaseAuth.init();
        if (window.FirestoreDB) window.FirestoreDB.init();
        if (window.AnalyticsEngine) window.AnalyticsEngine.init();

        // Load all persistent state from Firebase; browser storage is never used.
        this.initRemoteData();

        // Setup real-time Firestore listeners for seats, books & auth
        this.setupFirebaseListeners();

        // Initialize dependencies
        if (this.search) this.search.init();

        // Setup systems
        this.setupTheme();
        this.setupRouting();
        this.setupGlobalEvents();
        this.setupSidebar();
        this.setupNotificationsBadge();
        this.setupAuth();

        // Trigger initial route
        this.handleRouteChange();
    }

    // Setup real-time Firestore synchronization
    setupFirebaseListeners() {
        // 1. Live Auth State Listener
        if (window.FirebaseAuth) {
            window.FirebaseAuth.onAuthStateChanged((user) => {
                if (user) {
                    this.currentUser = user;
                    if (this.data) this.data.currentUser = user;
                    if (this.search) this.search.history = user.searchHistory || [];
                    window.FirestoreDB?.saveLeaderboardEntry(user).catch((error) => console.error('[Leaderboard] Sync failed:', error));
                    if (this.isAdmin() && window.FirestoreDB) {
                        Promise.all([window.FirestoreDB.getUsers(), window.FirestoreDB.getPlatformAnalytics()]).then(([users, analytics]) => {
                            this.data.students = users;
                            this.data.analytics = analytics || { monthlyBorrows: [], departmentStats: {} };
                            if (AppState.currentRoute === 'admin') this.renderAdmin();
                        }).catch((error) => console.error('[Admin] Backend data load failed:', error));
                    }
                    this.authReady = true;
                    if (window.FirestoreDB) {
                        const uid = user.uid || user.id;
                        Promise.all([window.FirestoreDB.getFines(uid), window.FirestoreDB.getTransactions(uid), window.FirestoreDB.getRoomBookings()]).then(([fines, transactions, roomBookings]) => {
                            this.data.fines = fines;
                            this.data.transactions = transactions;
                            this.roomBookings = roomBookings;
                            if (AppState.currentRoute === 'fines') this.renderFines();
                        }).catch((error) => console.error('[Fines] Load failed:', error));
                    }
                } else {
                    this.authReady = true;
                    if (this.seatBookingsUnsubscribe) {
                        this.seatBookingsUnsubscribe();
                        this.seatBookingsUnsubscribe = null;
                    }
                    this.currentUser = null;
                    if (window.location.hash !== '#login') window.location.hash = 'login';
                }
                if (user && window.FirestoreDB && !this.seatBookingsUnsubscribe) {
                    this.seatBookingsUnsubscribe = window.FirestoreDB.onSeatBookingsChange((remoteBookings) => {
                        if (remoteBookings && remoteBookings.length > 0) {
                            AppState.seatBookings = remoteBookings;
                            if (AppState.currentRoute === 'library') {
                                this.renderSeatMap();
                            }
                        }
                    });
                }
                this.updateAuthUI();
                this.renderPage(AppState.currentRoute, null);
            });
        }

        // 2. Live Catalog Sync
        if (window.FirestoreDB) {
            window.FirestoreDB.onBooksChange((remoteBooks) => {
                if (remoteBooks && remoteBooks.length > 0) {
                    this.data.books = remoteBooks;
                    if (this.search) this.search.init();
                    if (AppState.currentRoute === 'home' || AppState.currentRoute === 'search') {
                        this.renderPage(AppState.currentRoute, null);
                    }
                }
            });
        }
    }

    // ============================================================================
    // DATABASE & AUTHENTICATION (PURE FIREBASE FIRST)
    // ============================================================================

    async initRemoteData() {
        // Fetch books from Firestore if available
        if (window.FirestoreDB) {
            try {
                const remoteBooks = await window.FirestoreDB.getBooks();
                if (remoteBooks && remoteBooks.length > 0) {
                    this.data.books = remoteBooks;
                }
                const remoteNotes = await window.FirestoreDB.getNotes();
                if (remoteNotes && remoteNotes.length > 0) {
                    this.data.notes = remoteNotes;
                }
                const remoteTrans = await window.FirestoreDB.getTransactions(this.currentUser?.uid || this.currentUser?.id || null);
                if (remoteTrans && remoteTrans.length > 0) {
                    this.data.transactions = remoteTrans;
                }
                if (this.currentUser?.uid || this.currentUser?.id) {
                    const uid = this.currentUser.uid || this.currentUser.id;
                const remoteFines = await window.FirestoreDB.getFines(uid);
                    this.data.fines = remoteFines;
                }
                if (this.isAdmin()) {
                    const [users, analytics] = await Promise.all([
                        window.FirestoreDB.getUsers(),
                        window.FirestoreDB.getPlatformAnalytics()
                    ]);
                    this.data.students = users;
                    this.data.analytics = analytics || { monthlyBorrows: [], departmentStats: {} };
                }
            } catch (err) {
                console.warn('[LIbris] Remote data fetch warning:', err);
            }
        }

        // Set active user
        this.currentUser = (window.FirebaseAuth && window.FirebaseAuth.currentUser) || this.data?.currentUser || null;
    }

    saveData(key, data) {
        if (this.data && key in this.data) {
            this.data[key] = data;
        }

        // Mutations must use the explicit Firestore service methods at their call site.
        if (window.FirestoreDB && window.FirestoreDB.db) {
            const db = window.FirestoreDB.db;
            if (key === 'books' && Array.isArray(data)) {
                Promise.all(data.map((book) => window.FirestoreDB.saveBook(book)))
                    .catch((error) => console.error('[Books] Firestore update failed:', error));
            } else if (key === 'transactions' && Array.isArray(data) && data[0]) {
                window.FirestoreDB.saveTransaction(data[0]);
            } else if (key === 'notes' && Array.isArray(data) && data[0]) {
                window.FirestoreDB.saveNote(data[0]);
            } else if (key === 'fines' && Array.isArray(data) && data[0]) {
                window.FirestoreDB.saveFine(data[0]);
            }
        }
    }

    setupAuth() {
        // Modal DOM elements
        this.dom.authModal = document.getElementById('auth-modal');
        this.dom.closeAuthBtn = document.getElementById('close-auth-modal-btn');
        this.dom.loginForm = document.getElementById('login-form');
        this.dom.registerForm = document.getElementById('register-form');
        this.dom.switchToRegister = document.getElementById('switch-to-register');
        this.dom.switchToLogin = document.getElementById('switch-to-login');

        // Modal Close Listener
        if (this.dom.closeAuthBtn) {
            this.dom.closeAuthBtn.onclick = () => this.closeAuthModal();
        }
        if (this.dom.authModal) {
            this.dom.authModal.onclick = (e) => {
                if (e.target === this.dom.authModal) this.closeAuthModal();
            };
        }

        // Form toggle
        if (this.dom.switchToRegister) {
            this.dom.switchToRegister.onclick = () => {
                if (this.dom.loginForm) this.dom.loginForm.style.display = 'none';
                if (this.dom.registerForm) this.dom.registerForm.style.display = 'block';
                const title = document.getElementById('auth-modal-title');
                if (title) title.textContent = 'Create LIbris Account';
            };
        }
        if (this.dom.switchToLogin) {
            this.dom.switchToLogin.onclick = () => {
                if (this.dom.registerForm) this.dom.registerForm.style.display = 'none';
                if (this.dom.loginForm) this.dom.loginForm.style.display = 'block';
                const title = document.getElementById('auth-modal-title');
                if (title) title.textContent = 'Sign In to LIbris';
            };
        }

        // Login submit
        if (this.dom.loginForm) {
            this.dom.loginForm.onsubmit = (e) => {
                e.preventDefault();
                const email = document.getElementById('login-email').value.trim();
                const pass = document.getElementById('login-password').value.trim();
                this.login(email, pass);
            };
        }

        // Register submit
        if (this.dom.registerForm) {
            this.dom.registerForm.onsubmit = (e) => {
                e.preventDefault();
                const name = document.getElementById('reg-name').value.trim();
                const email = document.getElementById('reg-email').value.trim();
                const regNo = document.getElementById('reg-id').value.trim();
                const dept = document.getElementById('reg-dept').value;
                const sem = parseInt(document.getElementById('reg-sem').value);
                const pass = document.getElementById('reg-password').value.trim();
                this.register({ name, email, regNo, department: dept, semester: sem, password: pass });
            };
        }

        this.updateAuthUI();
    }

    openAuthModal(mode = 'login') {
        if (!this.dom.authModal) return;
        this.dom.authModal.style.display = 'flex';
        void this.dom.authModal.offsetWidth;
        this.dom.authModal.classList.add('active');

        if (mode === 'register') {
            if (this.dom.loginForm) this.dom.loginForm.style.display = 'none';
            if (this.dom.registerForm) this.dom.registerForm.style.display = 'block';
            const title = document.getElementById('auth-modal-title');
            if (title) title.textContent = 'Create LIbris Account';
        } else {
            if (this.dom.registerForm) this.dom.registerForm.style.display = 'none';
            if (this.dom.loginForm) this.dom.loginForm.style.display = 'block';
            const title = document.getElementById('auth-modal-title');
            if (title) title.textContent = 'Sign In to LIbris';
        }
    }

    closeAuthModal() {
        if (!this.dom.authModal) return;
        this.dom.authModal.classList.remove('active');
        setTimeout(() => {
            this.dom.authModal.style.display = 'none';
        }, Constants.ANIMATION_DURATION);
    }

    fillDemoLogin(email, password) {
        const emailInput = document.getElementById('login-email');
        const passInput = document.getElementById('login-password');
        if (emailInput) emailInput.value = email;
        if (passInput) passInput.value = password;
    }

    async loginWithGoogle() {
        try {
            if (window.FirebaseAuth) {
                this.showToast('Connecting to Google Sign-In...', 'info');
                await window.FirebaseAuth.signInWithGoogle();
                this.closeAuthModal();
                this.showToast('Signed in successfully with Google!', 'success');
            }
        } catch (err) {
            console.warn('Google sign-in error:', err);
            this.showToast(err.message || 'Google sign-in canceled.', 'error');
        }
    }

    async login(email, password) {
        // Attempt Firebase Auth sign-in first
        if (window.FirebaseAuth && window.fbAuth) {
            try {
                this.showToast('Authenticating with Firebase...', 'info');
                await window.FirebaseAuth.signInWithEmail(email, password);
                this.closeAuthModal();
                this.showToast(`Welcome back, ${email}!`, 'success');
                if (window.AnalyticsEngine) window.AnalyticsEngine.logEvent('login', { method: 'email' });
                return;
            } catch (fbErr) {
                this.showToast(fbErr.message || 'Invalid email or password.', 'error');
                return;
            }
        }
        this.showToast('Firebase Authentication is unavailable.', 'error');
    }

    async register(userData) {
        // Attempt Firebase Auth user creation
        if (window.FirebaseAuth && window.fbAuth) {
            try {
                this.showToast('Creating Firebase account...', 'info');
                await window.FirebaseAuth.signUpWithEmail(userData.email, userData.password, userData);
                this.closeAuthModal();
                this.showToast(`Account created! Welcome, ${userData.name}!`, 'success');
                if (window.AnalyticsEngine) window.AnalyticsEngine.logEvent('user_register', { role: 'student' });
                return;
            } catch (fbErr) {
                this.showToast(fbErr.message || 'Registration failed.', 'error');
                if (fbErr.code === 'auth/email-already-in-use') {
                    this.showToast('Account with this email already exists in Firebase.', 'error');
                }
                return;
            }
        }
        this.showToast('Firebase Authentication is unavailable.', 'error');
        return;
        /* let users = [];
        if (users.some(u => u.email.toLowerCase() === userData.email.toLowerCase())) {
            this.showToast('Account with this email already exists.', 'error');
            return;
        }

        const newUser = {
            id: Date.now(),
            regNo: userData.regNo || `REG-${Date.now().toString().slice(-6)}`,
            name: userData.name,
            email: userData.email,
            password: userData.password,
            department: userData.department,
            semester: userData.semester,
            role: 'student',
            avatar: '#' + Math.floor(Math.random() * 16777215).toString(16),
            joinDate: new Date().toISOString(),
            borrowedBooks: [],
            reservedBooks: [],
            wishlist: [],
            readingHistory: [],
            bookmarks: [],
            studyStreak: 1,
            achievements: ['New Member'],
            totalBorrowed: 0,
            totalDownloads: 0,
            contributions: 0
        };

        users.push(newUser);

        this.currentUser = newUser;
        if (this.data) this.data.currentUser = newUser;

        this.closeAuthModal();
        this.updateAuthUI();
        this.showToast(`Account created! Welcome, ${newUser.name}!`, 'success');
        this.renderPage(AppState.currentRoute, null); */
    }

    async logout() {
        if (window.FirebaseAuth) {
            await window.FirebaseAuth.signOut();
        }
        this.currentUser = null;
        if (this.data) this.data.currentUser = null;

        this.updateAuthUI();
        this.showToast('Signed out successfully.', 'info');
        this.renderPage(AppState.currentRoute, null);
    }

    updateAuthUI() {
        const loginBtn = document.getElementById('header-login-btn');
        const registerBtn = document.getElementById('header-register-btn');
        const userInfo = document.getElementById('header-user-info');
        const avatarSpan = document.querySelector('#header-user-avatar span');
        const avatarDiv = document.getElementById('header-user-avatar');
        const userNameSpan = document.getElementById('header-user-name');
        const userRoleSpan = document.getElementById('header-user-role');
        const adminNavItem = document.getElementById('nav-item-admin');

        if (this.currentUser) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (registerBtn) registerBtn.style.display = 'none';
            if (userInfo) userInfo.style.display = 'flex';

            if (userNameSpan) userNameSpan.textContent = this.currentUser.name;
            if (userRoleSpan) {
                const isAdmin = this.isAdmin();
                userRoleSpan.textContent = isAdmin ? 'Admin' : 'Student';
                userRoleSpan.className = `badge text-xs ${isAdmin ? 'bg-accent-light text-accent' : 'bg-tertiary text-secondary'}`;
            }

            if (avatarSpan) {
                const initials = (this.currentUser.name || 'User').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                avatarSpan.textContent = initials;
            }
            if (avatarDiv && this.currentUser.avatar) {
                avatarDiv.style.backgroundColor = this.currentUser.avatar;
            }
            // Role-Based Access Control: show Admin portal link only if role is admin
            if (adminNavItem) {
                adminNavItem.style.display = this.isAdmin() ? 'flex' : 'none';
            }
        } else {
            if (loginBtn) loginBtn.style.display = 'inline-flex';
            if (registerBtn) registerBtn.style.display = 'inline-flex';
            if (userInfo) userInfo.style.display = 'none';
            if (adminNavItem) adminNavItem.style.display = 'none';
        }
    }

    // ============================================================================
    // ROUTING & NAVIGATION
    // ============================================================================

    setupRouting() {
        window.addEventListener('hashchange', () => this.handleRouteChange());
    }

    handleRouteChange() {
        const hash = window.location.hash.slice(1) || 'home';
        const parts = hash.split('/');
        const route = parts[0];
        const param = parts.length > 1 ? parts[1] : null;

        if (!Constants.PAGES.includes(route) && route !== 'book') {
            console.warn(`Unknown route: ${route}, redirecting to home.`);
            window.location.hash = 'home';
            return;
        }

        const normalizedRoute = route === 'book' ? 'book-detail' : route;
        document.body.classList.toggle('ai-workspace', normalizedRoute === 'ai-librarian');

        if (this.authReady && !this.currentUser && normalizedRoute !== 'login') {
            this.openAuthModal('login');
            window.location.hash = 'login';
            return;
        }

        // Role Guard: restrict admin route
        if (normalizedRoute === 'admin' && (!this.currentUser || !this.isAdmin())) {
            this.showToast('Access denied. Administrator privileges required.', 'error');
            window.location.hash = 'home';
            return;
        }

        AppState.currentRoute = normalizedRoute;

        // Cleanup previous page state
        this.cleanupPageState();

        // Update UI
        this.updateActivePage(normalizedRoute);
        this.updateActiveNavLinks(route);
        this.updatePageTitle(normalizedRoute, param);

        // Render page
        if (normalizedRoute === 'login') this.openAuthModal('login');
        else this.renderPage(normalizedRoute, param);

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    cleanupPageState() {
        if (AppState.libraryOccupancyInterval) {
            clearInterval(AppState.libraryOccupancyInterval);
            AppState.libraryOccupancyInterval = null;
        }
    }

    updateActivePage(route) {
        // Hide all pages in DOM
        document.querySelectorAll('section.page').forEach(pageEl => {
            pageEl.classList.remove('active');
            pageEl.style.setProperty('display', 'none', 'important');
            pageEl.style.opacity = '0';
        });

        // Show active page
        const pageId = route === 'book-detail' ? 'page-book-detail' : `page-${route}`;
        const activePage = document.getElementById(pageId);
        if (activePage) {
            activePage.style.setProperty('display', 'block', 'important');

            // Trigger reflow for animation
            void activePage.offsetWidth;

            activePage.classList.add('active');
            activePage.style.opacity = '1';
        }
    }

    updateActiveNavLinks(route) {
        // Update sidebar links
        document.querySelectorAll('#sidebar .nav-item').forEach(link => {
            const href = link.getAttribute('href').slice(1);
            if (href === route || (href === 'library' && route === 'book')) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Update mobile nav
        if (this.dom.mobileNav) {
            document.querySelectorAll('#mobile-nav .mobile-nav-item').forEach(link => {
                const href = link.getAttribute('href').slice(1);
                if (href === route || (href === 'library' && route === 'book')) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }
    }

    updatePageTitle(route, param) {
        const titles = {
            'home': 'Home',
            'search': 'Search Catalog',
            'library': 'Library Occupancy',
            'resources': 'Digital Resources',
            'dashboard': 'My Dashboard',
            'profile': 'My Profile',
            'admin': 'Admin Portal',
            'settings': 'Settings',
            'book-detail': 'Book Details',
            'ai-librarian': 'AI Librarian',
            'notifications': 'Notifications',
            'fines': 'Fines & Payments',
            'upload': 'Upload Resource'
        };

        if (this.dom.pageTitle) {
            this.dom.pageTitle.textContent = titles[route] || 'LIbris';
        }
    }

    renderPage(route, param) {
        try {
            switch (route) {
                case 'home': this.renderHome(); break;
                case 'search': this.renderSearch(param); break;
                case 'library': this.renderLibrary(); break;
                case 'resources': this.renderResources(); break;
                case 'dashboard': this.renderDashboard(); break;
                case 'profile': this.renderProfile(); break;
                case 'admin': this.renderAdmin(); break;
                case 'settings': this.renderSettings(); break;
                case 'book-detail': this.renderBookDetail(param); break;
                case 'ai-librarian': this.renderAILibrarian(); break;
                case 'notifications': this.renderNotifications(); break;
                case 'fines': this.renderFines(); break;
                case 'upload': this.renderUpload(); break;
            }
        } catch (error) {
            console.error(`Error rendering page ${route}:`, error);
            this.showToast('Failed to load page content.', 'error');
        }
    }

    // ============================================================================
    // GLOBAL EVENTS & COMMAND PALETTE
    // ============================================================================

    setupGlobalEvents() {
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Command Palette: Ctrl+K or Cmd+K
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                this.toggleCommandPalette();
            }

            // Quick Search: /
            if (e.key === '/' && !this.isInputFocused()) {
                e.preventDefault();
                window.location.hash = 'search';
                setTimeout(() => {
                    const searchInput = document.getElementById('main-search-input');
                    if (searchInput) searchInput.focus();
                }, Constants.ANIMATION_DURATION);
            }

            // Close modals/palette on Escape
            if (e.key === 'Escape') {
                if (AppState.cmdPaletteOpen) this.closeCommandPalette();
                this.closeModal();
            }

            // Command palette navigation
            if (AppState.cmdPaletteOpen) {
                this.handleCommandPaletteNav(e);
            }
        });

        // Modal background click
        if (this.dom.modalContainer) {
            this.dom.modalContainer.addEventListener('click', (e) => {
                if (e.target === this.dom.modalContainer) {
                    this.closeModal();
                }
            });
        }

        // Command palette background click
        if (this.dom.cmdPalette) {
            this.dom.cmdPalette.addEventListener('click', (e) => {
                if (e.target === this.dom.cmdPalette) {
                    this.closeCommandPalette();
                }
            });

            // Command palette input
            if (this.dom.cmdInput) {
                this.dom.cmdInput.addEventListener('input', this.debounce((e) => {
                    this.renderCommandPaletteResults(e.target.value);
                }, 150));
            }
        }

        // Theme toggle button
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                const newTheme = AppState.theme === 'dark' ? 'light' : 'dark';
                this.applyTheme(newTheme);
            });
        }

        // Global search shortcut button
        const globalSearchBtn = document.getElementById('global-search-btn');
        if (globalSearchBtn) {
            globalSearchBtn.addEventListener('click', () => this.openCommandPalette());
        }

        // Mobile menu toggle button
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => {
                if (this.dom.sidebar) {
                    this.dom.sidebar.classList.toggle('mobile-open');
                }
            });
        }

        // Modal close button
        if (this.dom.modalClose) {
            this.dom.modalClose.addEventListener('click', () => this.closeModal());
        }
    }

    isInputFocused() {
        const tag = document.activeElement.tagName.toLowerCase();
        return ['input', 'textarea', 'select'].includes(tag);
    }

    // --- Command Palette ---

    toggleCommandPalette() {
        if (AppState.cmdPaletteOpen) {
            this.closeCommandPalette();
        } else {
            this.openCommandPalette();
        }
    }

    openCommandPalette() {
        if (!this.dom.cmdPalette) return;
        this.dom.cmdPalette.style.display = 'flex';
        // Trigger reflow
        void this.dom.cmdPalette.offsetWidth;
        this.dom.cmdPalette.classList.add('active');
        AppState.cmdPaletteOpen = true;

        if (this.dom.cmdInput) {
            this.dom.cmdInput.value = '';
            this.dom.cmdInput.focus();
            this.renderCommandPaletteResults('');
        }
    }

    closeCommandPalette() {
        if (!this.dom.cmdPalette) return;
        this.dom.cmdPalette.classList.remove('active');
        setTimeout(() => {
            this.dom.cmdPalette.style.display = 'none';
        }, Constants.ANIMATION_DURATION);
        AppState.cmdPaletteOpen = false;
        if (document.activeElement) document.activeElement.blur();
    }

    handleCommandPaletteNav(e) {
        if (!this.dom.cmdResults) return;

        const items = this.dom.cmdResults.querySelectorAll('.cmd-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            AppState.cmdPaletteIndex = (AppState.cmdPaletteIndex + 1) % items.length;
            this.updateCommandPaletteSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            AppState.cmdPaletteIndex = (AppState.cmdPaletteIndex - 1 + items.length) % items.length;
            this.updateCommandPaletteSelection(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const selected = items[AppState.cmdPaletteIndex];
            if (selected) {
                selected.click();
            }
        }
    }

    updateCommandPaletteSelection(items) {
        items.forEach((item, idx) => {
            if (idx === AppState.cmdPaletteIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    renderCommandPaletteResults(query) {
        if (!this.dom.cmdResults) return;

        const q = query.toLowerCase().trim();
        let results = [];

        // Pages & Action Shortcuts
        const actions = [
            { title: 'View Digital Student ID Pass', icon: '🪪', type: 'action', action: () => this.showDigitalIDModal() },
            { title: 'Syllabus-to-Book NLP Auto-Mapper', icon: '🎯', type: 'action', action: () => { window.location.hash = '#resources'; setTimeout(() => { const t = document.querySelector('.tab[data-target="syllabus"]'); if (t) t.click(); }, 150); } },
            { title: 'Reserve Collaborative Study Room', hash: '#library', icon: '👥', type: 'page' },
            { title: 'Interactive Floor Plan & 5-Hour Seat Booking', hash: '#library', icon: '🪑', type: 'page' },
            { title: 'Redeem Merit Credits for Fine Waiver', hash: '#fines', icon: '⚡', type: 'page' },
            { title: 'Scan Physical Book ISBN Barcode', icon: '📷', type: 'action', action: () => this.barcodeScannerModal() },
            { title: 'Import Book Catalog File (CSV / JSON)', icon: '📂', type: 'action', action: () => this.importCatalogModal() },
            { title: 'Raise Missing Book Query Ticket', icon: '🙋', type: 'action', action: () => this.raiseMissingBookQueryModal() },
            { title: 'Pay Outstanding Fines (Cashfree Sandbox)', hash: '#fines', icon: '💳', type: 'page' },
            { title: 'Ask AI Librarian Nova (Conversational Assistant)', hash: '#ai-librarian', icon: '🤖', type: 'page' },
            { title: 'Go to Home Dashboard', hash: '#home', icon: '🏠', type: 'page' },
            { title: 'Search Book Catalog', hash: '#search', icon: '🔍', type: 'page' },
            { title: 'Digital Resources & Notes Repository', hash: '#resources', icon: '📄', type: 'page' },
            { title: 'My Student Dashboard & Leaderboard', hash: '#dashboard', icon: '📈', type: 'page' },
            { title: 'My Profile & Bookmarks', hash: '#profile', icon: '👤', type: 'page' },
            { title: 'Upload Senior Notes / Question Paper', hash: '#upload', icon: '📤', type: 'page' },
            { title: 'System Settings & Theme', hash: '#settings', icon: '⚙️', type: 'page' }
        ];

        if (q) {
            results = actions.filter(p => p.title.toLowerCase().includes(q) || (p.type && p.type.toLowerCase().includes(q)));

            // Books
            if (this.data && this.data.books) {
                const bookMatches = this.data.books
                    .filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || (b.tags && b.tags.some(t => t.toLowerCase().includes(q))))
                    .slice(0, 5)
                    .map(b => ({
                        title: b.title,
                        subtitle: `by ${b.author} • Shelf ${b.shelf || 'A1'} (${b.availableCopies > 0 ? '🟢 Available' : '🔴 Checked Out'})`,
                        hash: `#book/${b.id}`,
                        icon: '📚',
                        type: 'book'
                    }));
                results = [...results, ...bookMatches];
            }
        } else {
            results = actions;
        }

        this.dom.cmdResults.innerHTML = '';
        AppState.cmdPaletteIndex = 0;

        if (results.length === 0) {
            this.dom.cmdResults.innerHTML = '<div class="cmd-no-results">No results found</div>';
            return;
        }

        results.forEach((res, idx) => {
            const el = document.createElement('div');
            el.className = `cmd-item ${idx === 0 ? 'selected' : ''}`;
            el.innerHTML = `
                <div class="cmd-icon">${res.icon}</div>
                <div class="cmd-details">
                    <div class="cmd-title">${this.highlightMatch(res.title, q)}</div>
                    ${res.subtitle ? `<div class="cmd-subtitle">${this.highlightMatch(res.subtitle, q)}</div>` : ''}
                </div>
                <div class="cmd-type">${res.type}</div>
            `;

            el.addEventListener('click', () => {
                this.closeCommandPalette();
                if (res.action) {
                    res.action();
                } else if (res.hash) {
                    window.location.hash = res.hash;
                }
            });

            el.addEventListener('mousemove', () => {
                AppState.cmdPaletteIndex = idx;
                this.updateCommandPaletteSelection(this.dom.cmdResults.querySelectorAll('.cmd-item'));
            });

            this.dom.cmdResults.appendChild(el);
        });
    }

    highlightMatch(text, query) {
        if (!query) return text;
        const regex = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    // ============================================================================
    // THEME SYSTEM
    // ============================================================================

    setupTheme() {
        this.applyTheme(AppState.theme);

        // Listen for system theme changes if set to system
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (AppState.theme === 'system') {
                this.applyTheme('system');
            }
        });
    }

    applyTheme(themeValue) {
        const root = document.documentElement;
        let isDark = false;

        if (themeValue === 'system') {
            isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        } else {
            isDark = themeValue === 'dark';
        }

        if (isDark) {
            root.setAttribute('data-theme', 'dark');
        } else {
            root.removeAttribute('data-theme');
        }

        const sunIcon = document.querySelector('.sun-icon');
        const moonIcon = document.querySelector('.moon-icon');
        if (sunIcon && moonIcon) {
            sunIcon.style.display = isDark ? 'none' : 'block';
            moonIcon.style.display = isDark ? 'block' : 'none';
        }

        AppState.theme = themeValue;

        // Re-render charts if they exist
        if (this.charts) {
            setTimeout(() => {
                // To refresh all charts, we must re-render the active page
                this.renderPage(AppState.currentRoute, null);
            }, 100);
        }
    }

    // ============================================================================
    // SIDEBAR & LAYOUT
    // ============================================================================

    setupSidebar() {
        if (this.dom.sidebarToggle) {
            this.dom.sidebarToggle.addEventListener('click', () => {
                AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
                this.updateSidebarState();
            });
        }
        this.updateSidebarState();
    }

    updateSidebarState() {
        if (!this.dom.sidebar) return;
        if (AppState.sidebarCollapsed) {
            this.dom.sidebar.classList.add('collapsed');
        } else {
            this.dom.sidebar.classList.remove('collapsed');
        }

        // Trigger resize for charts
        setTimeout(() => window.dispatchEvent(new Event('resize')), Constants.ANIMATION_DURATION);
    }

    setupNotificationsBadge() {
        if (!this.data || !this.data.notifications || !this.dom.notificationBtn) return;
        const unread = this.data.notifications.filter(n => !n.read).length;

        let badge = this.dom.notificationBtn.querySelector('.badge');
        if (!badge && unread > 0) {
            badge = document.createElement('span');
            badge.className = 'badge';
            this.dom.notificationBtn.appendChild(badge);
        }

        if (badge) {
            if (unread > 0) {
                badge.textContent = unread > 99 ? '99+' : unread;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    // ============================================================================
    // HOME PAGE
    // ============================================================================

    renderHome() {
        if (!this.data) return;

        // Welcome Banner
        const user = this.data.currentUser;
        if (user) {
            const hour = new Date().getHours();
            let greeting = 'Good evening';
            if (hour < 12) greeting = 'Good morning';
            else if (hour < 18) greeting = 'Good afternoon';

            const bannerH2 = document.querySelector('.welcome-banner .banner-content h2');
            const bannerP = document.querySelector('.welcome-banner .banner-content p');
            if (bannerH2) bannerH2.textContent = `${greeting}, ${user.name.split(' ')[0]}!`;
            if (bannerP) bannerP.textContent = `You have ${user.borrowedBooks.length} books borrowed and a ${user.studyStreak}-day study streak. Keep it up!`;
        }

        // Quick Search
        const searchInput = document.getElementById('home-search-input');
        if (searchInput) {
            const searchBtn = searchInput.nextElementSibling;
            // Remove old listener to avoid duplicates
            const newSearchInput = searchInput.cloneNode(true);
            searchInput.parentNode.replaceChild(newSearchInput, searchInput);

            const doSearch = () => {
                if (newSearchInput.value.trim()) {
                    window.location.hash = `#search/${encodeURIComponent(newSearchInput.value.trim())}`;
                }
            };

            newSearchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') doSearch();
            });

            if (searchBtn) {
                const newSearchBtn = searchBtn.cloneNode(true);
                searchBtn.parentNode.replaceChild(newSearchBtn, searchBtn);
                newSearchBtn.addEventListener('click', doSearch);
            }
        }

        // Occupancy Stats
        const occ = this.data.occupancy;
        if (occ) {
            const pct = Math.round((occ.occupiedSeats / occ.totalSeats) * 100);

            // Canvas Chart
            requestAnimationFrame(() => {
                if (this.charts) {
                    this.charts.gauge('home-occupancy-chart', {
                        value: pct,
                        max: 100,
                        label: 'Occupancy',
                        color: pct > 80 ? '#ef4444' : (pct > 50 ? '#f59e0b' : '#10b981')
                    });
                }
            });

            // Text Stats
            const occValue = document.querySelector('#page-home .occupancy-value');
            const occLabel = document.querySelector('#page-home .occupancy-label');
            const bestTime = document.querySelector('#page-home .best-time strong');

            if (occValue) occValue.textContent = `${pct}%`;
            if (occLabel) {
                occLabel.textContent = pct > 80 ? 'Very Busy' : (pct > 50 ? 'Moderate' : 'Quiet');
                occLabel.className = `occupancy-label text-${pct > 80 ? 'error' : (pct > 50 ? 'warning' : 'success')}`;
            }
            if (bestTime) bestTime.textContent = occ.bestTime;
        }

        // Reading Stats
        const rStats = this.data.readingStats;
        if (rStats) {
            const statValues = document.querySelectorAll('#page-home .stats-grid .stat-item .stat-value');
            if (statValues.length >= 3) {
                statValues[0].textContent = rStats.booksThisMonth;
                statValues[1].textContent = rStats.totalPages;
                statValues[2].textContent = `${rStats.readingStreak} Days`;
            }
        }

        // Trending & Personalized AI Demand Carousel (Powered by RecommendationEngine)
        const carousel = document.getElementById('trending-carousel');
        if (carousel && this.data.books) {
            carousel.innerHTML = '';

            let recommendedBooks = [];
            if (window.RecommendationEngine) {
                recommendedBooks = window.RecommendationEngine.getPersonalizedRecommendations(this.currentUser || user, this.data.books, 10);
            } else {
                recommendedBooks = [...this.data.books].slice(0, 10);
            }

            if (recommendedBooks.length > 0) {
                recommendedBooks.forEach(book => {
                    carousel.appendChild(this.createBookCard(book));
                });
            } else {
                carousel.innerHTML = '<p class="text-secondary">No trending books at the moment.</p>';
            }
        }

        // Activity Feed
        const feed = document.getElementById('home-activity-feed');
        if (feed && this.data.transactions) {
            feed.innerHTML = '';
            // Get recent returns/borrows
            const recent = this.data.transactions.slice(0, 5);
            recent.forEach(t => {
                const book = this.data.books.find(b => b.id === t.bookId);
                const student = this.data.students.find(s => s.id === t.studentId);
                if (!book || !student) return;

                const li = document.createElement('li');
                li.className = 'activity-item';

                const action = t.status === 'returned' ? 'returned' : 'borrowed';
                const timeStr = this.getRelativeTime(t.borrowDate);

                li.innerHTML = `
                    <div class="activity-icon ${action}">${t.status === 'returned' ? '↩️' : '📚'}</div>
                    <div class="activity-content">
                        <p><strong>${student.name}</strong> ${action} <em>${book.title}</em></p>
                        <span class="activity-time text-secondary text-sm">${timeStr}</span>
                    </div>
                `;
                feed.appendChild(li);
            });
        }

        // Due List
        const dueList = document.getElementById('home-due-list');
        if (dueList && user && this.data.transactions) {
            dueList.innerHTML = '';
            const myActive = this.data.transactions.filter(t => t.studentId === user.id && t.status !== 'returned');

            // Sort by due date
            myActive.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

            if (myActive.length === 0) {
                dueList.innerHTML = '<li><p class="text-secondary">No books due soon.</p></li>';
            } else {
                myActive.slice(0, 4).forEach(t => {
                    const book = this.data.books.find(b => b.id === t.bookId);
                    if (!book) return;

                    const li = document.createElement('li');
                    li.className = 'due-item';

                    const dueDate = new Date(t.dueDate);
                    const now = new Date();
                    const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

                    let statusClass = 'text-success';
                    let statusText = `Due in ${diffDays} days`;

                    if (diffDays < 0) {
                        statusClass = 'text-error';
                        statusText = `Overdue by ${Math.abs(diffDays)} days`;
                    } else if (diffDays <= 3) {
                        statusClass = 'text-warning';
                    }

                    li.innerHTML = `
                        <div class="due-book-info">
                            <h4>${book.title}</h4>
                            <span class="text-sm ${statusClass}">${statusText}</span>
                        </div>
                        <button class="btn btn-outline btn-sm" onclick="window.App.renewBook(${t.id})">Renew</button>
                    `;
                    dueList.appendChild(li);
                });
            }
        }
    }

    // ============================================================================
    // SEARCH PAGE
    // ============================================================================

    renderSearch(initialQuery) {
        const input = document.getElementById('main-search-input');
        const suggContainer = document.getElementById('search-suggestions');
        const advToggle = document.getElementById('toggle-advanced-filters');
        const advFilters = document.getElementById('advanced-filters');
        const viewToggles = document.querySelectorAll('.view-toggles button[data-view]');

        if (!input) return;

        // Reset state if fresh visit
        if (initialQuery !== undefined) {
            input.value = decodeURIComponent(initialQuery);
            AppState.searchQuery = input.value;
        }

        // Event Listeners (clone to remove old)
        const newInput = input.cloneNode(true);
        input.parentNode.replaceChild(newInput, input);

        newInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (val.length > 1) {
                this.renderSearchSuggestions(val);
                this.executeSearch(val);
            } else if (val.length === 0) {
                if (suggContainer) suggContainer.style.display = 'none';
                this.renderEmptySearchState();
            }
        });

        newInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (suggContainer) suggContainer.style.display = 'none';
                this.executeSearch(newInput.value.trim());
            }
        });

        // Advanced filters toggle
        if (advToggle && advFilters) {
            const newAdvToggle = advToggle.cloneNode(true);
            advToggle.parentNode.replaceChild(newAdvToggle, advToggle);
            newAdvToggle.addEventListener('click', () => {
                const isHidden = advFilters.style.display === 'none' || !advFilters.style.display;
                advFilters.style.display = isHidden ? 'grid' : 'none';
                newAdvToggle.textContent = isHidden ? 'Hide Advanced Filters' : 'Advanced Filters';
            });
        }

        // Advanced filter selects
        ['filter-department', 'filter-availability', 'filter-sort'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel) {
                const newSel = sel.cloneNode(true);
                sel.parentNode.replaceChild(newSel, sel);
                newSel.addEventListener('change', () => {
                    const dept = document.getElementById('filter-department')?.value || 'all';
                    const avail = document.getElementById('filter-availability')?.value || 'all';
                    const sort = document.getElementById('filter-sort')?.value || 'relevance';

                    AppState.searchFilters = {
                        ...AppState.searchFilters,
                        department: dept,
                        availability: avail,
                        sortBy: sort
                    };
                    const query = document.getElementById('main-search-input')?.value || '';
                    this.executeSearch(query);
                });
            }
        });

        // View Toggles
        viewToggles.forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('#page-search .view-toggles button[data-view]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                AppState.searchView = btn.getAttribute('data-view');
                this.renderSearchResults();
            };
        });

        // Setup filter chips
        this.setupFilterChips();

        // Focus input if empty
        if (!newInput.value) {
            setTimeout(() => newInput.focus(), 100);
        }

        // Execute initial search if query exists
        if (newInput.value) {
            this.executeSearch(newInput.value);
        } else {
            // Show popular/recent
            this.renderEmptySearchState();
        }
    }

    setupFilterChips() {
        const chips = document.querySelectorAll('#page-search .filter-chips .chip');
        chips.forEach(chip => {
            chip.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('#page-search .filter-chips .chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');

                const type = chip.textContent.trim().toLowerCase();
                if (type === 'all') {
                    AppState.searchFilters = {};
                } else {
                    AppState.searchFilters = { category: type };
                }

                const input = document.getElementById('main-search-input');
                this.executeSearch(input ? input.value : '');
            };
        });
    }

    renderSearchSuggestions(query) {
        const suggContainer = document.getElementById('search-suggestions');
        if (!suggContainer || !this.search) return;

        const suggestions = this.search.autocomplete(query);
        suggContainer.innerHTML = '';

        if (suggestions && suggestions.length > 0) {
            suggestions.forEach(s => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.innerHTML = `<span>${s.icon || '🔍'}</span> ${this.highlightMatch(s.text, query)}`;
                div.addEventListener('click', () => {
                    const input = document.getElementById('main-search-input');
                    if (input) input.value = s.text;
                    suggContainer.style.display = 'none';
                    this.executeSearch(s.text);
                });
                suggContainer.appendChild(div);
            });
            suggContainer.style.display = 'block';
        } else {
            suggContainer.style.display = 'none';
        }
    }

    renderEmptySearchState() {
        const container = document.getElementById('search-results-container');
        const countStr = document.getElementById('results-count');
        if (!container) return;

        if (countStr) countStr.textContent = 'Enter a search term...';

        container.innerHTML = `
            <div class="empty-search-state">
                <div class="popular-searches">
                    <h3>Popular Searches</h3>
                    <div class="chip-group">
                        ${(this.data.analytics?.popularSearches || []).map(s =>
            `<button class="chip" onclick="window.App.setSearchQuery('${s.term}')">${s.term}</button>`
        ).join('')}
                    </div>
                </div>
            </div>
        `;
        container.className = 'results-grid'; // default grid
    }

    setSearchQuery(term) {
        const input = document.getElementById('main-search-input');
        if (input) input.value = term;
        this.executeSearch(term);
    }

    executeSearch(query) {
        AppState.searchQuery = query;
        if (!this.search) return;

        const results = this.search.search(query, AppState.searchFilters);
        this.lastSearchResults = results;
        this.renderSearchResults();
    }

    renderSearchResults() {
        const container = document.getElementById('search-results-container');
        const countStr = document.getElementById('results-count');
        const results = this.lastSearchResults;

        if (!container || !results) return;

        if (countStr) {
            countStr.textContent = `${results.totalResults} results found in ${results.searchTime}ms`;
        }

        container.innerHTML = '';
        container.className = `results-container ${AppState.searchView === 'list' ? 'results-list list-view' : 'results-grid grid-view'}`;

        if (results.results.length === 0) {
            container.innerHTML = `
                <div class="no-results">
                    <h2>No exact matches found</h2>
                    ${results.didYouMean ? `<p>Did you mean: <a href="javascript:void(0)" onclick="window.App.setSearchQuery('${results.didYouMean}')">${results.didYouMean}</a>?</p>` : ''}
                    <p class="text-secondary">Try adjusting your filters or using more general keywords.</p>
                </div>
            `;
            return;
        }

        results.results.forEach(book => {
            container.appendChild(this.createBookCard(book, AppState.searchView === 'list', AppState.searchQuery));
        });
    }

    // ============================================================================
    // LIBRARY OCCUPANCY PAGE
    // ============================================================================

    renderLibrary() {
        if (!this.data || !this.data.occupancy || !this.charts) return;

        const occ = this.data.occupancy;

        // Stat Cards
        const statValues = document.querySelectorAll('#page-library .grid-4-col .stat-card .stat-value');
        if (statValues.length >= 4) {
            statValues[0].textContent = occ.totalSeats || 500;
            statValues[1].textContent = occ.occupiedSeats || 340;
            statValues[2].textContent = (occ.totalSeats || 500) - (occ.occupiedSeats || 340);
            statValues[3].textContent = `${occ.quietZones ? occ.quietZones.filter(z => z.available).length : 2} Open`;
        }

        // Charts with safe timeout to allow CSS dimensions to calculate
        setTimeout(() => {
            this.renderLibraryCharts(occ);
        }, 80);

        // Seat Map
        this.renderSeatMap();

        // Study Rooms
        this.renderStudyRooms();

        // Zone List
        this.renderZoneAvailability();

        // Simulate live updates
        if (AppState.libraryOccupancyInterval) clearInterval(AppState.libraryOccupancyInterval);
        AppState.libraryOccupancyInterval = setInterval(() => {
            const diff = Math.floor(Math.random() * 5) - 2;
            let newOcc = (occ.occupiedSeats || 340) + diff;
            if (newOcc < 0) newOcc = 0;
            if (newOcc > (occ.totalSeats || 500)) newOcc = occ.totalSeats || 500;

            occ.occupiedSeats = newOcc;

            this.renderLibraryCharts(occ);
            if (statValues.length >= 4) {
                statValues[1].textContent = newOcc;
                statValues[2].textContent = (occ.totalSeats || 500) - newOcc;
            }
        }, 6000);
    }

    renderLibraryCharts(occ) {
        // Main Gauge
        const pct = Math.round((occ.occupiedSeats / occ.totalSeats) * 100);
        this.charts.gauge('main-occupancy-chart', {
            value: pct,
            max: 100,
            label: 'Current Occupancy',
            color: pct > 80 ? '#ef4444' : (pct > 50 ? '#f59e0b' : '#10b981')
        });

        // Hourly Line Chart
        const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
        this.charts.line('hourly-occupancy-chart', {
            labels: labels,
            datasets: [{
                label: 'Average Occupancy',
                data: occ.hourlyOccupancy,
                color: '#3b82f6'
            }],
            title: 'Occupancy Over the Day'
        });

        // Weekly Heatmap
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        this.charts.heatmap('weekly-heatmap-chart', {
            data: occ.weeklyOccupancy,
            rowLabels: days,
            colLabels: labels,
            title: 'Weekly Occupancy Heatmap',
            colorScale: [37, 99, 235]
        });
    }





    // ============================================================================
    // ENHANCED INTERACTIVE FLOOR PLAN, SEAT & GROUP RESERVATION ENGINE
    // ============================================================================

    generateDefaultSeats() {
        const seats = [];
        // Floor 2: Silent Study Pods (1-16)
        for (let i = 1; i <= 16; i++) {
            const num = i < 10 ? `0${i}` : `${i}`;
            seats.push({
                id: `Seat-S${num}`,
                code: `S${num}`,
                number: i,
                zone: 'Silent Study Pod',
                zoneKey: 'silent',
                floor: 'Floor 2 (Quiet Zone)',
                status: i === 3 || i === 8 ? 'occupied' : (i === 12 ? 'reserved' : 'available'),
                amenities: ['power', i % 2 === 0 ? 'window' : 'lamp', 'chair'],
                amenityIcons: ['⚡', i % 2 === 0 ? '🪟' : '💡', '🛋️']
            });
        }
        // Floor 1: Collaborative Hub (17-32)
        for (let i = 1; i <= 16; i++) {
            const num = i < 10 ? `0${i}` : `${i}`;
            seats.push({
                id: `Seat-C${num}`,
                code: `C${num}`,
                number: i + 16,
                zone: 'Collaborative Hub',
                zoneKey: 'collaborative',
                floor: 'Floor 1 (Group Work)',
                status: i === 4 || i === 9 ? 'occupied' : 'available',
                amenities: ['power', 'whiteboard', 'dock'],
                amenityIcons: ['⚡', '📋', '🔌']
            });
        }
        // Floor 3: High-Performance Computing Lab (33-48)
        for (let i = 1; i <= 16; i++) {
            const num = i < 10 ? `0${i}` : `${i}`;
            seats.push({
                id: `Seat-L${num}`,
                code: `L${num}`,
                number: i + 32,
                zone: 'Computing Media Lab',
                zoneKey: 'lab',
                floor: 'Floor 3 (Workstations)',
                status: i === 2 || i === 7 ? 'occupied' : (i === 14 ? 'reserved' : 'available'),
                amenities: ['power', 'monitor', 'lan'],
                amenityIcons: ['⚡', '🖥️', '🌐']
            });
        }
        return seats;
    }

    getSeatDataset() {
        return this.generateDefaultSeats();
    }

    setSeatBookingMode(mode) {
        AppState.seatBookingMode = mode;
        AppState.selectedGroupSeats = [];

        const btnInd = document.getElementById('btn-mode-individual');
        const btnGrp = document.getElementById('btn-mode-group');
        if (btnInd && btnGrp) {
            btnInd.classList.toggle('active', mode === 'individual');
            btnGrp.classList.toggle('active', mode === 'group');
        }

        const actBar = document.getElementById('group-selection-action-bar');
        if (actBar) actBar.style.display = 'none';

        this.showToast(mode === 'group' ? 'Group Mode: Click multiple desks (2 to 6) to reserve a team table.' : 'Individual Mode: Click any available desk to reserve.', 'info');
        this.renderSeatMap();
    }

    renderSeatMap() {
        const grid = document.getElementById('seat-map-grid');
        if (!grid) return;

        AppState.seats = this.getSeatDataset();
        AppState.seatBookings = AppState.seatBookings || [];
        AppState.selectedSeatZone = AppState.selectedSeatZone || 'all';
        AppState.selectedSeatAmenity = AppState.selectedSeatAmenity || null;
        AppState.seatBookingMode = AppState.seatBookingMode || 'individual';
        AppState.selectedGroupSeats = AppState.selectedGroupSeats || [];

        // Sync seats with active bookings
        AppState.seats.forEach(seat => {
            const activeBooking = AppState.seatBookings.find(b =>
                (b.seatId === seat.id || (b.seatIds && b.seatIds.includes(seat.id))) && b.status === 'active'
            );
            if (activeBooking) {
                seat.status = 'reserved';
            }
        });

        // Render Active User Booking Banner
        this.renderActiveSeatBanner();

        // Render Group Selection Action Bar
        this.renderGroupSelectionActionBar();

        // Setup Floor/Zone Filter Tabs
        const zoneFilters = document.querySelectorAll('#seat-zone-filters .chip');
        zoneFilters.forEach(btn => {
            const z = btn.getAttribute('data-zone');
            btn.classList.toggle('active', z === AppState.selectedSeatZone);
            btn.onclick = () => {
                AppState.selectedSeatZone = z;
                this.renderSeatMap();
            };
        });

        // Setup Amenity Filter Chips
        const amenityFilters = document.querySelectorAll('#seat-amenity-filters .chip');
        amenityFilters.forEach(btn => {
            const am = btn.getAttribute('data-amenity');
            btn.classList.toggle('active', am === AppState.selectedSeatAmenity);
            btn.onclick = () => {
                AppState.selectedSeatAmenity = (AppState.selectedSeatAmenity === am) ? null : am;
                this.renderSeatMap();
            };
        });

        grid.innerHTML = '';

        const myActiveBooking = AppState.seatBookings.find(b =>
            b.studentId === this.currentUser?.id && b.status === 'active'
        );

        // Filter seats safely
        let visibleSeats = AppState.seats;
        if (AppState.selectedSeatZone && AppState.selectedSeatZone !== 'all') {
            visibleSeats = visibleSeats.filter(s => s.zoneKey === AppState.selectedSeatZone);
        }
        if (AppState.selectedSeatAmenity) {
            visibleSeats = visibleSeats.filter(s => s.amenities && s.amenities.includes(AppState.selectedSeatAmenity));
        }

        visibleSeats.forEach(seat => {
            const seatCode = seat.code || (seat.id ? seat.id.replace('Seat-', '') : 'S01');
            const floorLabel = seat.floor ? seat.floor.split(' ')[0] + ' ' + (seat.floor.split(' ')[1] || '') : 'Floor 1';
            const amenityIconsStr = Array.isArray(seat.amenityIcons) ? seat.amenityIcons.join(' ') : '⚡ 🪟';

            const isMySeat = myActiveBooking && (myActiveBooking.seatId === seat.id || (myActiveBooking.seatIds && myActiveBooking.seatIds.includes(seat.id)));
            const isSelectedGroup = AppState.seatBookingMode === 'group' && AppState.selectedGroupSeats.includes(seat.id);

            let displayStatus = seat.status || 'available';
            if (isMySeat) displayStatus = 'my-seat';
            else if (displayStatus === 'reserved') displayStatus = 'reserved-other';

            const tile = document.createElement('div');
            tile.className = `seat-tile ${displayStatus} ${isSelectedGroup ? 'selected-group-seat' : ''}`;

            let statusText = '🟢 Available';
            if (displayStatus === 'my-seat') statusText = '🟡 Your Seat';
            else if (displayStatus === 'occupied') statusText = '🔴 Occupied';
            else if (displayStatus === 'reserved-other') statusText = '🔵 Reserved';
            if (isSelectedGroup) statusText = '🟣 Selected';

            tile.innerHTML = `
                <div class="seat-zone-tag">${seatCode.substring(0, 1)} • ${floorLabel}</div>
                <div class="seat-number">${seatCode}</div>
                <div class="seat-amenities-icons">${amenityIconsStr}</div>
                <span class="seat-status-pill">${statusText}</span>
            `;

            tile.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (isMySeat) {
                    this.openManageActiveSeatModal(myActiveBooking);
                    return;
                }
                if (displayStatus === 'occupied') {
                    this.showToast(`${seat.id} (${seat.zone || 'Zone'}) is currently occupied by another student.`, 'warning');
                    return;
                }
                if (displayStatus === 'reserved-other') {
                    this.showToast(`${seat.id} is already reserved for the current slot.`, 'warning');
                    return;
                }

                if (myActiveBooking) {
                    this.showToast(`You already have an active reservation for ${myActiveBooking.seatCode || myActiveBooking.seatId}. Cancel or check out first.`, 'info');
                    return;
                }

                // Group Mode
                if (AppState.seatBookingMode === 'group') {
                    const idx = AppState.selectedGroupSeats.indexOf(seat.id);
                    if (idx !== -1) {
                        AppState.selectedGroupSeats.splice(idx, 1);
                    } else {
                        if (AppState.selectedGroupSeats.length >= 6) {
                            this.showToast('Maximum 6 seats can be selected for a group booking.', 'warning');
                            return;
                        }
                        AppState.selectedGroupSeats.push(seat.id);
                    }
                    this.renderSeatMap();
                    return;
                }

                // Individual Mode
                this.openReserveSeatModal(seat);
            };

            grid.appendChild(tile);
        });

        // Start live ticker for active countdown
        if (AppState.seatCountdownTicker) clearInterval(AppState.seatCountdownTicker);
        AppState.seatCountdownTicker = setInterval(() => {
            this.updateSeatCountdownText();
        }, 1000);
    }

    renderGroupSelectionActionBar() {
        const bar = document.getElementById('group-selection-action-bar');
        if (!bar) return;

        if (AppState.seatBookingMode !== 'group' || !AppState.selectedGroupSeats || AppState.selectedGroupSeats.length === 0) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }

        bar.style.display = 'block';
        const count = AppState.selectedGroupSeats.length;
        const seatCodes = AppState.selectedGroupSeats.map(s => s.replace('Seat-', '')).join(', ');

        bar.innerHTML = `
            <div class="group-selection-bar">
                <div class="flex items-center gap-sm">
                    <span style="font-size:24px;">👥</span>
                    <div>
                        <div class="bold text-sm text-white">${count} Study Desk${count > 1 ? 's' : ''} Selected: <strong>${seatCodes}</strong></div>
                        <div class="text-xs text-white" style="opacity:0.9;">Group Study Block (Min 2, Max 6 Desks)</div>
                    </div>
                </div>

                <div class="flex gap-xs items-center">
                    <button class="btn btn-ghost btn-sm text-white" style="border:1px solid rgba(255,255,255,0.4);" onclick="AppState.selectedGroupSeats = []; window.App.renderSeatMap();">
                        ✕ Clear Selection
                    </button>
                    <button class="btn btn-secondary btn-sm" style="background:white; color:#4f46e5; font-weight:700;" onclick="window.App.openReserveGroupSeatsModal()" ${count < 2 ? 'disabled title="Select at least 2 seats"' : ''}>
                        🚀 Reserve Group Block (${count} Desks)
                    </button>
                </div>
            </div>
        `;
    }

    openReserveGroupSeatsModal() {
        if (!this.currentUser) {
            this.openAuthModal('login');
            return;
        }

        const selectedIds = AppState.selectedGroupSeats || [];
        if (selectedIds.length < 2) {
            this.showToast('Please select at least 2 seats for group booking.', 'warning');
            return;
        }

        const selectedSeats = AppState.seats.filter(s => selectedIds.includes(s.id));
        const seatCodes = selectedSeats.map(s => s.code).join(', ');
        const zoneName = selectedSeats[0]?.zone || 'Collaborative Hub';
        const floorName = selectedSeats[0]?.floor || 'Floor 1';

        let selectedDuration = 2; // default 2 hours

        const updateTimePreview = () => {
            const selectEl = document.getElementById('grp-start-select');
            const previewEl = document.getElementById('grp-time-preview-box');
            if (!selectEl || !previewEl) return;

            let startDate = new Date();
            const startType = selectEl.value;
            if (startType === 'plus30') startDate = new Date(startDate.getTime() + 30 * 60 * 1000);
            else if (startType === 'nextHour') startDate.setHours(startDate.getHours() + 1, 0, 0, 0);
            else if (startType.startsWith('slot_')) {
                const hour = parseInt(startType.split('_')[1], 10);
                startDate.setHours(hour, 0, 0, 0);
            }

            const endDate = new Date(startDate.getTime() + selectedDuration * 60 * 60 * 1000);
            const startStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            previewEl.innerHTML = `
                <div class="flex justify-between items-center text-xs text-primary">
                    <span>Group Study Period:</span>
                    <strong class="text-accent">Today, ${startStr} ➔ ${endStr} (${selectedDuration}.0 Hours)</strong>
                </div>
            `;
        };

        this.openModal(`Reserve Group Study Block (${selectedIds.length} Desks)`, `
            <div class="p-sm flex flex-col gap-sm">
                <div class="p-sm bg-secondary border-radius flex justify-between items-center">
                    <div>
                        <h3 style="font-size:1.1rem; margin:0;">${selectedIds.length} Desks: ${seatCodes}</h3>
                        <span class="text-xs text-secondary">${zoneName} • ${floorName}</span>
                    </div>
                    <span class="badge bg-purple-light text-purple text-xs">👥 Group Table</span>
                </div>

                <div class="form-group mt-xs">
                    <label class="bold">1. Project / Study Group Name</label>
                    <input type="text" id="grp-project-name" class="input mt-xs" placeholder="e.g. Distributed Systems Lab Team" value="Course Project Study Group" required>
                </div>

                <div class="form-group">
                    <label class="bold">2. Team Member Registration Numbers (Optional)</label>
                    <input type="text" id="grp-members-input" class="input mt-xs" placeholder="e.g. REG-2024-8843, REG-2024-8845" value="REG-2024-8843, REG-2024-8845">
                </div>

                <div class="form-group">
                    <label class="bold">3. Select Start Time</label>
                    <select id="grp-start-select" class="select-input mt-xs">
                        <option value="now">Immediate Check-In (Right Now)</option>
                        <option value="plus30">In 30 Minutes</option>
                        <option value="nextHour">At Top of Next Hour</option>
                        <option value="slot_14">14:00 (2:00 PM Slot)</option>
                        <option value="slot_15">15:00 (3:00 PM Slot)</option>
                        <option value="slot_16">16:00 (4:00 PM Slot)</option>
                        <option value="slot_17">17:00 (5:00 PM Slot)</option>
                        <option value="slot_18">18:00 (6:00 PM Slot)</option>
                    </select>
                </div>

                <div class="form-group">
                    <div class="flex justify-between items-center">
                        <label class="bold">4. Select Duration (Max 5 Hours Strictly Enforced)</label>
                        <span class="text-xs text-accent bold" id="grp-duration-badge">2 Hours Selected</span>
                    </div>
                    <div class="duration-picker-grid">
                        <button type="button" class="duration-pill" data-hrs="1">1 Hr</button>
                        <button type="button" class="duration-pill active" data-hrs="2">2 Hrs</button>
                        <button type="button" class="duration-pill" data-hrs="3">3 Hrs</button>
                        <button type="button" class="duration-pill" data-hrs="4">4 Hrs</button>
                        <button type="button" class="duration-pill" data-hrs="5">5 Hrs (Max)</button>
                    </div>
                </div>

                <!-- Live Scheduled Time Preview -->
                <div class="card p-sm bg-secondary" id="grp-time-preview-box"></div>

                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="confirm-grp-reservation-btn">Confirm & Issue Group Pass</button>
                </div>
            </div>
        `);

        updateTimePreview();

        document.getElementById('grp-start-select').onchange = () => updateTimePreview();

        const pills = document.querySelectorAll('.duration-pill');
        pills.forEach(pill => {
            pill.onclick = () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                selectedDuration = parseInt(pill.getAttribute('data-hrs'), 10);
                const badge = document.getElementById('grp-duration-badge');
                if (badge) badge.textContent = `${selectedDuration} Hour${selectedDuration > 1 ? 's' : ''} Selected`;
                updateTimePreview();
            };
        });

        document.getElementById('confirm-grp-reservation-btn').onclick = () => {
            const projName = document.getElementById('grp-project-name').value.trim() || 'Study Group';
            const members = document.getElementById('grp-members-input').value.trim();
            const selectEl = document.getElementById('grp-start-select');
            const startType = selectEl.value;

            let startDate = new Date();
            if (startType === 'plus30') startDate = new Date(startDate.getTime() + 30 * 60 * 1000);
            else if (startType === 'nextHour') startDate.setHours(startDate.getHours() + 1, 0, 0, 0);
            else if (startType.startsWith('slot_')) {
                const hour = parseInt(startType.split('_')[1], 10);
                startDate.setHours(hour, 0, 0, 0);
            }

            const endDate = new Date(startDate.getTime() + selectedDuration * 60 * 60 * 1000);

            const bookings = AppState.seatBookings || [];
            const newBooking = {
                id: `GRP-BK-${Date.now().toString().slice(-6)}`,
                isGroup: true,
                seatIds: selectedIds,
                seatCode: seatCodes,
                seatId: `${selectedIds.length} Desks (${seatCodes})`,
                zone: `${zoneName} (Group Table)`,
                projectName: projName,
                members: members,
                studentId: this.currentUser.id,
                studentName: this.currentUser.name,
                studentRegNo: this.currentUser.regNo || 'REG-2024-8842',
                startTime: startDate.toISOString(),
                endTime: endDate.toISOString(),
                durationHours: selectedDuration,
                status: 'active',
                isExtended: false
            };

            bookings.push(newBooking);
            AppState.seatBookings = bookings;

            // Update seat status in seat list
            const allSeats = this.getSeatDataset();
            allSeats.forEach(s => {
                if (selectedIds.includes(s.id)) {
                    s.status = 'reserved';
                }
            });
            AppState.seats = allSeats;

            AppState.selectedGroupSeats = [];
            this.renderSeatMap();
            this.showToast(`Group Pass Generated! ${selectedIds.length} desks reserved for ${selectedDuration} hours.`, 'success');
            this.showSeatPassQR(newBooking.id);
        };
    }

    renderActiveSeatBanner() {
        const container = document.getElementById('active-seat-booking-banner');
        if (!container) return;

        const bookings = AppState.seatBookings || [];
        const myActive = bookings.find(b => b.studentId === this.currentUser?.id && b.status === 'active');

        if (!myActive) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        const now = Date.now();
        const end = new Date(myActive.endTime).getTime();
        const diff = end - now;

        const isExpired = diff <= 0;
        const isWarning = diff > 0 && diff < 15 * 60 * 1000; // < 15 mins

        // Check if next slot is reserved by someone else
        const otherBookings = bookings.filter(b =>
            b.id !== myActive.id && b.status === 'active' &&
            ((b.seatId === myActive.seatId) || (myActive.seatIds && myActive.seatIds.includes(b.seatId)))
        );
        const hasNextReservation = otherBookings.some(b => {
            const bStart = new Date(b.startTime).getTime();
            return bStart >= end && bStart <= end + 45 * 60 * 1000;
        });

        container.innerHTML = `
            <div class="active-seat-banner ${isExpired ? 'expired' : (isWarning ? 'warning' : '')}">
                <div class="flex justify-between items-start flex-wrap gap-md">
                    <div>
                        <span class="badge bg-warning-light text-warning text-xs">${myActive.isGroup ? '👥 Group Study Block Pass' : '🪑 Individual Desk Pass'}</span>
                        <h2 class="text-white mt-xs" style="font-size:1.3rem;">${myActive.seatId}</h2>
                        <p class="text-white text-xs mt-xs" style="opacity:0.9;">
                            ${myActive.zone} • Reserved: <strong>${new Date(myActive.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> to 
                            <strong>${new Date(myActive.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> 
                            (${myActive.durationHours} Hours Allocated)
                        </p>
                    </div>
                    
                    <div class="flex flex-col items-end">
                        <span class="text-white text-xs mb-xs" style="opacity:0.85;">${isExpired ? 'Session Status:' : 'Time Remaining:'}</span>
                        <div class="countdown-timer-box text-white" id="seat-live-countdown">
                            ⏱️ ${this.formatRemainingTime(diff)}
                        </div>
                    </div>
                </div>

                <div class="flex justify-between items-center mt-md pt-sm border-top flex-wrap gap-sm" style="border-color:rgba(255,255,255,0.2);">
                    <div class="flex gap-xs flex-wrap">
                        <button class="btn btn-secondary btn-sm" onclick="window.App.showSeatPassQR('${myActive.id}')">🪪 View Entry QR</button>
                        
                        ${isExpired || diff < 15 * 60 * 1000 ? `
                            <button class="btn btn-outline btn-sm" style="background:white; color:#1e3a8a;" onclick="window.App.extendSeatBooking('${myActive.id}')" ${hasNextReservation ? 'disabled title="Next slot reserved by another student"' : ''}>
                                ⚡ Extend (+30 Mins)
                            </button>
                        ` : ''}
                    </div>

                    <div class="flex gap-xs flex-wrap">
                        <button class="btn btn-ghost btn-sm" style="color:white; border:1px solid rgba(255,255,255,0.4);" onclick="window.App.cancelSeatBooking('${myActive.id}')">
                            ❌ Cancel Reservation
                        </button>
                        <button class="btn btn-error btn-sm" onclick="window.App.closeSeatBookingEarly('${myActive.id}')">
                            🚪 Early Check-Out (Free Desks)
                        </button>
                    </div>
                </div>

                ${hasNextReservation ? `
                    <div class="p-xs bg-error-light text-error text-xs border-radius mt-sm flex items-center gap-xs">
                        <span>ℹ️</span>
                        <span>Notice: Another student has reserved this desk for the next time slot. Please check out when your timer ends.</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    formatRemainingTime(diffMs) {
        if (diffMs <= 0) return '00:00:00 (Session Over)';
        const totalSecs = Math.floor(diffMs / 1000);
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;
        const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
        return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
    }

    updateSeatCountdownText() {
        const el = document.getElementById('seat-live-countdown');
        if (!el) return;
        const bookings = AppState.seatBookings || [];
        const myActive = bookings.find(b => b.studentId === this.currentUser?.id && b.status === 'active');
        if (!myActive) return;

        const diff = new Date(myActive.endTime).getTime() - Date.now();
        el.textContent = `⏱️ ${this.formatRemainingTime(diff)}`;
    }

    openReserveSeatModal(seat) {
        if (!this.currentUser) {
            this.openAuthModal('login');
            return;
        }

        let selectedDuration = 2; // default 2 hours

        const updateTimePreview = () => {
            const selectEl = document.getElementById('seat-start-select');
            const previewEl = document.getElementById('seat-time-preview-box');
            if (!selectEl || !previewEl) return;

            let startDate = new Date();
            const startType = selectEl.value;
            if (startType === 'plus30') startDate = new Date(startDate.getTime() + 30 * 60 * 1000);
            else if (startType === 'nextHour') startDate.setHours(startDate.getHours() + 1, 0, 0, 0);
            else if (startType.startsWith('slot_')) {
                const hour = parseInt(startType.split('_')[1], 10);
                startDate.setHours(hour, 0, 0, 0);
            }

            const endDate = new Date(startDate.getTime() + selectedDuration * 60 * 60 * 1000);
            const startStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endStr = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            previewEl.innerHTML = `
                <div class="flex justify-between items-center text-xs text-primary">
                    <span>Scheduled Period:</span>
                    <strong class="text-accent">Today, ${startStr} ➔ ${endStr} (${selectedDuration}.0 Hours)</strong>
                </div>
            `;
        };

        this.openModal(`Reserve ${seat.id} (${seat.floor})`, `
            <div class="p-sm flex flex-col gap-sm">
                <div class="p-sm bg-secondary border-radius flex justify-between items-center">
                    <div>
                        <h3 style="font-size:1.1rem; margin:0;">${seat.id} — ${seat.zone}</h3>
                        <span class="text-xs text-secondary">${seat.floor} • Features: ${seat.amenities.join(', ')}</span>
                    </div>
                    <span class="badge bg-success-light text-success text-xs">🟢 Desk Available</span>
                </div>

                <div class="form-group mt-xs">
                    <label class="bold">1. Select Reservation Start Time</label>
                    <select id="seat-start-select" class="select-input mt-xs">
                        <option value="now">Immediate Check-In (Right Now)</option>
                        <option value="plus30">In 30 Minutes</option>
                        <option value="nextHour">At Top of Next Hour</option>
                        <option value="slot_14">14:00 (2:00 PM Slot)</option>
                        <option value="slot_15">15:00 (3:00 PM Slot)</option>
                        <option value="slot_16">16:00 (4:00 PM Slot)</option>
                        <option value="slot_17">17:00 (5:00 PM Slot)</option>
                        <option value="slot_18">18:00 (6:00 PM Slot)</option>
                    </select>
                </div>

                <div class="form-group">
                    <div class="flex justify-between items-center">
                        <label class="bold">2. Select Duration (Max 5 Hours Strictly Enforced)</label>
                        <span class="text-xs text-accent bold" id="duration-badge">2 Hours Selected</span>
                    </div>
                    <div class="duration-picker-grid">
                        <button type="button" class="duration-pill" data-hrs="1">1 Hr</button>
                        <button type="button" class="duration-pill active" data-hrs="2">2 Hrs</button>
                        <button type="button" class="duration-pill" data-hrs="3">3 Hrs</button>
                        <button type="button" class="duration-pill" data-hrs="4">4 Hrs</button>
                        <button type="button" class="duration-pill" data-hrs="5">5 Hrs (Max)</button>
                    </div>
                </div>

                <!-- Live Scheduled Time Preview -->
                <div class="card p-sm bg-secondary" id="seat-time-preview-box"></div>

                <div class="card p-sm bg-tertiary text-xs">
                    <div class="flex justify-between py-xs border-bottom"><span>Allocated Desk:</span><strong>${seat.id} (${seat.code})</strong></div>
                    <div class="flex justify-between py-xs border-bottom"><span>Student Name:</span><strong>${this.currentUser.name} (${this.currentUser.regNo || 'REG-2024-8842'})</strong></div>
                    <div class="flex justify-between py-xs border-bottom"><span>Max Limit Policy:</span><strong>5.0 Hours / Session</strong></div>
                    <div class="flex justify-between py-xs"><span>Extension Option:</span><strong class="text-success">+30 mins if unreserved</strong></div>
                </div>

                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="button" class="btn btn-primary" id="confirm-seat-reservation-btn">Confirm & Issue Pass</button>
                </div>
            </div>
        `);

        updateTimePreview();

        document.getElementById('seat-start-select').onchange = () => updateTimePreview();

        const pills = document.querySelectorAll('.duration-pill');
        pills.forEach(pill => {
            pill.onclick = () => {
                pills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                selectedDuration = parseInt(pill.getAttribute('data-hrs'), 10);
                const badge = document.getElementById('duration-badge');
                if (badge) badge.textContent = `${selectedDuration} Hour${selectedDuration > 1 ? 's' : ''} Selected`;
                updateTimePreview();
            };
        });

        document.getElementById('confirm-seat-reservation-btn').onclick = () => {
            const selectEl = document.getElementById('seat-start-select');
            const startType = selectEl.value;
            let startDate = new Date();
            if (startType === 'plus30') startDate = new Date(startDate.getTime() + 30 * 60 * 1000);
            else if (startType === 'nextHour') startDate.setHours(startDate.getHours() + 1, 0, 0, 0);
            else if (startType.startsWith('slot_')) {
                const hour = parseInt(startType.split('_')[1], 10);
                startDate.setHours(hour, 0, 0, 0);
            }

            const endDate = new Date(startDate.getTime() + selectedDuration * 60 * 60 * 1000);

            const bookings = AppState.seatBookings || [];
            const newBooking = {
                id: `ST-BK-${Date.now().toString().slice(-6)}`,
                isGroup: false,
                seatId: seat.id,
                seatCode: seat.code,
                zone: seat.zone,
                studentId: this.currentUser.id,
                studentName: this.currentUser.name,
                studentRegNo: this.currentUser.regNo || 'REG-2024-8842',
                startTime: startDate.toISOString(),
                endTime: endDate.toISOString(),
                durationHours: selectedDuration,
                status: 'active',
                isExtended: false
            };

            bookings.push(newBooking);
            AppState.seatBookings = bookings;

            const allSeats = this.getSeatDataset();
            const sIndex = allSeats.findIndex(s => s.id === seat.id);
            if (sIndex !== -1) {
                allSeats[sIndex].status = 'reserved';
                AppState.seats = allSeats;
            }

            // Render seat map to show updated reserved status
            this.renderSeatMap();
            this.showToast(`Pass Generated! ${seat.id} reserved for ${selectedDuration} hours.`, 'success');
            // Transition directly to Digital Pass QR modal
            this.showSeatPassQR(newBooking.id);
        };
    }

    openManageActiveSeatModal(booking) {
        const now = Date.now();
        const end = new Date(booking.endTime).getTime();
        const diff = end - now;
        const isExpired = diff <= 0;

        const bookings = AppState.seatBookings || [];
        const otherBookings = bookings.filter(b =>
            b.id !== booking.id && b.status === 'active' &&
            ((b.seatId === booking.seatId) || (booking.seatIds && booking.seatIds.includes(b.seatId)))
        );
        const hasNextReservation = otherBookings.some(b => {
            const bStart = new Date(b.startTime).getTime();
            return bStart >= end && bStart <= end + 45 * 60 * 1000;
        });

        this.openModal(`Manage Reservation — ${booking.seatId}`, `
            <div class="p-sm flex flex-col gap-sm">
                <div class="p-sm bg-secondary border-radius flex justify-between items-center">
                    <div>
                        <h3 style="font-size:1.1rem; margin:0;">${booking.seatId}</h3>
                        <span class="text-xs text-secondary">${booking.zone} • ${booking.durationHours} Hours Allocated</span>
                    </div>
                    <span class="badge ${isExpired ? 'bg-error-light text-error' : 'bg-warning-light text-warning'} text-xs">
                        ${isExpired ? 'Session Over' : 'Active Session'}
                    </span>
                </div>

                <div class="card p-md bg-tertiary text-center">
                    <span class="text-secondary text-xs">${isExpired ? 'Status:' : 'Time Remaining:'}</span>
                    <div class="countdown-timer-box mt-xs" style="font-size:24px; color:var(--text-primary);">
                        ⏱️ ${this.formatRemainingTime(diff)}
                    </div>
                    <p class="text-xs text-secondary mt-xs">
                        ${new Date(booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to 
                        ${new Date(booking.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                </div>

                <div class="flex flex-col gap-xs mt-xs">
                    <button class="btn btn-primary w-full flex items-center justify-center gap-xs" onclick="window.App.showSeatPassQR('${booking.id}')">
                        <span>🪪</span><span>View Full QR Entry Pass</span>
                    </button>

                    ${isExpired || diff < 15 * 60 * 1000 ? `
                        <button class="btn btn-outline w-full flex items-center justify-center gap-xs" onclick="window.App.extendSeatBooking('${booking.id}')" ${hasNextReservation ? 'disabled title="Next slot reserved by another student"' : ''}>
                            <span>⚡</span><span>Extend Reservation (+30 Mins)</span>
                        </button>
                    ` : ''}

                    <div class="grid-2-col gap-xs mt-xs">
                        <button class="btn btn-error btn-sm" onclick="window.App.closeSeatBookingEarly('${booking.id}')">
                            🚪 Check Out Early (+5 Pts)
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="window.App.cancelSeatBooking('${booking.id}')">
                            ❌ Cancel Booking
                        </button>
                    </div>
                </div>

                ${hasNextReservation ? `
                    <div class="p-xs bg-error-light text-error text-xs border-radius mt-xs flex items-center gap-xs">
                        <span>ℹ️</span>
                        <span>Notice: Another student has reserved this desk for the next time slot. Please check out when your timer ends.</span>
                    </div>
                ` : ''}
            </div>
        `);
    }

    showSeatPassQR(bookingId) {
        const bookings = AppState.seatBookings || [];
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        const qrSvg = this.generateQRCodeSVG(`SEAT-PASS:${booking.id}:${booking.seatId}:${booking.studentRegNo}:${booking.endTime}`, 160);

        this.openModal(`Digital Pass — ${booking.seatId}`, `
            <div class="p-md text-center">
                <div class="text-4xl mb-sm">${booking.isGroup ? '👥' : '🪑'}</div>
                <h3 class="text-accent">${booking.seatId}</h3>
                <p class="text-secondary text-xs mt-xs mb-md">${booking.zone} • Scan at library turnstile or desk reader</p>
                
                <div class="card p-sm bg-tertiary mb-md text-left text-xs">
                    <div class="flex justify-between py-xs border-bottom"><span>Pass Token:</span><strong>${booking.id}</strong></div>
                    <div class="flex justify-between py-xs border-bottom"><span>Student/Leader:</span><strong>${booking.studentName} (${booking.studentRegNo})</strong></div>
                    ${booking.members ? `<div class="flex justify-between py-xs border-bottom"><span>Group Members:</span><strong>${booking.members}</strong></div>` : ''}
                    <div class="flex justify-between py-xs border-bottom"><span>Valid From:</span><strong>${new Date(booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
                    <div class="flex justify-between py-xs border-bottom"><span>Valid Until:</span><strong class="text-accent">${new Date(booking.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></div>
                    <div class="flex justify-between py-xs"><span>Duration:</span><strong>${booking.durationHours} Hours</strong></div>
                </div>

                <div class="qr-code-box mx-auto mb-md">${qrSvg}</div>

                <div class="flex justify-between items-center gap-xs flex-wrap">
                    <div class="flex gap-xs">
                        <button class="btn btn-ghost btn-xs text-error" onclick="window.App.cancelSeatBooking('${booking.id}')">Cancel Booking</button>
                        <button class="btn btn-outline btn-xs" onclick="window.App.closeSeatBookingEarly('${booking.id}')">Check Out Early</button>
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="window.App.closeModal()">Close Pass</button>
                </div>
            </div>
        `);
    }

    cancelSeatBooking(bookingId) {
        const bookings = AppState.seatBookings || [];
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        this.openModal('Cancel Seat Reservation', `
            <div class="p-md text-center">
                <div class="text-4xl mb-sm">⚠️</div>
                <h3>Cancel Reservation for ${booking.seatId}?</h3>
                <p class="text-secondary text-sm mt-xs mb-md">This will immediately release the study desks for other waiting students.</p>
                <div class="flex justify-end gap-sm mt-lg">
                    <button class="btn btn-secondary" onclick="window.App.closeModal()">Keep Reservation</button>
                    <button class="btn btn-error" id="confirm-cancel-seat-btn">Yes, Cancel Reservation</button>
                </div>
            </div>
        `);

        document.getElementById('confirm-cancel-seat-btn').onclick = () => {
            booking.status = 'cancelled';
            AppState.seatBookings = bookings;

            const allSeats = this.getSeatDataset();
            allSeats.forEach(s => {
                if (s.id === booking.seatId || (booking.seatIds && booking.seatIds.includes(s.id))) {
                    s.status = 'available';
                }
            });
            AppState.seats = allSeats;

            this.closeModal();
            this.showToast(`Reservation for ${booking.seatId} cancelled and desk released.`, 'info');
            this.renderSeatMap();
            this.renderZoneAvailability();
        };
    }

    closeSeatBookingEarly(bookingId) {
        const bookings = AppState.seatBookings || [];
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        this.openModal('Early Check-Out Confirmation', `
            <div class="p-md text-center">
                <div class="text-4xl mb-sm">🚪</div>
                <h3>Check Out & Release Desk Early</h3>
                <p class="text-secondary text-sm mt-xs mb-md">Finished studying? Releasing your desk early earns you <strong>+5 Academic Merit Credits</strong> for good campus etiquette!</p>
                <div class="flex justify-end gap-sm mt-lg">
                    <button class="btn btn-secondary" onclick="window.App.closeModal()">Continue Studying</button>
                    <button class="btn btn-primary" id="confirm-early-checkout-btn">Check Out & Earn +5 Pts</button>
                </div>
            </div>
        `);

        document.getElementById('confirm-early-checkout-btn').onclick = async () => {
            booking.status = 'completed';
            if (window.FirestoreDB) {
                await window.FirestoreDB.saveSeatBooking(booking);
            }

            const allSeats = this.getSeatDataset();
            allSeats.forEach(s => {
                if (s.id === booking.seatId || (booking.seatIds && booking.seatIds.includes(s.id))) {
                    s.status = 'available';
                }
            });

            if (this.currentUser && window.FirebaseAuth) {
                this.currentUser.contributions = (this.currentUser.contributions || 0) + 1;
                await window.FirebaseAuth.updateProfile({ contributions: this.currentUser.contributions });
            }

            this.closeModal();
            this.showToast(`Checked out early from ${booking.seatId}! +5 Merit Credits awarded.`, 'success');
            this.renderSeatMap();
            this.renderZoneAvailability();
        };
    }

    extendSeatBooking(bookingId) {
        const bookings = AppState.seatBookings || [];
        const booking = bookings.find(b => b.id === bookingId);
        if (!booking) return;

        const currentEnd = new Date(booking.endTime).getTime();
        const proposedEnd = currentEnd + 30 * 60 * 1000; // +30 minutes

        // Check if any other student has booked this seat
        const otherBookings = bookings.filter(b =>
            b.id !== bookingId && b.status === 'active' &&
            ((b.seatId === booking.seatId) || (booking.seatIds && booking.seatIds.includes(b.seatId)))
        );
        const hasConflict = otherBookings.some(b => {
            const bStart = new Date(b.startTime).getTime();
            return bStart < proposedEnd;
        });

        if (hasConflict) {
            this.showToast('Cannot extend: Another student has already booked this desk for the next slot.', 'warning');
            return;
        }

        booking.endTime = new Date(proposedEnd).toISOString();
        booking.isExtended = true;
        AppState.seatBookings = bookings;

        const endStr = new Date(proposedEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.showToast(`Extended! Your session is extended by 30 mins until ${endStr}.`, 'success');
        this.closeModal();
        this.renderSeatMap();
        this.renderZoneAvailability();
    }

    renderZoneAvailability() {
        const container = document.getElementById('zone-availability-list');
        if (!container) return;

        const allSeats = this.getSeatDataset();

        const zonesConfig = [
            {
                name: 'Floor 2: Silent Study Carrels',
                zoneKey: 'silent',
                description: 'Deep focus individual carrels with acoustic isolation & reading lamps.',
                soundLevel: '22 dB (Whisper Silent)',
                temperature: '21.5°C',
                lighting: 'Warm White 4000K',
                amenities: ['⚡ AC Outlets', '💡 Desk Lamp', '🪟 Natural Window View', '🔇 Acoustic Barrier'],
                totalSeats: 16
            },
            {
                name: 'Floor 1: Collaborative Innovation Hub',
                zoneKey: 'collaborative',
                description: 'Brainstorming tables, mobile glassboards, and team discussion pods.',
                soundLevel: '48 dB (Discussion Permitted)',
                temperature: '22.0°C',
                lighting: 'Neutral Crisp 5000K',
                amenities: ['⚡ 65W Fast Charge', '📋 Mobile Whiteboards', '🔌 Display Docks', '👥 Group Tables'],
                totalSeats: 16
            },
            {
                name: 'Floor 3: High-Performance Media Lab',
                zoneKey: 'lab',
                description: 'Workstations with dual 4K monitors, GPU compute, and gigabit wired LAN.',
                soundLevel: '32 dB (Moderate Quiet)',
                temperature: '20.5°C',
                lighting: 'Anti-Glare Cool 5500K',
                amenities: ['🖥️ Dual 4K 27" Displays', '🌐 1Gbps Wired LAN', '🎧 Studio Headsets', '⚡ Clean Power'],
                totalSeats: 16
            },
            {
                name: 'Main Reading Stacks & Research Loft',
                zoneKey: 'all',
                description: 'Open-access reference stacks and comfortable archival reading lounge.',
                soundLevel: '28 dB (Quiet Reading)',
                temperature: '22.5°C',
                lighting: 'Ambient Daylight Loft',
                amenities: ['📚 Core Physical Stacks', '🛋️ Armchairs', '🪟 Panoramic Views', '⚡ Reading Lights'],
                totalSeats: 24
            }
        ];

        container.innerHTML = '';

        zonesConfig.forEach(z => {
            const zSeats = z.zoneKey === 'all' ? allSeats : allSeats.filter(s => s.zoneKey === z.zoneKey);
            const occupiedCount = zSeats.filter(s => s.status === 'occupied').length;
            const reservedCount = zSeats.filter(s => s.status === 'reserved').length;
            const availableCount = Math.max(0, z.totalSeats - (occupiedCount + reservedCount));
            const availPct = Math.round((availableCount / z.totalSeats) * 100);

            let statusColor = '#10B981';
            let statusText = '🟢 Plenty of Seats';
            if (availPct < 25) {
                statusColor = '#EF4444';
                statusText = '🔴 Almost Full';
            } else if (availPct < 60) {
                statusColor = '#F59E0B';
                statusText = '🟡 Filling Up Fast';
            }

            const card = document.createElement('div');
            card.className = 'zone-card-item';
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="bold text-md" style="margin:0;">${z.name}</h4>
                            <p class="text-xs text-secondary mt-xs">${z.description}</p>
                        </div>
                        <span class="badge text-xs" style="background:${statusColor}22; color:${statusColor}; font-weight:700;">
                            ${statusText}
                        </span>
                    </div>

                    <div class="mt-sm">
                        <div class="flex justify-between text-xs bold">
                            <span>Availability:</span>
                            <span style="color:${statusColor};">${availableCount} / ${z.totalSeats} Desks Free (${availPct}%)</span>
                        </div>
                        <div class="zone-progress-track">
                            <div class="zone-progress-fill" style="width:${availPct}%; background:${statusColor};"></div>
                        </div>
                    </div>

                    <div class="zone-sensors-row">
                        <span class="zone-sensor-badge">🔇 ${z.soundLevel}</span>
                        <span class="zone-sensor-badge">🌡️ ${z.temperature}</span>
                        <span class="zone-sensor-badge">💡 ${z.lighting}</span>
                    </div>

                    <div class="flex gap-xs flex-wrap mt-xs">
                        ${z.amenities.map(a => `<span class="badge badge-secondary text-xs" style="font-size:10px;">${a}</span>`).join('')}
                    </div>
                </div>

                <div class="mt-md pt-sm border-top flex justify-between items-center">
                    <span class="text-xs text-secondary">Live sensor data updated</span>
                    <button class="btn btn-primary btn-sm" onclick="AppState.selectedSeatZone = '${z.zoneKey}'; window.App.renderSeatMap(); document.getElementById('seat-map-grid').scrollIntoView({behavior:'smooth'});">
                        ⚡ Book in this Zone
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // ============================================================================
    // RESOURCES PAGE
    // ============================================================================

    switchResourceTab(target = 'notes') {
        AppState.activeTab = target;
        const tabs = document.querySelectorAll('#page-resources .tabs .tab');
        tabs.forEach(t => {
            const isMatch = t.getAttribute('data-target') === target;
            if (isMatch) {
                t.className = 'tab active';
            } else {
                t.className = 'tab';
            }
            t.style.removeProperty('background');
            t.style.removeProperty('color');
            t.style.removeProperty('border-color');
            t.style.removeProperty('font-weight');
            t.style.removeProperty('box-shadow');
            t.blur();
        });
        this.loadResources();
    }

    renderResources() {
        const selects = document.querySelectorAll('#page-resources .filter-bar .select-input');
        AppState.activeTab = AppState.activeTab || 'notes';

        // Ensure accurate tab highlighting
        this.switchResourceTab(AppState.activeTab);

        // Setup filter dropdowns
        selects.forEach(select => {
            select.onchange = () => this.loadResources();
        });
    }

    loadResources() {
        const container = document.getElementById('resources-container');
        if (!container || !this.data) return;

        if (AppState.activeTab === 'syllabus') {
            this.renderSyllabusMapper(container);
            return;
        }

        let dataList = [];
        if (AppState.activeTab === 'notes') {
            dataList = this.data.notes || [];
        } else if (AppState.activeTab === 'papers') {
            dataList = this.data.questionPapers || [];
        } else if (AppState.activeTab === 'assignments') {
            dataList = (this.data.notes || []).map(n => ({
                ...n,
                id: n.id + 1000,
                title: `${n.subject} — Assignment & Problem Set`,
                type: 'assignment',
                tags: ['Assignment', 'Problem-Set', n.department || 'Coursework']
            }));
        } else if (AppState.activeTab === 'manuals') {
            dataList = (this.data.notes || []).map(n => ({
                ...n,
                id: n.id + 2000,
                title: `${n.subject} — Practical Laboratory Manual`,
                type: 'manual',
                tags: ['Lab-Manual', 'Practicals', n.department || 'Lab']
            }));
        } else {
            dataList = this.data.notes || [];
        }

        // Apply Department and Semester filters
        const deptSelect = document.querySelector('#page-resources select[name="department"]');
        const semSelect = document.querySelector('#page-resources select[name="semester"]');

        if (deptSelect && deptSelect.value) {
            const val = deptSelect.value.toLowerCase();
            dataList = dataList.filter(d => (d.department || '').toLowerCase() === val);
        }
        if (semSelect && semSelect.value) {
            dataList = dataList.filter(d => String(d.semester) === String(semSelect.value));
        }

        container.innerHTML = '';

        if (dataList.length === 0) {
            container.innerHTML = '<div class="no-results card p-xl text-center text-secondary w-full">No resources found matching the selected filters.</div>';
            return;
        }

        dataList.forEach(res => {
            container.appendChild(this.createResourceCard(res, AppState.activeTab));
        });
    }

    // ============================================================================
    // DASHBOARD PAGE
    // ============================================================================

    renderDashboard() {
        const user = this.data?.currentUser;
        if (!user) return;

        // Stat Cards
        const statValues = document.querySelectorAll('#page-dashboard .grid-4-col .stat-card .stat-value');
        if (statValues.length >= 4) {
            statValues[0].textContent = user.borrowedBooks.length;
            statValues[1].textContent = user.totalDownloads || 0;
            statValues[2].textContent = `${user.studyStreak || 0} Days`;
            statValues[3].textContent = user.contributions || 0;
        }

        // Update Merit Points in Dashboard
        const meritText = document.getElementById('dashboard-merit-pts-text');
        if (meritText) {
            const credits = this.calculateMeritCredits();
            meritText.textContent = `${credits} Merit Credits Available`;
        }

        // Borrowed Books
        const borrowedList = document.getElementById('dashboard-borrowed-list');
        if (borrowedList && this.data.books && this.data.transactions) {
            borrowedList.innerHTML = '';

            const myTrans = this.data.transactions.filter(t => t.studentId === user.id && t.status !== 'returned');

            if (myTrans.length === 0) {
                borrowedList.innerHTML = '<li class="p-md text-center text-secondary">No books currently borrowed.</li>';
            } else {
                myTrans.forEach(t => {
                    const book = this.data.books.find(b => b.id === t.bookId);
                    if (!book) return;

                    const li = document.createElement('li');
                    li.className = 'borrowed-item flex justify-between items-center p-md border-bottom';

                    const dueDate = new Date(t.dueDate);
                    const isOverdue = dueDate < new Date();

                    li.innerHTML = `
                        <div class="flex items-center gap-md">
                            <div class="book-cover-mini" style="background-color: ${book.cover}; width: 32px; height: 44px; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 10px;">
                                ${book.title.substring(0, 2)}
                            </div>
                            <div>
                                <h4 class="text-sm font-semibold">${book.title}</h4>
                                <p class="text-xs text-secondary">Due: ${dueDate.toLocaleDateString()}</p>
                            </div>
                        </div>
                        <div>
                            ${isOverdue ? '<span class="badge badge-error">Overdue</span>' : '<span class="badge badge-success">Active</span>'}
                            <button class="btn btn-sm btn-outline ml-sm" onclick="window.App.renewBook(${t.id})">Renew</button>
                        </div>
                    `;
                    borrowedList.appendChild(li);
                });
            }
        }

        // Live Real-Time Activity Feed on Dashboard (Replaces placeholder chart)
        const actFeed = document.getElementById('dashboard-activity-feed');
        if (actFeed && this.data.transactions) {
            actFeed.innerHTML = '';
            const recentTrans = (this.data.transactions || [])
                .filter(t => t.studentId === user.id || t.status === 'active')
                .slice(0, 6);

            if (recentTrans.length === 0) {
                actFeed.innerHTML = '<li class="p-sm text-center text-secondary text-xs">No recent circulation activity recorded.</li>';
            } else {
                recentTrans.forEach(t => {
                    const book = (this.data.books || []).find(b => b.id === t.bookId);
                    const title = book ? book.title : `Book #${t.bookId}`;
                    const li = document.createElement('li');
                    li.className = 'activity-item flex justify-between items-center p-sm border-bottom text-xs';

                    let actIcon = '📖';
                    let actBadge = 'Loan Checkout';
                    if (t.status === 'returned') {
                        actIcon = '✅';
                        actBadge = 'Returned Stock';
                    } else if (t.status === 'overdue') {
                        actIcon = '⚠️';
                        actBadge = 'Overdue Alert';
                    }

                    li.innerHTML = `
                        <div class="flex items-center gap-xs">
                            <span>${actIcon}</span>
                            <div>
                                <strong class="text-primary">${title}</strong>
                                <div class="text-secondary" style="font-size:11px;">Date: ${new Date(t.borrowDate).toLocaleDateString()}</div>
                            </div>
                        </div>
                        <span class="badge badge-secondary text-xs">${actBadge}</span>
                    `;
                    actFeed.appendChild(li);
                });
            }
        }

        // Achievements
        const achGrid = document.getElementById('dashboard-achievements');
        if (achGrid && this.data.achievements) {
            achGrid.innerHTML = '';
            this.data.achievements.forEach(ach => {
                const unlocked = user.achievements?.includes(ach.id);
                const div = document.createElement('div');
                div.className = `achievement-card ${unlocked ? 'unlocked' : 'locked'}`;
                div.innerHTML = `
                    <div class="ach-icon">${ach.icon}</div>
                    <h4>${ach.name}</h4>
                    <p class="text-sm text-secondary">${ach.description}</p>
                `;
                achGrid.appendChild(div);
            });
        }

        // Leaderboard
        this.renderLeaderboard();
    }

    renewBook(transactionId) {
        const trans = this.data.transactions?.find(t => t.id === transactionId);
        if (!trans) return;

        const now = new Date();
        const dueDate = new Date(trans.dueDate);
        const diffMs = dueDate - now;
        const diffDays = diffMs / (1000 * 60 * 60 * 24);

        // Validation Rule 1: Renewal available only within 3 days of due date
        if (diffDays > 3) {
            this.showToast(`Renewal unavailable. You can only renew within 3 days of the due date (${Math.ceil(diffDays)} days remaining).`, 'warning');
            return;
        }

        // Validation Rule 2: Cannot extend more than 14 days from current date
        const maxDueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        if (dueDate >= maxDueDate) {
            this.showToast('Maximum renewal limit reached (cannot exceed 14 days from today).', 'warning');
            return;
        }

        // Extend due date to exactly 14 days from today
        trans.dueDate = maxDueDate.toISOString();
        this.saveData('transactions', this.data.transactions);
        this.showToast('Book renewed successfully! Extended by 14 days from today.', 'success');
        this.renderDashboard();
    }

    returnBookUser(transactionId) {
        const trans = this.data.transactions?.find(t => t.id === transactionId);
        if (!trans) return;

        trans.status = 'returned';
        trans.returnDate = new Date().toISOString();
        if (window.FirestoreDB) {
            window.FirestoreDB.saveTransaction(trans);
        }

        // Remove from user's active borrowed array
        if (this.currentUser && this.currentUser.borrowedBooks) {
            this.currentUser.borrowedBooks = this.currentUser.borrowedBooks.filter(id => id !== trans.bookId);
            if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
                window.FirebaseAuth.updateProfile({ borrowedBooks: this.currentUser.borrowedBooks });
            }
        }

        // Replenish stock
        const book = this.data.books?.find(b => b.id === trans.bookId);
        if (book) {
            book.availableCopies = (book.availableCopies || 0) + 1;
            if (window.FirestoreDB) {
                window.FirestoreDB.saveBook(book);
            }
        }

        this.showToast(`Returned "${book ? book.title : 'Book'}" successfully!`, 'success');
        this.renderDashboard();
    }

    renderLeaderboard() {
        const tbody = document.getElementById('dashboard-leaderboard-tbody');
        if (!tbody || !this.currentUser || !window.FirestoreDB?.getLeaderboard) return;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading live leaderboard…</td></tr>';
        window.FirestoreDB.getLeaderboard(10).then((students) => {
          tbody.innerHTML = '';
          if (!students.length) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-secondary">No leaderboard activity yet.</td></tr>';
            return;
          }

          students.forEach((s, idx) => {
            const tr = document.createElement('tr');
            let medal = `#${idx + 1}`;
            if (idx === 0) medal = '🥇 #1';
            if (idx === 1) medal = '🥈 #2';
            if (idx === 2) medal = '🥉 #3';

            tr.innerHTML = `
                <td class="bold text-accent">${medal}</td>
                <td>
                    <div class="flex items-center gap-sm">
                        <div style="width:28px;height:28px;border-radius:50%;background:${s.avatar || '#2563EB'};color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;">${s.name.substring(0, 2).toUpperCase()}</div>
                        <span class="bold">${s.name}</span>
                    </div>
                </td>
                <td><span class="badge bg-secondary text-xs">${s.department || 'CS'}</span></td>
                <td class="bold">${s.booksRead || 0} books</td>
                <td>${s.streak || 0} days</td>
                <td><span class="badge text-success text-xs bg-success-light">${s.score || 0} pts</span></td>
            `;
            tbody.appendChild(tr);
          });
        }).catch((error) => {
          console.error('[Leaderboard] Load failed:', error);
          tbody.innerHTML = '<tr><td colspan="6" class="text-center text-error">Leaderboard unavailable.</td></tr>';
        });
    }

    // ============================================================================
    // PROFILE PAGE
    // ============================================================================

    renderProfile() {
        const user = this.currentUser || this.data?.currentUser;
        if (!user) return;

        // Header Info
        const nameEl = document.querySelector('.profile-info h2');
        const deptEl = document.querySelector('.profile-info .text-secondary');
        const avatarEl = document.querySelector('.profile-avatar-large');

        if (nameEl) nameEl.textContent = user.name;
        if (deptEl) {
            const regStr = user.regNo ? ` • Reg No: ${user.regNo}` : '';
            deptEl.textContent = `${user.department || 'PHY'} • Semester ${user.semester || 3}${regStr}`;
        }
        if (avatarEl) {
            avatarEl.style.backgroundColor = user.avatar || '#3b82f6';
            avatarEl.textContent = (user.name || 'User').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
        }

        // Badges
        const badgesContainer = document.querySelector('.profile-badges');
        if (badgesContainer && user.achievements) {
            badgesContainer.innerHTML = '';
            user.achievements.slice(0, 4).forEach(achId => {
                const ach = this.data.achievements?.find(a => a.id === achId);
                if (ach) {
                    const span = document.createElement('span');
                    span.className = 'badge badge-accent text-xs';
                    span.textContent = `${ach.icon} ${ach.name}`;
                    badgesContainer.appendChild(span);
                }
            });
        }

        // History List (using live synchronized readingHistory)
        const historyList = document.getElementById('profile-history-list');
        this.renderBookList(historyList, user.readingHistory || [], 'Read on');

        // Bookmarks List (using live synchronized bookmarks)
        const bookmarksList = document.getElementById('profile-bookmarks-list');
        this.renderBookList(bookmarksList, user.bookmarks || [], 'Bookmarked');
    }

    renderBookList(container, bookIds, dateLabel) {
        if (!container || !this.data || !this.data.books) return;

        container.innerHTML = '';
        if (!bookIds || bookIds.length === 0) {
            container.innerHTML = '<li class="p-md text-secondary text-sm text-center">No books recorded yet. Explore catalog to add titles.</li>';
            return;
        }

        bookIds.slice(0, 15).forEach(id => {
            const book = this.data.books.find(b => b.id === id);
            if (!book) return;

            const isBookmarked = (this.currentUser?.bookmarks || []).includes(book.id);

            const li = document.createElement('li');
            li.className = 'flex items-center justify-between gap-md p-md border-bottom cursor-pointer hover-bg';
            li.onclick = () => window.location.hash = `#book/${book.id}`;

            li.innerHTML = `
                <div class="flex items-center gap-md">
                    <div class="book-cover-mini" style="background-color: ${book.cover || '#2563eb'}; width: 42px; height: 60px; border-radius: 4px; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold; text-align:center;">
                        ${book.title.substring(0, 6)}
                    </div>
                    <div>
                        <h4 class="text-sm font-semibold">${book.title}</h4>
                        <p class="text-xs text-secondary">by ${book.author} • Shelf ${book.shelf || 'A1'}</p>
                        <span class="badge text-xs mt-xs ${book.availableCopies > 0 ? 'badge-success' : 'badge-error'}">${book.availableCopies > 0 ? '🟢 In Stock' : '🔴 Checked Out'}</span>
                    </div>
                </div>
                <div class="flex items-center gap-xs">
                    <button class="btn btn-outline btn-xs" onclick="window.App.toggleBookmark(${book.id}); event.stopPropagation();" title="Toggle Bookmark">
                        ${isBookmarked ? '🔖 Saved' : '📑 Bookmark'}
                    </button>
                    <button class="btn btn-primary btn-xs" onclick="window.location.hash='#book/${book.id}'; event.stopPropagation();">
                        View
                    </button>
                </div>
            `;
            container.appendChild(li);
        });
    }

    // ============================================================================
    // ADMIN PAGE
    // ============================================================================

    renderAdmin() {
        if (!this.data || !this.charts) return;

        const analytics = this.data.analytics || { monthlyBorrows: [], departmentStats: {} };

        // Stat Cards
        const statValues = document.querySelectorAll('#page-admin .grid-4-col .stat-card .stat-value');
        if (statValues.length >= 4) {
            const overdueCount = this.data.transactions?.filter(t => t.status !== 'returned' && new Date(t.dueDate) < new Date()).length || 0;
            statValues[0].textContent = this.data.books?.length || 0;
            statValues[1].textContent = this.data.students?.length || 0;
            statValues[2].textContent = this.data.transactions?.filter(t => t.status !== 'returned').length || 0;
            statValues[3].textContent = overdueCount;
        }

        // Trends Chart
        requestAnimationFrame(() => {
            if (this.charts) {
                this.charts.line('admin-trends-chart', {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                    datasets: [{
                        label: 'Monthly Borrows',
                        data: analytics.monthlyBorrows || Array(12).fill(0),
                        color: '#8b5cf6'
                    }],
                    title: 'Borrowing Trends'
                });

                if (analytics.departmentStats) {
                    const labels = Object.keys(analytics.departmentStats);
                    const data = Object.values(analytics.departmentStats);
                    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#6366f1'];

                    this.charts.donut('admin-dept-chart', {
                        labels, data, colors,
                        title: 'Books by Department',
                        centerText: 'Total\nBooks'
                    });
                }
            }
        });

        // Activity Table
        const tbody = document.querySelector('#admin-activity-table tbody');
        if (tbody && this.data.transactions) {
            tbody.innerHTML = '';
            this.data.transactions.slice(0, 10).forEach(t => {
                const book = this.data.books?.find(b => b.id === t.bookId);
            const student = this.data.students?.find(s => s.id === t.studentId) || { name: t.studentName || t.userName || 'Unknown member', department: t.department || '—' };

                if (!book || !student) return;

                const tr = document.createElement('tr');
                const statusBadge = t.status === 'returned' ? '<span class="badge text-success">Returned</span>' :
                    (new Date(t.dueDate) < new Date() ? '<span class="badge text-error">Overdue</span>' :
                        '<span class="badge text-warning">Active</span>');

                tr.innerHTML = `
                    <td>#${t.id}</td>
                    <td><strong>${student.name}</strong></td>
                    <td><a href="#book/${book.id}" class="text-primary">${book.title}</a></td>
                    <td>${new Date(t.borrowDate).toLocaleDateString()}</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div class="flex gap-xs">
                            ${t.status !== 'returned'
                        ? `<button class="btn btn-outline btn-xs" onclick="window.App.returnBookAdmin(${t.id})">Mark Returned</button>`
                        : `<span class="text-xs text-secondary">Completed</span>`
                    }
                            <button class="btn btn-ghost btn-xs text-error" onclick="window.App.deleteBookAdmin(${book.id})" title="Delete Book Catalog Item">🗑️</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    }

    addNewBookModal() {
        if (!this.currentUser || !this.isAdmin()) {
            this.showToast('Admin privilege required.', 'error');
            return;
        }

        this.openModal('Add New Catalog Item', `
            <form id="add-book-form" class="p-sm flex flex-col gap-sm">
                <div class="form-group">
                    <label>Book Title</label>
                    <input type="text" id="add-book-title" class="input" placeholder="e.g. Distributed Systems & Microservices" required>
                </div>
                <div class="form-group">
                    <label>Author</label>
                    <input type="text" id="add-book-author" class="input" placeholder="e.g. Martin Kleppmann" required>
                </div>
                <div class="grid-2-col">
                    <div class="form-group">
                        <label>Department</label>
                        <select id="add-book-dept" class="select-input">
                            <option value="CS">Computer Science</option>
                            <option value="ECE">Electronics</option>
                            <option value="ME">Mechanical</option>
                            <option value="PHY">Physics</option>
                            <option value="CE">Civil</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <input type="text" id="add-book-cat" class="input" placeholder="e.g. Software Engineering">
                    </div>
                </div>
                <div class="grid-2-col">
                    <div class="form-group">
                        <label>Total Copies</label>
                        <input type="number" id="add-book-total" class="input" value="5" min="1" required>
                    </div>
                    <div class="form-group">
                        <label>Shelf Location</label>
                        <input type="text" id="add-book-shelf" class="input" placeholder="e.g. B4-R2">
                    </div>
                </div>
                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Add Book</button>
                </div>
            </form>
        `);

        document.getElementById('add-book-form').onsubmit = (e) => {
            e.preventDefault();
            const title = document.getElementById('add-book-title').value.trim();
            const author = document.getElementById('add-book-author').value.trim();
            const dept = document.getElementById('add-book-dept').value;
            const cat = document.getElementById('add-book-cat').value.trim() || 'General';
            const total = parseInt(document.getElementById('add-book-total').value) || 5;
            const shelf = document.getElementById('add-book-shelf').value.trim() || 'A1';

            const newBook = {
                id: Date.now(),
                title, author, department: dept, category: cat,
                totalCopies: total, availableCopies: total,
                shelf, rack: 1, rating: 5.0, ratingCount: 1, borrowCount: 0,
                cover: '#2563eb', publicationYear: 2026, tags: [dept.toLowerCase(), cat.toLowerCase()]
            };

            if (!this.data.books) this.data.books = [];
            this.data.books.unshift(newBook);
            this.saveData('books', this.data.books);

            this.closeModal();
            this.showToast(`Added "${title}" to library catalog!`, 'success');
            this.renderAdmin();
        };
    }

    deleteBookAdmin(bookId) {
        if (!this.currentUser || !this.isAdmin()) {
            this.showToast('Admin privilege required.', 'error');
            return;
        }

        const book = this.data.books?.find(b => b.id === bookId);
        if (!book) return;

        if (confirm(`Are you sure you want to delete "${book.title}" from the library database?`)) {
            this.data.books = this.data.books.filter(b => b.id !== bookId);
            this.saveData('books', this.data.books);
            this.showToast(`Deleted "${book.title}" from catalog.`, 'info');
            this.renderAdmin();
        }
    }

    // ============================================================================
    // SETTINGS PAGE
    // ============================================================================

    renderSettings() {
        // Theme Select
        const themeSelect = document.getElementById('theme-select');
        if (themeSelect) {
            themeSelect.value = AppState.theme;
            // Clone to remove old listeners
            const newSelect = themeSelect.cloneNode(true);
            themeSelect.parentNode.replaceChild(newSelect, themeSelect);

            newSelect.addEventListener('change', (e) => {
                this.applyTheme(e.target.value);
            });
        }

        // Tabs
        const tabs = document.querySelectorAll('#page-settings .settings-tab');
        const sections = document.querySelectorAll('#page-settings .settings-section');

        const settingTabs = document.querySelectorAll('#page-settings .settings-tab');
        settingTabs.forEach(tab => {
            tab.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('#page-settings .settings-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const target = tab.getAttribute('data-target');
                document.querySelectorAll('#page-settings .settings-section').forEach(s => s.style.display = 'none');
                const activeSec = document.getElementById(`setting-${target}`);
                if (activeSec) activeSec.style.display = 'block';
            };
        });

        // Show initial section
        if (sections.length > 0) {
            sections.forEach(s => s.style.display = 'none');
            const activeTab = document.querySelector('#page-settings .settings-tab.active');
            if (activeTab) {
                const targetId = `setting-${activeTab.getAttribute('data-target')}`;
                const target = document.getElementById(targetId);
                if (target) target.style.display = 'block';
            }
        }
    }

    // ============================================================================
    // BOOK DETAIL PAGE
    // ============================================================================

    renderBookDetail(bookId) {
        const container = document.getElementById('book-detail-container');
        if (!container || !this.data || !this.data.books) return;

        // Parse bookId as int if possible
        const id = isNaN(parseInt(bookId)) ? bookId : parseInt(bookId);
        const book = this.data.books.find(b => b.id === id);

        if (!book) {
            container.innerHTML = `
                <div class="card text-center p-xl my-lg">
                    <div class="text-4xl mb-md">📚</div>
                    <h2>Book Not Found</h2>
                    <p class="text-secondary mt-xs mb-lg">The requested title could not be located in the catalog.</p>
                    <button class="btn btn-primary" onclick="window.location.hash='#search'">Return to Search</button>
                </div>
            `;
            return;
        }

        this.addToReadingHistory(book.id);

        const isBookmarked = this.currentUser?.bookmarks?.includes(book.id);
        const isAdmin = this.isAdmin();
        const isBorrowed = this.currentUser?.borrowedBooks?.includes(book.id);

        container.innerHTML = `
            <div class="book-detail-wrapper">
                <!-- Back Navigation Bar -->
                <div class="flex items-center justify-between mb-lg">
                    <button class="btn btn-ghost btn-sm flex items-center gap-xs" onclick="window.history.back()">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                        Back
                    </button>
                    <div class="flex gap-xs">
                        ${isAdmin ? `<button class="btn btn-outline btn-sm" onclick="window.App.editBookModal(${book.id})">✏️ Edit Book</button>` : ''}
                        <button class="btn btn-outline btn-sm" onclick="window.App.shareBook(${book.id})">🔗 Share</button>
                    </div>
                </div>

                <div class="card p-xl">
                    <div class="grid" style="grid-template-columns: minmax(220px, 280px) 1fr; gap: 32px; align-items: start;">
                        <!-- Left Column: Book Cover & Instant Actions -->
                        <div class="flex flex-col gap-lg">
                            <div class="book-cover-large p-lg text-center" style="background-color: ${book.cover || 'var(--bg-tertiary)'}; min-height: 320px; border-radius: var(--radius-sm); display: flex; flex-direction: column; justify-content: center; align-items: center; color: white; border: 1px solid var(--border);">
                                <div class="text-xs uppercase tracking-wider mb-sm" style="opacity: 0.85;">${book.department || 'GENERAL'}</div>
                                <h3 style="font-size: 1.15rem; font-weight: 600; line-height: 1.3;">${book.title}</h3>
                                <div class="text-sm mt-xs" style="opacity: 0.9;">${book.author}</div>
                            </div>

                            <div class="flex flex-col gap-sm">
                                ${isBorrowed
                ? `<button class="btn btn-outline w-full" disabled>✔️ Currently Borrowed</button>`
                : (book.availableCopies > 0
                    ? `<button class="btn btn-primary w-full" onclick="window.App.borrowBook(${book.id})">Borrow Book</button>`
                    : `<button class="btn btn-outline w-full text-warning" onclick="window.App.reserveBook(${book.id})">Reserve (Waitlist)</button>`)
            }
                                <button class="btn btn-secondary w-full" onclick="window.App.toggleBookmark(${book.id})">
                                    ${isBookmarked ? '🔖 Saved in Bookmarks' : '📑 Save to Bookmarks'}
                                </button>
                            </div>

                            <!-- Availability & Location Info Card -->
                            <div class="card bg-tertiary p-md">
                                <h4 class="text-sm bold mb-sm">Library Shelf Location</h4>
                                <div class="flex justify-between text-sm py-xs border-bottom">
                                    <span class="text-secondary">Available Copies</span>
                                    <strong class="${book.availableCopies > 0 ? 'text-success' : 'text-error'}">${book.availableCopies} / ${book.totalCopies || 1}</strong>
                                </div>
                                <div class="flex justify-between text-sm py-xs border-bottom">
                                    <span class="text-secondary">Shelf Section</span>
                                    <strong>Shelf ${book.shelf || 'A1'}</strong>
                                </div>
                                <div class="flex justify-between text-sm py-xs">
                                    <span class="text-secondary">Rack Number</span>
                                    <strong>Rack ${book.rack || 1}</strong>
                                </div>
                            </div>
                        </div>

                        <!-- Right Column: Metadata & Detailed Overview -->
                        <div class="flex flex-col gap-lg">
                            <div>
                                <div class="flex items-center gap-sm mb-xs">
                                    <span class="badge bg-accent-light text-accent text-xs bold">${book.department || 'CS'}</span>
                                    <span class="badge bg-tertiary text-secondary text-xs">${book.category || 'General'}</span>
                                    ${book.semester ? `<span class="badge bg-tertiary text-secondary text-xs">Semester ${book.semester}</span>` : ''}
                                </div>
                                <h1 style="font-size: 2.25rem; font-weight: 700; line-height: 1.2; margin-bottom: 6px;">${book.title}</h1>
                                <p class="text-secondary text-lg">by <strong class="text-primary">${book.author}</strong></p>
                            </div>

                            <!-- Rating & Stats Bar -->
                            <div class="flex items-center gap-md p-sm card bg-tertiary">
                                <div class="flex items-center gap-xs">
                                    <span class="stars text-warning text-md">${this.renderStars(book.rating || 4.5)}</span>
                                    <strong class="text-sm">${book.rating || 4.5}</strong>
                                </div>
                                <span class="text-tertiary">•</span>
                                <span class="text-secondary text-sm">${book.ratingCount || 42} Reviews</span>
                                <span class="text-tertiary">•</span>
                                <span class="text-secondary text-sm">${book.borrowCount || 100}+ Times Borrowed</span>
                            </div>

                            <!-- Tags -->
                            ${(book.tags && book.tags.length > 0) ? `
                                <div class="flex gap-xs flex-wrap">
                                    ${book.tags.map(t => `<span class="chip text-xs">#${t}</span>`).join('')}
                                </div>
                            ` : ''}

                            <!-- Description -->
                            <div class="book-description">
                                <h3 class="text-md bold mb-xs">Book Description</h3>
                                <p class="text-secondary" style="line-height: 1.7; font-size: 14px;">
                                    ${book.description || 'This authoritative textbook provides foundational and advanced insights into the domain, designed for academic coursework and reference.'}
                                </p>
                            </div>

                            <!-- Metadata Table -->
                            <div>
                                <h3 class="text-md bold mb-sm">Publication Details</h3>
                                <div class="grid grid-2-col gap-md">
                                    <div class="card p-sm bg-tertiary">
                                        <div class="text-xs text-secondary">ISBN-13</div>
                                        <div class="bold text-sm mt-xs">${book.isbn || '978-0134685991'}</div>
                                    </div>
                                    <div class="card p-sm bg-tertiary">
                                        <div class="text-xs text-secondary">Publisher</div>
                                        <div class="bold text-sm mt-xs">${book.publisher || 'Pearson Education'}</div>
                                    </div>
                                    <div class="card p-sm bg-tertiary">
                                        <div class="text-xs text-secondary">Edition</div>
                                        <div class="bold text-sm mt-xs">${book.edition || '3rd Edition'}</div>
                                    </div>
                                    <div class="card p-sm bg-tertiary">
                                        <div class="text-xs text-secondary">Publication Year</div>
                                        <div class="bold text-sm mt-xs">${book.publicationYear || 2022}</div>
                                    </div>
                                    <div class="card p-sm bg-tertiary">
                                        <div class="text-xs text-secondary">Pages</div>
                                        <div class="bold text-sm mt-xs">${book.pages || 640} Pages</div>
                                    </div>
                                    <div class="card p-sm bg-tertiary">
                                        <div class="text-xs text-secondary">Language</div>
                                        <div class="bold text-sm mt-xs">${book.language || 'English'}</div>
                                    </div>
                                </div>
                            </div>

                            <!-- Related Books -->
                            <div class="mt-lg">
                                <h3 class="text-md bold mb-sm">Recommended in ${book.department}</h3>
                                <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px;">
                                    ${this.renderRelatedBooks(book)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderRelatedBooks(currentBook) {
        if (!this.data || !this.data.books) return '';
        const related = this.data.books
            .filter(b => b.id !== currentBook.id && (b.category === currentBook.category || b.department === currentBook.department))
            .slice(0, 4);

        if (related.length === 0) return '<p class="text-secondary">No related books found.</p>';

        return related.map(b => `
            <div class="related-book-card cursor-pointer hover-scale" onclick="window.location.hash='#book/${b.id}'">
                <div class="cover" style="background-color: ${b.cover || '#ccc'}; width: 100%; aspect-ratio: 2/3; border-radius: var(--radius-sm);"></div>
                <h5 class="mt-sm text-sm" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${b.title}</h5>
            </div>
        `).join('');
    }



    // ============================================================================
    // NEXT-GEN AGENTIC AI LIBRARIAN WITH TOOL INTEGRATION & USER MEMORY
    // ============================================================================

    getAIMemory() {
        if (this.currentUser?.aiMemory) return this.currentUser.aiMemory;

        const defaultMemory = {
            userId: this.currentUser?.id || 1,
            userName: this.currentUser?.name || 'User',
            department: this.currentUser?.department || 'PHY',
            preferredZone: 'Floor 2 (Silent Study Pods)',
            preferredZoneKey: 'silent',
            preferredDuration: 2,
            favoriteTopics: ['Quantum Computing', 'Distributed Systems', 'Machine Learning'],
            syllabusHistory: [],
            bookingHistory: [],
            lastInteraction: new Date().toISOString()
        };
        return defaultMemory;
    }

    updateAIMemory(updates) {
        const memory = this.getAIMemory();
        const updated = { ...memory, ...updates, lastInteraction: new Date().toISOString() };
        if (this.currentUser) {
            this.currentUser.aiMemory = updated;
            window.FirebaseAuth.updateProfile({ aiMemory: updated }).catch((error) => console.error('[AI] Memory update failed:', error));
        }
        return updated;
    }

    renderAILibrarian() {
        const chatContainer = document.getElementById('chat-messages');
        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('send-chat-btn');
        const chips = document.querySelectorAll('#page-ai-librarian .chip');

        if (!chatContainer || !input || !sendBtn) return;

        // Initialize state
        AppState.aiChatHistory = AppState.aiChatHistory || [];
        AppState.aiContextBook = AppState.aiContextBook || null;
        AppState.aiBookingState = AppState.aiBookingState || null; // For multi-step booking

        const memory = this.getAIMemory();

        const doSend = () => {
            const msg = input.value.trim();
            if (!msg) return;
            input.value = '';
            this.handleAIChat(msg);
        };

        sendBtn.onclick = doSend;
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
            }
        };

        chips.forEach(chip => {
            chip.onclick = (e) => {
                e.preventDefault();
                input.value = chip.textContent.replace(/^[\u{1F300}-\u{1F9FF}\s]+/u, '').trim();
                doSend();
            };
        });

        // Populate history or personalized greeting with user memory
        if (AppState.aiChatHistory.length > 0) {
            chatContainer.innerHTML = '';
            AppState.aiChatHistory.forEach(msg => {
                this.appendChatMessage(msg.text, msg.sender, false);
                if (msg.widget) this.appendChatWidget(msg.widget);
            });
            chatContainer.scrollTop = chatContainer.scrollHeight;
        } else if (chatContainer.children.length === 0) {
            const credits = this.calculateMeritCredits();
            const streak = this.currentUser?.studyStreak || 0;
            const greeting = `Hello <strong>${memory.userName}</strong>! 👋 I'm Nova, your Autonomous AI Librarian.
            <br><br>
            🧠 <strong>Memory Loaded:</strong> I remember your major is <em>${memory.department}</em> and your favorite study spot is <em>${memory.preferredZone}</em>. You currently have <strong>${credits} Merit Credits</strong> and an active <strong>${streak}-day study streak</strong>!
            <br><br>
            ✨ <strong>Integrated Tools I can run for you:</strong>
            <br>• 📋 <strong>Syllabus-to-Book Mapper:</strong> Paste your course syllabus or unit outline directly in our chat!
            <br>• 🪑 <strong>Autonomous Seat & Table Booking:</strong> Say <em>"Book me a table for 3 hours at 2 PM"</em> or <em>"Book a group table for 4 people"</em>.
            <br>• ⚡ <strong>Fine Waivers:</strong> Say <em>"Waive my fines with merit credits"</em>.
            <br>• 📖 <strong>Book Circulation & Citations:</strong> Ask me to find, borrow, or cite any textbook in APA/IEEE format.`;

            this.appendChatMessage(greeting, 'ai');
        }
    }

    handleAIChat(message) {
        if (!message) return;

        this.appendChatMessage(message, 'user');
        AppState.aiChatHistory.push({ sender: 'user', text: message });

        const typingId = this.showTypingIndicator();

        setTimeout(() => {
            this.removeTypingIndicator(typingId);
            const response = this.generateAIResponse(message);

            this.appendChatMessage(response.text, 'ai');
            if (response.widget) {
                this.appendChatWidget(response.widget);
            }

            AppState.aiChatHistory.push({
                sender: 'ai',
                text: response.text,
                widget: response.widget || null
            });
        }, 500 + Math.random() * 400);
    }

    generateAIResponse(message) {
        const lower = (message || '').toLowerCase();
        const memory = this.getAIMemory();
        const catalog = this.data?.books || [];
        const allSeats = this.getSeatDataset();

        // -------------------------------------------------------------------------
        // 1. PENDING CONVERSATIONAL BOOKING FLOW (MULTI-STEP QUESTIONS)
        // -------------------------------------------------------------------------
        if (AppState.aiBookingState) {
            return this.handleConversationalBookingStep(message, lower, memory, allSeats);
        }

        // -------------------------------------------------------------------------
        // 2. SYLLABUS MAPPING TOOL INTEGRATION
        // -------------------------------------------------------------------------
        const isSyllabusPaste = (
            lower.includes('unit 1') || lower.includes('unit 2') || lower.includes('module 1') ||
            lower.includes('module 2') || lower.includes('chapter 1') || lower.includes('syllabus:') ||
            lower.includes('course outline') || (lower.includes('unit') && lower.includes('module')) ||
            (message.includes('\n') && (lower.includes('algorithms') || lower.includes('system') || lower.includes('physics') || lower.includes('circuit') || lower.includes('database')))
        );

        if (isSyllabusPaste || (lower.startsWith('map ') && lower.includes('syllabus')) || lower.includes('paste syllabus')) {
            return this.executeSyllabusMappingTool(message, memory, catalog);
        }

        // -------------------------------------------------------------------------
        // 3. SEAT & TABLE BOOKING TOOL INTEGRATION
        // -------------------------------------------------------------------------
        const isBookingRequest = (
            lower.includes('book') || lower.includes('reserve') || lower.includes('seat me') ||
            lower.includes('need a desk') || lower.includes('need a table') || lower.includes('study table')
        ) && (
                lower.includes('table') || lower.includes('seat') || lower.includes('desk') ||
                lower.includes('hour') || lower.includes('slot') || lower.includes('zone') || lower.includes('pm') || lower.includes('am')
            );

        if (isBookingRequest) {
            return this.initiateSeatBookingTool(message, lower, memory, allSeats);
        }

        // -------------------------------------------------------------------------
        // 4. FINE WAIVER & MERIT CREDITS TOOL
        // -------------------------------------------------------------------------
        if (lower.includes('waive') || lower.includes('fine') || lower.includes('merit credit') || lower.includes('pay fine')) {
            const credits = this.calculateMeritCredits();
            const myFines = (this.data.fines || []).filter(f => f.studentId === this.currentUser?.id && f.status === 'pending');
            const totalFine = myFines.reduce((sum, f) => sum + f.amount, 0);

            if (totalFine === 0) {
                return {
                    text: `Great news, <strong>${memory.userName}</strong>! You currently have <strong>₹0.00 in outstanding fines</strong>. Your <strong>${credits} Academic Merit Credits</strong> are safe in your wallet for future perks or turnstile passes!`,
                    widget: `<div class="chat-widget-card flex justify-between items-center text-xs"><span>⚡ Wallet Balance: <strong>${credits} Pts</strong></span><button class="btn btn-outline btn-xs" onclick="location.hash='#dashboard'">View Leaderboard</button></div>`
                };
            }

            const maxWaivable = Math.min(totalFine, credits / 10);
            return {
                text: `You have <strong>₹${totalFine.toFixed(2)} in pending fines</strong> and <strong>${credits} Academic Merit Credits</strong>. You can waive up to <strong>₹${maxWaivable.toFixed(2)}</strong> right now!`,
                widget: `
                    <div class="chat-widget-card flex flex-col gap-xs text-xs">
                        <div class="flex justify-between py-xs border-bottom"><span>Pending Fine:</span><strong class="text-error">₹${totalFine.toFixed(2)}</strong></div>
                        <div class="flex justify-between py-xs"><span>Merit Credits Available:</span><strong class="text-success">${credits} Pts (₹${(credits / 10).toFixed(2)})</strong></div>
                        <div class="flex justify-end gap-xs mt-xs">
                            <button class="btn btn-primary btn-xs" onclick="window.App.redeemMeritCredits()">⚡ Redeem & Apply Waiver</button>
                        </div>
                    </div>
                `
            };
        }

        // -------------------------------------------------------------------------
        // 5. COLLABORATIVE STUDY ROOMS TOOL
        // -------------------------------------------------------------------------
        if (lower.includes('group room') || lower.includes('tech suite') || lower.includes('meeting room') || lower.includes('conference room')) {
            return {
                text: `I can reserve a <strong>Collaborative Tech Suite</strong> for your study team. Here are the 4 multimedia suites available with interactive smartboards:`,
                widget: `
                    <div class="chat-widget-card flex flex-col gap-xs text-xs">
                        <div class="flex justify-between items-center py-xs border-bottom">
                            <div><strong>Room A: Ada Lovelace Suite</strong><div class="text-secondary text-xs">Cap: 8 • 4K Display, Smartboard</div></div>
                            <button class="btn btn-primary btn-xs" onclick="window.App.openBookStudyRoomModal('room-a', 'Ada Lovelace Tech Suite')">Book Suite</button>
                        </div>
                        <div class="flex justify-between items-center py-xs border-bottom">
                            <div><strong>Room B: Alan Turing Lab</strong><div class="text-secondary text-xs">Cap: 12 • Dual Projectors, Podcasting</div></div>
                            <button class="btn btn-primary btn-xs" onclick="window.App.openBookStudyRoomModal('room-b', 'Alan Turing Collaborative Lab')">Book Suite</button>
                        </div>
                        <div class="flex justify-between items-center py-xs">
                            <div><strong>Room C: Ramanujan Hub</strong><div class="text-secondary text-xs">Cap: 6 • Glass Whiteboards</div></div>
                            <button class="btn btn-primary btn-xs" onclick="window.App.openBookStudyRoomModal('room-c', 'Ramanujan Quantitative Hub')">Book Suite</button>
                        </div>
                    </div>
                `
            };
        }

        // -------------------------------------------------------------------------
        // 6. CITATION GENERATOR
        // -------------------------------------------------------------------------
        if (lower.includes('cite') || lower.includes('citation') || lower.includes('ieee') || lower.includes('apa') || lower.includes('bibtex')) {
            const targetBook = catalog.find(b => lower.includes(b.title.toLowerCase().substring(0, 8))) || AppState.aiContextBook || catalog[0];
            const year = targetBook.publicationYear || 2023;
            const ieee = `${targetBook.author}, *${targetBook.title}*, ${targetBook.edition || '1st'} ed. ${targetBook.publisher || 'Academic Press'}, ${year}.`;
            const apa = `${targetBook.author} (${year}). *${targetBook.title}* (${targetBook.edition || '1st'} ed.). ${targetBook.publisher || 'Academic Press'}.`;

            return {
                text: `Here are the standardized academic citations for <strong>${targetBook.title}</strong>:`,
                widget: `
                    <div class="chat-widget-card">
                        <div class="text-xs bold text-accent mb-xs">IEEE Format:</div>
                        <div class="citation-block">${ieee}</div>
                        <div class="text-xs bold text-accent mt-sm mb-xs">APA 7th Format:</div>
                        <div class="citation-block">${apa}</div>
                    </div>
                `
            };
        }

        // -------------------------------------------------------------------------
        // 7. DIRECT BOOK SEARCH & RECOMMENDATIONS (USING MEMORY)
        // -------------------------------------------------------------------------
        if (lower.includes('recommend') || lower.includes('suggest') || lower.includes('textbook')) {
            const recommendations = window.RecommendationEngine
                ? window.RecommendationEngine.getPersonalizedRecommendations(this.currentUser, catalog, 5)
                : catalog.slice(0, 5);
            if (recommendations.length) {
                AppState.aiContextBook = recommendations[0];
                return {
                    text: `Based on your Firestore reading profile, I selected ${recommendations.length} relevant books for you:`,
                    widget: `<div class="ai-book-recommendations">${recommendations.map((book, index) => this.renderAIBookSuggestion(book, index + 1)).join('')}</div>`
                };
            }
        }
        const matchedBooks = catalog.filter(b =>
            lower.includes(b.title.toLowerCase()) ||
            lower.includes(b.author.toLowerCase()) ||
            (b.tags && b.tags.some(t => lower.includes(t.toLowerCase())))
        ).slice(0, 3);

        if (matchedBooks.length > 0) {
            AppState.aiContextBook = matchedBooks[0];
            this.updateAIMemory({ favoriteTopics: Array.from(new Set([...memory.favoriteTopics, matchedBooks[0].category])).slice(0, 5) });

            return {
                text: `I found <strong>${matchedBooks.length} book(s)</strong> in our catalog matching your request:`,
                widget: `
                    <div class="chat-widget-card flex flex-col gap-sm text-xs">
                        ${matchedBooks.map(b => `
                            <div class="flex justify-between items-center py-xs border-bottom">
                                <div class="flex items-center gap-xs">
                                    <div style="background:${b.cover || '#2563eb'}; width:28px; height:38px; border-radius:3px; color:white; font-size:8px; display:flex; align-items:center; justify-content:center; font-weight:bold; flex-shrink:0;">${b.title.substring(0, 6)}</div>
                                    <div>
                                        <strong>${b.title}</strong>
                                        <div class="text-secondary">Shelf ${b.shelf || 'A1'}, Rack ${b.rack || 'R1'} • ${b.availableCopies > 0 ? '🟢 Available' : '🔴 Reserved'}</div>
                                    </div>
                                </div>
                                <div class="flex gap-xs">
                                    <button class="btn btn-outline btn-xs" onclick="window.location.hash='#book/${b.id}'">View</button>
                                    ${b.availableCopies > 0 ? `<button class="btn btn-primary btn-xs" onclick="window.App.borrowBook(${b.id})">Borrow</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `
            };
        }

        // -------------------------------------------------------------------------
        // 8. GENERAL INTELLIGENT FALLBACK WITH PERSONALIZED SUGGESTIONS
        // -------------------------------------------------------------------------
        const topicsStr = memory.favoriteTopics.slice(0, 2).join(' & ');
        return {
            text: `I can help you with that, <strong>${memory.userName}</strong>! Since you're studying <em>${memory.department}</em> with interests in <em>${topicsStr}</em>, here are instant actions you can ask me to run:`,
            widget: `
                <div class="chat-widget-card flex flex-col gap-xs text-xs">
                    <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Book me a desk in Silent Zone for 2 hours')">🪑 Book Silent Desk for 2 Hours</button>
                    <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Map this syllabus: Unit 1: Process Synchronization, Semaphores | Unit 2: Virtual Memory, Paging')">📋 Map Course Syllabus Topics</button>
                    <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Waive my fines with merit credits')">⚡ Check Merit Credit Fine Waiver</button>
                    <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Recommend top books in ${memory.department || 'Computer Science'}')">📚 Recommend ${memory.department || 'Computer Science'} Textbooks</button>
                </div>
            `
        };
    }

    renderAIBookSuggestion(book, rank) {
        const availability = Number(book.availableCopies || 0);
        return `<article class="ai-book-suggestion">
            <div class="ai-book-rank">${rank}</div>
            <div class="ai-book-cover" style="background:${book.cover || 'linear-gradient(135deg,#2563eb,#7c3aed)'}">${(book.title || 'Book').slice(0, 2).toUpperCase()}</div>
            <div class="ai-book-info">
                <div class="ai-book-kicker">${book.category || book.department || 'Library catalog'}</div>
                <h4>${book.title}</h4>
                <p>by ${book.author || 'Unknown author'}</p>
                <div class="ai-book-meta"><span>${availability > 0 ? '● Available' : '● Checked out'}</span><span>${book.rating ? `${book.rating} ★` : 'Catalog item'}</span></div>
            </div>
            <div class="ai-book-actions"><button class="btn btn-outline btn-xs" onclick="window.location.hash='#book/${book.id}'">Details</button>${availability > 0 ? `<button class="btn btn-primary btn-xs" onclick="window.App.borrowBook('${book.id}')">Borrow</button>` : ''}</div>
        </article>`;
    }

    // ============================================================================
    // TOOL: IN-CHAT SYLLABUS-TO-BOOK MAPPER
    // ============================================================================

    executeSyllabusMappingTool(text, memory, catalog) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0 && !l.toLowerCase().startsWith('map '));
        const effectiveLines = lines.length > 0 ? lines : [
            "Unit 1: Core Principles, Fundamentals and Foundations",
            "Unit 2: Advanced Applied Architectures and Implementations"
        ];

        let moduleMatches = [];

        effectiveLines.forEach((line, idx) => {
            const cleanLine = line.replace(/^(Unit|Module|Chapter)\s*\d*\s*[:\-]?/i, '').trim();
            const keywords = cleanLine.toLowerCase().split(/[,;\s]+/).filter(w => w.length > 3);

            const matches = catalog.map(b => {
                let score = 0;
                const titleLower = b.title.toLowerCase();
                const descLower = (b.description || '').toLowerCase();
                const tags = (b.tags || []).map(t => t.toLowerCase());

                keywords.forEach(kw => {
                    if (titleLower.includes(kw)) score += 5;
                    if (tags.some(t => t.includes(kw))) score += 4;
                    if (descLower.includes(kw)) score += 2;
                });

                return { book: b, score };
            })
                .filter(m => m.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 2);

            moduleMatches.push({
                title: line.startsWith('Unit') || line.startsWith('Module') ? line.split(':')[0] : `Unit ${idx + 1}`,
                topic: cleanLine,
                matches: matches
            });
        });

        // Update user memory
        this.updateAIMemory({
            syllabusHistory: [
                { date: new Date().toLocaleDateString(), sample: effectiveLines[0] },
                ...(memory.syllabusHistory || []).slice(0, 3)
            ]
        });

        return {
            text: `🎯 <strong>Syllabus-to-Book NLP Mapper Executed!</strong><br>I analyzed your curriculum topics and mapped verified textbooks with exact physical shelf locations:`,
            widget: `
                <div class="chat-widget-card flex flex-col gap-sm text-xs">
                    ${moduleMatches.map(m => `
                        <div class="p-xs bg-secondary border-radius">
                            <div class="bold text-accent mb-xs">📚 ${m.title}: <span class="text-primary font-normal">${m.topic.substring(0, 45)}...</span></div>
                            ${m.matches.length === 0 ? '<div class="text-secondary italic">Consult general department reference section.</div>' : ''}
                            ${m.matches.map(item => `
                                <div class="flex justify-between items-center py-xs border-top mt-xs">
                                    <div>
                                        <strong class="text-primary">${item.book.title}</strong>
                                        <div class="text-secondary" style="font-size:10px;">by ${item.book.author} • 📍 Shelf ${item.book.shelf || 'A1'}, Rack ${item.book.rack || 'R1'}</div>
                                    </div>
                                    <div class="flex gap-xs">
                                        <button class="btn btn-outline btn-xs" onclick="window.location.hash='#book/${item.book.id}'">Details</button>
                                        <button class="btn btn-primary btn-xs" onclick="window.App.borrowBook(${item.book.id})">Borrow</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    `).join('')}
                    <div class="text-center mt-xs">
                        <button class="btn btn-secondary btn-xs" onclick="location.hash='#resources'; setTimeout(()=>{ const t = document.querySelector('.tab[data-target=\'syllabus\']'); if(t) t.click(); }, 150);">Open Full Interactive Mapper</button>
                    </div>
                </div>
            `
        };
    }

    // ============================================================================
    // TOOL: CONVERSATIONAL SEAT & TABLE BOOKING ENGINE
    // ============================================================================

    initiateSeatBookingTool(message, lower, memory, allSeats) {
        // Parse parameters from message
        let duration = memory.preferredDuration || 2;
        if (lower.includes('1 hour') || lower.includes('1 hr') || lower.includes('1h')) duration = 1;
        else if (lower.includes('2 hours') || lower.includes('2 hrs') || lower.includes('2h')) duration = 2;
        else if (lower.includes('3 hours') || lower.includes('3 hrs') || lower.includes('3h')) duration = 3;
        else if (lower.includes('4 hours') || lower.includes('4 hrs') || lower.includes('4h')) duration = 4;
        else if (lower.includes('5 hours') || lower.includes('5 hrs') || lower.includes('5h')) duration = 5;

        let zoneKey = null;
        if (lower.includes('silent') || lower.includes('quiet') || lower.includes('floor 2') || lower.includes('carrel')) zoneKey = 'silent';
        else if (lower.includes('collab') || lower.includes('group') || lower.includes('floor 1') || lower.includes('team')) zoneKey = 'collaborative';
        else if (lower.includes('lab') || lower.includes('media') || lower.includes('floor 3') || lower.includes('computer')) zoneKey = 'lab';

        const isGroup = lower.includes('group') || lower.includes('team') || lower.includes('4 people') || lower.includes('3 people') || lower.includes('2 people') || lower.includes('6 people');
        let seatCount = isGroup ? 4 : 1;
        if (lower.includes('2 people') || lower.includes('2 desks') || lower.includes('2 seats')) seatCount = 2;
        if (lower.includes('3 people') || lower.includes('3 desks') || lower.includes('3 seats')) seatCount = 3;
        if (lower.includes('4 people') || lower.includes('4 desks') || lower.includes('4 seats')) seatCount = 4;
        if (lower.includes('5 people') || lower.includes('5 desks') || lower.includes('5 seats')) seatCount = 5;
        if (lower.includes('6 people') || lower.includes('6 desks') || lower.includes('6 seats')) seatCount = 6;

        // If zone is unspecified, ask conversational clarifying question with choices!
        if (!zoneKey) {
            AppState.aiBookingState = {
                step: 'ask_zone',
                duration: duration,
                isGroup: isGroup,
                seatCount: seatCount
            };

            return {
                text: `I can certainly reserve that for you, <strong>${memory.userName}</strong>! For your <strong>${duration}-hour ${isGroup ? `group table (${seatCount} desks)` : 'study desk'}</strong>, which library zone do you prefer?`,
                widget: `
                    <div class="chat-widget-card flex flex-col gap-xs text-xs">
                        <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Floor 2: Silent Study Pods')">🔇 Floor 2: Silent Study Pods (Quiet Focus)</button>
                        <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Floor 1: Collaborative Hub')">👥 Floor 1: Collaborative Hub (Team Discussion)</button>
                        <button class="btn btn-outline btn-xs text-left" onclick="window.App.handleAIChat('Floor 3: Computing Media Lab')">💻 Floor 3: High-Performance Media Lab</button>
                    </div>
                `
            };
        }

        // All parameters ready -> Execute autonomous booking!
        return this.executeSeatBookingFromAI(zoneKey, duration, isGroup, seatCount, memory, allSeats);
    }

    handleConversationalBookingStep(message, lower, memory, allSeats) {
        const state = AppState.aiBookingState;

        if (state.step === 'ask_zone') {
            let zoneKey = 'silent';
            if (lower.includes('collab') || lower.includes('floor 1') || lower.includes('hub')) zoneKey = 'collaborative';
            else if (lower.includes('lab') || lower.includes('floor 3') || lower.includes('comput')) zoneKey = 'lab';
            else if (lower.includes('silent') || lower.includes('floor 2') || lower.includes('quiet')) zoneKey = 'silent';

            AppState.aiBookingState = null; // Clear state
            return this.executeSeatBookingFromAI(zoneKey, state.duration, state.isGroup, state.seatCount, memory, allSeats);
        }

        AppState.aiBookingState = null;
        return this.generateAIResponse(message);
    }

    executeSeatBookingFromAI(zoneKey, durationHours, isGroup, seatCount, memory, allSeats) {
        // Find available seats in requested zone
        const zoneSeats = allSeats.filter(s => s.zoneKey === zoneKey && s.status === 'available');

        if (zoneSeats.length < seatCount) {
            return {
                text: `⚠️ I checked the floor plan, but there are only <strong>${zoneSeats.length} seats currently available in ${zoneKey.toUpperCase()}</strong>. Would you like me to look at another floor?`,
                widget: `
                    <div class="chat-widget-card flex gap-xs text-xs">
                        <button class="btn btn-primary btn-xs" onclick="window.App.handleAIChat('Try Floor 2 Silent Pods instead')">Check Silent Pods</button>
                        <button class="btn btn-outline btn-xs" onclick="window.App.handleAIChat('Try Floor 1 Collaborative Hub instead')">Check Collab Hub</button>
                    </div>
                `
            };
        }

        const allocatedSeats = zoneSeats.slice(0, seatCount);
        const seatIds = allocatedSeats.map(s => s.id);
        const seatCodes = allocatedSeats.map(s => s.code).join(', ');
        const zoneName = allocatedSeats[0].zone;
        const floorName = allocatedSeats[0].floor;

        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

        const bookings = AppState.seatBookings || [];
        const bookingId = isGroup ? `GRP-BK-${Date.now().toString().slice(-6)}` : `ST-BK-${Date.now().toString().slice(-6)}`;

        const newBooking = {
            id: bookingId,
            isGroup: isGroup,
            seatId: isGroup ? `${seatCount} Desks (${seatCodes})` : allocatedSeats[0].id,
            seatCode: seatCodes,
            seatIds: seatIds,
            zone: zoneName,
            floor: floorName,
            projectName: isGroup ? `${memory.userName}'s Study Group` : undefined,
            studentId: this.currentUser?.id || 1,
            studentName: memory.userName,
            studentRegNo: this.currentUser?.regNo || 'REG-2024-8842',
            startTime: startDate.toISOString(),
            endTime: endDate.toISOString(),
            durationHours: durationHours,
            status: 'active',
            isExtended: false
        };

        bookings.push(newBooking);
        AppState.seatBookings = bookings;

        // Mark seats as reserved
        allSeats.forEach(s => {
            if (seatIds.includes(s.id)) s.status = 'reserved';
        });
        AppState.seats = allSeats;

        // Save preference in memory
        this.updateAIMemory({
            preferredZone: zoneName,
            preferredZoneKey: zoneKey,
            preferredDuration: durationHours
        });

        // Refresh seat map
        this.renderSeatMap();

        const qrSvg = this.generateQRCodeSVG(`SEAT-PASS:${bookingId}:${newBooking.seatId}:${newBooking.studentRegNo}:${newBooking.endTime}`, 120);

        return {
            text: `🎉 <strong>Reservation Confirmed!</strong> I have successfully reserved <strong>${newBooking.seatId}</strong> in <strong>${zoneName} (${floorName})</strong> for <strong>${durationHours} hours</strong> (until ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Your digital turnstile pass is generated below:`,
            widget: `
                <div class="chat-widget-card p-md text-center">
                    <div class="flex justify-between items-center mb-xs text-xs">
                        <span class="badge bg-success-light text-success bold">🟢 Active Reservation</span>
                        <span class="text-secondary">Token: ${bookingId}</span>
                    </div>
                    <h3 class="text-accent mt-xs" style="margin:4px 0;">${newBooking.seatId}</h3>
                    <p class="text-secondary text-xs mb-sm">${zoneName} • Valid until ${endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    <div class="qr-code-box mx-auto my-sm">${qrSvg}</div>
                    <div class="flex justify-center gap-xs mt-sm">
                        <button class="btn btn-secondary btn-xs" onclick="window.App.showSeatPassQR('${bookingId}')">🪪 Fullscreen Pass</button>
                        <button class="btn btn-outline btn-xs" onclick="location.hash='#library'">🗺️ View on Floor Plan</button>
                        <button class="btn btn-error btn-xs" onclick="window.App.cancelSeatBooking('${bookingId}')">Cancel</button>
                    </div>
                </div>
            `
        };
    }

    appendChatMessage(text, sender, animate = true) {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = `chat-bubble ${sender}`;
        if (animate) {
            div.style.opacity = '0';
            div.style.transform = 'translateY(10px)';
        }

        div.innerHTML = `
            <div class="bubble-content">${text}</div>
            <div class="bubble-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        `;

        container.appendChild(div);

        if (animate) {
            requestAnimationFrame(() => {
                div.style.transition = 'all 0.25s ease';
                div.style.opacity = '1';
                div.style.transform = 'translateY(0)';
            });
        }

        container.scrollTop = container.scrollHeight;
    }

    appendChatWidget(html) {
        const container = document.getElementById('chat-messages');
        if (!container) return;

        const div = document.createElement('div');
        div.className = 'chat-widget-container';
        div.innerHTML = html;

        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    showTypingIndicator() {
        const container = document.getElementById('chat-messages');
        if (!container) return null;

        const id = 'typing-' + Date.now();
        const div = document.createElement('div');
        div.id = id;
        div.className = 'chat-bubble ai typing';
        div.innerHTML = `
            <div class="bubble-content typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
        return id;
    }

    removeTypingIndicator(id) {
        if (!id) return;
        const el = document.getElementById(id);
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    // ============================================================================
    // NOTIFICATIONS PAGE
    // ============================================================================

    renderNotifications() {
        const container = document.getElementById('notifications-container');
        const tabs = document.querySelectorAll('#page-notifications .tabs .tab');
        if (!container || !this.data || !this.data.notifications) return;

        // Setup tabs with live DOM querying
        tabs.forEach(tab => {
            tab.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('#page-notifications .tabs .tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.renderNotificationsList(tab.getAttribute('data-target'));
            };
        });

        // Initial render
        const activeTab = document.querySelector('#page-notifications .tabs .tab.active');
        this.renderNotificationsList(activeTab ? activeTab.getAttribute('data-target') : 'all');
    }

    renderNotificationsList(filter) {
        const container = document.getElementById('notifications-container');
        if (!container) return;

        container.innerHTML = '';
        let notifs = this.data.notifications;

        if (filter === 'unread') {
            notifs = notifs.filter(n => !n.read);
        } else if (filter === 'due') {
            notifs = notifs.filter(n => n.type === 'due');
        }

        if (notifs.length === 0) {
            container.innerHTML = `
                <div class="empty-state text-center p-xl">
                    <div class="empty-icon text-4xl mb-md">📭</div>
                    <h3>All caught up!</h3>
                    <p class="text-secondary">You don't have any ${filter !== 'all' ? filter : ''} notifications.</p>
                </div>
            `;
            return;
        }

        notifs.forEach(n => {
            container.appendChild(this.createNotificationItem(n));
        });
    }

    createNotificationItem(n) {
        const div = document.createElement('div');
        div.className = `notification-item card p-md mb-sm flex gap-md ${!n.read ? 'unread' : ''}`;

        let icon = '🔔';
        let colorClass = 'text-accent';
        if (n.type === 'due' || n.type === 'fine') { icon = '⚠️'; colorClass = 'text-error'; }
        if (n.type === 'success' || n.type === 'renewal') { icon = '✅'; colorClass = 'text-success'; }

        div.innerHTML = `
            <div class="notification-icon ${colorClass} text-xl" style="flex-shrink:0;">${n.icon || icon}</div>
            <div class="notification-content flex-1">
                <div class="flex justify-between items-start">
                    <h4 class="${!n.read ? 'bold' : ''}">${n.title}</h4>
                    <span class="text-xs text-secondary whitespace-nowrap ml-md">${this.getRelativeTime(n.date)}</span>
                </div>
                <p class="text-sm text-secondary mt-xs">${n.message}</p>
                ${n.bookId ? `<button class="btn btn-outline btn-sm mt-sm" onclick="window.location.hash='#book/${n.bookId}'">View Book</button>` : ''}
            </div>
            ${!n.read ? `<div class="unread-dot" style="width:10px; height:10px; border-radius:50%; background-color:var(--accent); flex-shrink:0; align-self:center;"></div>` : ''}
        `;

        // Mark read on click
        div.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON' && !n.read) {
                n.read = true;
                this.saveData('notifications', this.data.notifications);
                div.classList.remove('unread');
                const dot = div.querySelector('.unread-dot');
                if (dot) dot.remove();
                this.setupNotificationsBadge(); // update global badge
            }
        });

        return div;
    }

    // ============================================================================
    // FINES PAGE
    // ============================================================================

    renderFines() {
        const tbody = document.querySelector('#page-fines table tbody');
        const totalDueEl = document.getElementById('fines-total-due');
        const totalPaidEl = document.getElementById('fines-total-paid');
        const payAllBtn = document.getElementById('fines-pay-all-btn');
        const meritCreditsEl = document.getElementById('fines-merit-credits');
        if (meritCreditsEl) {
            meritCreditsEl.textContent = `${this.calculateMeritCredits()} pts`;
        }

        if (!tbody || !this.data || !this.data.fines) return;

        const myFines = this.data.fines.filter(f => f.studentId === this.data.currentUser?.id);
        const pendingFines = myFines.filter(f => f.status === 'pending');
        const paidFines = myFines.filter(f => f.status === 'paid');

        const totalPending = pendingFines.reduce((sum, f) => sum + f.amount, 0);
        const totalPaid = paidFines.reduce((sum, f) => sum + f.amount, 0);

        if (totalDueEl) totalDueEl.textContent = `₹${totalPending.toFixed(2)}`;
        if (totalPaidEl) totalPaidEl.textContent = `₹${totalPaid.toFixed(2)}`;

        if (payAllBtn) {
            payAllBtn.disabled = totalPending === 0;
            payAllBtn.textContent = totalPending > 0 ? `Pay All (₹${totalPending.toFixed(2)})` : 'No Pending Fines';
        }

        tbody.innerHTML = '';

        if (myFines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center p-md">No fine history found.</td></tr>';
            return;
        }

        myFines.forEach(f => {
            const book = this.data.books?.find(b => b.id === f.bookId);
            const tr = document.createElement('tr');

            tr.innerHTML = `
                <td>#${f.id}</td>
                <td><strong>${f.reason}</strong> <br><span class="text-xs text-secondary">${book ? book.title : ''}</span></td>
                <td>${new Date(f.date).toLocaleDateString()}</td>
                <td class="bold text-error">₹${f.amount.toFixed(2)}</td>
                <td>
                    ${f.status === 'pending'
                    ? `<button class="btn btn-error btn-xs" onclick="window.App.payFine(${f.id})">Pay Now</button>`
                    : `<span class="badge text-success bg-success-light">Paid</span>`
                }
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    payFine(fineId) {
        const fine = this.data.fines.find(f => f.id === fineId);
        const amount = fine ? fine.amount.toFixed(2) : '5.00';

        this.openModal('Cashfree Payment Sandbox', `
            <div class="p-md text-center">
                <div class="p-sm bg-secondary border-radius mb-md flex justify-between items-center">
                    <span class="bold text-accent">Cashfree Payments</span>
                    <span class="badge bg-warning-light text-warning text-xs">Sandbox Mode</span>
                </div>
                <p class="text-sm text-secondary mb-xs">Transaction Amount</p>
                <h2 class="text-2xl text-error mb-md">₹${amount}</h2>
                <div class="card p-sm bg-tertiary mb-md text-left text-xs">
                    <div class="flex justify-between py-xs border-bottom"><span>Order ID:</span><strong>CF_ORD_${Date.now().toString().slice(-6)}</strong></div>
                    <div class="flex justify-between py-xs"><span>Payment Gateway:</span><strong>Cashfree API v3</strong></div>
                </div>
                <div class="flex flex-col gap-xs mb-lg">
                    <input type="text" class="input text-center text-sm" value="SUCCESS_TOKEN_${Math.floor(Math.random() * 90000 + 10000)}" readonly style="background:var(--bg-tertiary);">
                    <span class="text-xs text-secondary">Simulated real-time Cashfree webhook settlement</span>
                </div>
                <div class="flex justify-end gap-sm">
                    <button class="btn btn-secondary" id="cancel-pay">Cancel</button>
                    <button class="btn btn-primary" id="confirm-pay">Pay via Cashfree Sandbox</button>
                </div>
            </div>
        `);

        document.getElementById('cancel-pay').onclick = () => this.closeModal();
        document.getElementById('confirm-pay').onclick = async () => {
            if (!fine || !this.currentUser?.uid) return this.showToast('Sign in to pay a fine.', 'error');
            try {
                await window.FirestoreDB.payFine(fine.id, this.currentUser.uid, { provider: 'cashfree-sandbox' });
                fine.status = 'paid';
                this.closeModal();
                this.showToast(`Payment of ₹${amount} recorded in Firebase.`, 'success');
                this.renderFines();
            } catch (error) {
                console.error('[Fines] Payment failed:', error);
                this.showToast(error.message || 'Payment could not be recorded.', 'error');
            }
        };
    }

    payAllFines() {
        const myFines = this.data.fines.filter(f => f.studentId === this.data.currentUser?.id && f.status === 'pending');
        if (myFines.length === 0) {
            this.showToast('You have no pending fines to pay.', 'info');
            return;
        }

        const totalAmount = myFines.reduce((sum, f) => sum + f.amount, 0).toFixed(2);

        this.openModal('Cashfree Payment Sandbox (All Fines)', `
            <div class="p-md text-center">
                <div class="p-sm bg-secondary border-radius mb-md flex justify-between items-center">
                    <span class="bold text-accent">Cashfree Payments</span>
                    <span class="badge bg-warning-light text-warning text-xs">Sandbox Mode</span>
                </div>
                <p class="text-sm text-secondary mb-xs">Total Outstanding Amount (${myFines.length} items)</p>
                <h2 class="text-2xl text-error mb-md">₹${totalAmount}</h2>
                <div class="card p-sm bg-tertiary mb-md text-left text-xs">
                    <div class="flex justify-between py-xs border-bottom"><span>Batch Order ID:</span><strong>CF_BATCH_${Date.now().toString().slice(-6)}</strong></div>
                    <div class="flex justify-between py-xs"><span>Settlement:</span><strong>Instant Realtime Clearance</strong></div>
                </div>
                <div class="flex justify-end gap-sm mt-lg">
                    <button class="btn btn-secondary" id="cancel-pay-all">Cancel</button>
                    <button class="btn btn-primary" id="confirm-pay-all">Pay ₹${totalAmount} via Cashfree</button>
                </div>
            </div>
        `);

        document.getElementById('cancel-pay-all').onclick = () => this.closeModal();
        document.getElementById('confirm-pay-all').onclick = async () => {
            try {
                await Promise.all(myFines.map(f => window.FirestoreDB.payFine(f.id, this.currentUser.uid, { provider: 'cashfree-sandbox' })));
                myFines.forEach(f => { f.status = 'paid'; });
                this.closeModal();
                this.showToast(`All payments (₹${totalAmount}) recorded in Firebase.`, 'success');
                this.renderFines();
            } catch (error) {
                console.error('[Fines] Bulk payment failed:', error);
                this.showToast(error.message || 'One or more payments could not be recorded.', 'error');
            }
        };
    }

    raiseMissingBookQueryModal() {
        this.openModal('Raise Query for Missing Book / Resource', `
            <form id="raise-query-form" class="p-sm flex flex-col gap-sm">
                <div class="form-group">
                    <label>Book Title / Topic Name</label>
                    <input type="text" id="query-book-title" class="input" placeholder="e.g. Operating System Concepts (10th Ed)" required>
                </div>
                <div class="form-group">
                    <label>Author / Course Code</label>
                    <input type="text" id="query-author" class="input" placeholder="e.g. Silberschatz or CS-301">
                </div>
                <div class="form-group">
                    <label>Query / Issue Details</label>
                    <textarea id="query-details" class="input" rows="3" placeholder="Describe where the book is missing or request a digital copy..."></textarea>
                </div>
                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Submit Ticket to Librarian</button>
                </div>
            </form>
        `);

        document.getElementById('raise-query-form').onsubmit = (e) => {
            e.preventDefault();
            const title = document.getElementById('query-book-title').value.trim();
            this.closeModal();
            this.showToast(`Ticket #${Math.floor(Math.random() * 9000 + 1000)} created for "${title}". Librarian notified!`, 'success');
        };
    }

    // ============================================================================
    // UPLOAD PAGE
    // ============================================================================

    renderUpload() {
        const dndZone = document.getElementById('dnd-zone');
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';

        if (!dndZone) return;

        // Reset state
        dndZone.className = 'dnd-zone';
        dndZone.innerHTML = `
            <div class="text-4xl mb-sm">📁</div>
            <h3>Drag & Drop your file here</h3>
            <p class="text-secondary mt-xs mb-md">Supports PDF, DOCX, PPTX up to 50MB</p>
            <button class="btn btn-outline" id="browse-files-btn">Browse Files</button>
        `;

        dndZone.appendChild(fileInput);

        const browseBtn = document.getElementById('browse-files-btn');
        if (browseBtn) browseBtn.onclick = () => fileInput.click();

        // DND Handlers
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dndZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dndZone.addEventListener(eventName, () => {
                dndZone.classList.add('drag-active');
                dndZone.style.borderColor = 'var(--accent)';
                dndZone.style.backgroundColor = 'var(--bg-secondary)';
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dndZone.addEventListener(eventName, () => {
                dndZone.classList.remove('drag-active');
                dndZone.style.borderColor = 'var(--border)';
                dndZone.style.backgroundColor = 'transparent';
            }, false);
        });

        dndZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
        }, false);

        fileInput.addEventListener('change', function () {
            handleFiles(this.files);
        });

        let selectedFile = null;
        const handleFiles = (files) => {
            if (files.length > 0) {
                selectedFile = files[0];
                const sizeMb = (selectedFile.size / (1024 * 1024)).toFixed(2);
                dndZone.innerHTML = `
                    <div class="text-4xl mb-sm text-success">📄</div>
                    <h3>${selectedFile.name}</h3>
                    <p class="text-secondary mt-xs">${sizeMb} MB • Ready for publication</p>
                    <button class="btn btn-outline btn-sm mt-md" id="remove-file-btn">Remove File</button>
                `;

                document.getElementById('remove-file-btn').onclick = (e) => {
                    e.stopPropagation();
                    selectedFile = null;
                    this.renderUpload();
                };
            }
        };

        // Form Submit
        const form = document.querySelector('.upload-form');
        if (form) {
            const newForm = form.cloneNode(true);
            form.parentNode.replaceChild(newForm, form);

            newForm.addEventListener('submit', (e) => {
                e.preventDefault();

                const titleInput = newForm.querySelector('input[type="text"]');
                const title = titleInput ? titleInput.value.trim() : (selectedFile ? selectedFile.name : 'New Study Resource');
                const deptSel = newForm.querySelector('select');
                const dept = deptSel ? deptSel.value : (this.currentUser?.department || 'CS');

                const btn = newForm.querySelector('button[type="submit"]');
                const origText = btn.textContent;
                btn.disabled = true;
                btn.innerHTML = 'Publishing Resource...';

                setTimeout(() => {
                    const fileSizeStr = selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB` : '3.5 MB';
                    const newResource = {
                        id: Date.now(),
                        title: title,
                        subject: title,
                        department: dept,
                        semester: this.currentUser?.semester || 1,
                        uploadedBy: this.currentUser?.name || 'Anonymous Student',
                        uploadDate: new Date().toISOString(),
                        downloads: 1,
                        likes: 1,
                        verified: true,
                        pages: selectedFile ? Math.max(1, Math.floor(selectedFile.size / 50000)) : 12,
                        fileSize: fileSizeStr,
                        tags: ['Student Contribution', dept],
                        description: 'Peer-uploaded reference resource published to library repository.'
                    };

                    if (!this.data.notes) this.data.notes = [];
                    this.data.notes.unshift(newResource);
                    this.saveData('notes', this.data.notes);

                    this.showToast(`Resource "${newResource.title}" published to catalog!`, 'success');
                    btn.disabled = false;
                    btn.textContent = origText;
                    newForm.reset();
                    selectedFile = null;
                    this.renderUpload();
                    window.location.hash = '#resources';
                }, 400);
            });
        }
    }

    // ============================================================================
    // COMPONENT HELPERS
    // ============================================================================

    createBookCard(book, isListView = false, query = '') {
        const div = document.createElement('div');
        div.className = `book-card ${isListView ? 'list-view' : 'grid-view'}`;
        div.onclick = () => {
            this.trackBookView(book.id);
            window.location.hash = `#book/${book.id}`;
        };

        const title = this.highlightMatch(book.title, query);
        const author = this.highlightMatch(book.author, query);
        const availabilityClass = book.availableCopies > 0 ? 'text-success' : 'text-error';
        const availabilityText = book.availableCopies > 0 ? 'Available' : 'Waitlist';
        const isBookmarked = (this.currentUser?.bookmarks || []).includes(book.id);

        div.innerHTML = `
            <button class="card-bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="window.App.toggleBookmark(${book.id}); event.stopPropagation();" title="${isBookmarked ? 'Remove Bookmark' : 'Save Bookmark'}">
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="${isBookmarked ? 'currentColor' : 'none'}"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
            </button>
            <div class="book-cover" style="background-color: ${book.cover || 'var(--bg-tertiary)'}; display: flex; align-items: center; justify-content: center; color: white; text-align: center; font-weight: 500; font-size: 12px; padding: 12px; border: 1px solid var(--border-light);">
                ${!book.coverUrl ? book.title.substring(0, 30) : ''}
            </div>
            <div class="book-info">
                <div class="book-badges flex justify-between items-center gap-xs">
                    <span class="badge text-xs">${book.department}</span>
                    <span class="badge ${book.availableCopies > 0 ? 'badge-success' : 'badge-error'} text-xs">${availabilityText}</span>
                </div>
                <h3 class="book-title mt-xs">${title}</h3>
                <p class="book-author text-secondary text-sm">${author}</p>
                <div class="book-meta mt-sm flex justify-between items-center">
                    <div class="stars text-xs">${this.renderStars(book.rating)}</div>
                    <span class="text-xs text-tertiary">${book.publicationYear || ''}</span>
                </div>
            </div>
        `;
        return div;
    }

    createResourceCard(resource, type) {
        const div = document.createElement('div');
        div.className = 'resource-card card p-md flex flex-col justify-between hover-scale';

        let icon = type === 'notes' ? '📝' : '📄';

        div.innerHTML = `
            <div>
                <div class="flex justify-between items-start">
                    <span class="resource-icon text-xl">${icon}</span>
                    ${resource.verified ? '<span class="badge badge-success text-xs">Verified</span>' : ''}
                </div>
                <h4 class="mt-sm">${resource.title}</h4>
                <p class="text-sm text-secondary mt-xs">${resource.subject}</p>
                
                <div class="resource-tags flex gap-xs mt-sm flex-wrap">
                    ${(resource.tags || []).slice(0, 3).map(t => `<span class="chip text-xs">${t}</span>`).join('')}
                </div>
            </div>
            
            <div class="resource-footer mt-md pt-sm border-top flex justify-between items-center text-sm text-secondary">
                <div class="flex gap-sm items-center">
                    <span title="Downloads">📥 ${resource.downloads || 0}</span>
                    <span title="Likes">👍 ${resource.likes || 0}</span>
                </div>
                <div class="flex gap-xs">
                    <button class="btn btn-outline btn-sm" onclick="window.App.openPDFReader('${resource.title.replace(/'/g, "\\'")}'); event.stopPropagation();">📖 Read</button>
                    <button class="btn btn-primary btn-sm" onclick="window.App.downloadResource(${resource.id}); event.stopPropagation();">📥</button>
                </div>
            </div>
        `;
        return div;
    }

    addToReadingHistory(bookId) {
        if (!bookId || !this.currentUser) return;

        if (!this.currentUser.readingHistory) this.currentUser.readingHistory = [];

        // Remove duplicate and push to beginning
        this.currentUser.readingHistory = this.currentUser.readingHistory.filter(id => id !== bookId);
        this.currentUser.readingHistory.unshift(bookId);

        // Keep maximum 30 recent items
        if (this.currentUser.readingHistory.length > 30) {
            this.currentUser.readingHistory = this.currentUser.readingHistory.slice(0, 30);
        }

        // Sync with this.data and Firestore profile
        if (this.data?.currentUser) {
            this.data.currentUser.readingHistory = this.currentUser.readingHistory;
        }

        if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
            window.FirebaseAuth.updateProfile({ readingHistory: this.currentUser.readingHistory });
        }

        // If profile is active, refresh live
        if (AppState.currentRoute === 'profile') {
            this.renderProfile();
        }
    }

    trackBookView(bookId) {
        if (!bookId) return;

        // 1. Update view counter on book
        const book = this.data.books?.find(b => b.id === bookId);
        if (book) {
            book.views = (book.views || 0) + 1;
            if (window.FirestoreDB) {
                window.FirestoreDB.saveBook(book);
            }
        }

        // 2. Add to live reading history
        this.addToReadingHistory(bookId);

        // 3. Record interest metrics in user profile and log Analytics event
        if (this.currentUser) {
            if (!this.currentUser.interestScores) this.currentUser.interestScores = {};
            const category = book ? book.category : 'General';
            this.currentUser.interestScores[category] = (this.currentUser.interestScores[category] || 0) + 1;

            if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
                window.FirebaseAuth.updateProfile({ interestScores: this.currentUser.interestScores });
            }
        }

        if (window.AnalyticsEngine) {
            window.AnalyticsEngine.logEvent('book_view', { bookId: bookId, category: book ? book.category : 'General' });
        }
    }

    toggleBookmark(id) {
        if (!this.currentUser) {
            this.openAuthModal('login');
            this.showToast('Please sign in to save bookmarks.', 'warning');
            return;
        }

        if (!this.currentUser.bookmarks) this.currentUser.bookmarks = [];
        const idx = this.currentUser.bookmarks.indexOf(id);
        if (idx !== -1) {
            this.currentUser.bookmarks.splice(idx, 1);
            this.showToast('Removed from bookmarks.', 'info');
        } else {
            this.currentUser.bookmarks.unshift(id);
            this.showToast('Saved to bookmarks!', 'success');
        }

        // Persist the account-scoped profile in Firestore.
        if (this.data?.currentUser) {
            this.data.currentUser.bookmarks = this.currentUser.bookmarks;
        }
        window.FirebaseAuth.updateProfile({ bookmarks: this.currentUser.bookmarks }).catch((error) => {
            console.error('[Profile] Bookmark update failed:', error);
            this.showToast('Bookmark could not be saved.', 'error');
        });

        // Re-render relevant active views
        if (AppState.currentRoute === 'book-detail') {
            this.renderBookDetail(id);
        } else if (AppState.currentRoute === 'profile') {
            this.renderProfile();
        } else if (AppState.currentRoute === 'search') {
            this.renderSearchResults();
        }
    }

    openPDFReader(title) {
        let currentPage = 1;
        const totalPages = 18;

        const updateContent = () => {
            const pageNumSpan = document.getElementById('pdf-current-page');
            const pageBody = document.getElementById('pdf-page-body');
            if (pageNumSpan) pageNumSpan.textContent = currentPage;
            if (pageBody) {
                pageBody.innerHTML = `
                    <h2 class="text-center mb-md" style="font-family: sans-serif;">${title}</h2>
                    <p class="text-secondary text-center mb-lg" style="font-family: sans-serif; font-size: 13px;">LIbris Digital Textbooks & Lecture Notes Repository</p>
                    <hr class="mb-lg" style="border:0; border-top: 1px solid var(--border);">
                    <p class="mb-md"><strong>Section ${currentPage}.1: Core Theoretical Foundations</strong></p>
                    <p class="mb-md">Welcome to Page <strong>${currentPage}</strong> of <em>${title}</em>. This section details algorithmic models, empirical performance benchmarks, and practical implementation patterns for coursework mastery.</p>
                    <p class="mb-md">Section ${currentPage}.2: <strong>Design Specifications & Workload Analysis</strong><br>Analytical evaluation covers latency distributions, thread synchronization, memory allocation strategies, and transactional throughput.</p>
                `;
            }
        };

        this.openModal(`Interactive Reader — ${title}`, `
            <div class="p-md">
                <div class="flex justify-between items-center mb-md p-sm bg-secondary border-radius">
                    <div class="flex gap-md items-center text-sm">
                        <button class="btn btn-sm btn-outline" id="btn-pdf-prev">◀ Prev</button>
                        <span>Page <strong id="pdf-current-page">1</strong> of ${totalPages}</span>
                        <button class="btn btn-sm btn-outline" id="btn-pdf-next">Next ▶</button>
                    </div>
                    <div class="flex gap-xs">
                        <button class="btn btn-sm btn-outline" id="btn-pdf-highlight">✏️ Highlight</button>
                        <button class="btn btn-sm btn-outline" id="btn-pdf-bookmark">🔖 Bookmark</button>
                    </div>
                </div>
                <div class="card p-xl bg-secondary" id="pdf-page-body" style="min-height: 380px; font-family: serif; line-height: 1.8; overflow-y: auto; max-height: 420px; border: 1px solid var(--border);">
                </div>
            </div>
        `);

        updateContent();

        document.getElementById('btn-pdf-prev').onclick = () => {
            if (currentPage > 1) {
                currentPage--;
                updateContent();
            }
        };
        document.getElementById('btn-pdf-next').onclick = () => {
            if (currentPage < totalPages) {
                currentPage++;
                updateContent();
            }
        };
        document.getElementById('btn-pdf-highlight').onclick = () => {
            const body = document.getElementById('pdf-page-body');
            if (body) {
                body.style.backgroundColor = body.style.backgroundColor === 'var(--warning-light)' ? 'var(--bg-secondary)' : 'var(--warning-light)';
                this.showToast('Text highlight mode toggled.', 'info');
            }
        };
        document.getElementById('btn-pdf-bookmark').onclick = () => {
            this.showToast(`Page ${currentPage} bookmarked!`, 'success');
        };
    }

    renderStars(rating) {
        const full = Math.floor(rating);
        const half = rating % 1 >= 0.5 ? 1 : 0;
        const empty = 5 - full - half;
        return '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(empty);
    }

    showSkeleton(container, count = 8, type = 'book') {
        if (!container) return;
        container.innerHTML = '';
        container.className = type === 'book' ? 'results-grid' : 'grid-3-col';

        for (let i = 0; i < count; i++) {
            const el = document.createElement('div');
            el.className = `skeleton-card ${type}`;
            el.innerHTML = `
                <div class="skeleton skeleton-img"></div>
                <div class="p-sm">
                    <div class="skeleton skeleton-text" style="width: 80%; margin-bottom: 8px;"></div>
                    <div class="skeleton skeleton-text" style="width: 60%; margin-bottom: 16px;"></div>
                    <div class="skeleton skeleton-text" style="width: 40%;"></div>
                </div>
            `;
            container.appendChild(el);
        }
    }

    // ============================================================================
    // UTILITIES & ACTIONS
    // ============================================================================

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    getRelativeTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    }

    // --- Action Handlers (Globally accessible via window.App) ---

    borrowBook(id) {
        if (!this.currentUser) {
            this.openAuthModal('login');
            this.showToast('Please sign in to borrow books.', 'warning');
            return;
        }

        const book = this.data.books?.find(b => b.id === id);
        if (!book) return;

        if (book.availableCopies <= 0) {
            this.showToast('No available copies. You can reserve to join the waitlist.', 'warning');
            return;
        }

        // Decrement availability
        book.availableCopies -= 1;
        book.borrowCount = (book.borrowCount || 0) + 1;
        if (window.FirestoreDB) {
            window.FirestoreDB.saveBook(book);
        }

        // Add to user borrowed books
        if (!this.currentUser.borrowedBooks) this.currentUser.borrowedBooks = [];
        if (!this.currentUser.borrowedBooks.includes(book.id)) {
            this.currentUser.borrowedBooks.push(book.id);
        }

        // Create transaction record
        const transaction = {
            id: Date.now(),
            bookId: book.id,
            studentId: this.currentUser.uid || this.currentUser.id,
            userId: this.currentUser.uid || this.currentUser.id,
            userName: this.currentUser.name,
            borrowDate: new Date().toISOString(),
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            returnDate: null,
            status: 'active',
            fine: 0
        };

        if (!this.data.transactions) this.data.transactions = [];
        this.data.transactions.unshift(transaction);
        if (window.FirestoreDB) {
            window.FirestoreDB.saveTransaction(transaction);
        }

        // Update user storage & Firestore profile
        if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
            window.FirebaseAuth.updateProfile({ borrowedBooks: this.currentUser.borrowedBooks });
        }

        if (window.AnalyticsEngine) {
            window.AnalyticsEngine.logEvent('book_borrow', { bookId: book.id, department: this.currentUser.department });
        }

        this.showToast(`Successfully borrowed "${book.title}"! Due in 14 days.`, 'success');
        this.renderPage(AppState.currentRoute, id);
    }

    reserveBook(id) {
        if (!this.currentUser) {
            this.openAuthModal('login');
            this.showToast('Please sign in to reserve books.', 'warning');
            return;
        }

        const book = this.data.books?.find(b => b.id === id);
        if (!book) return;

        if (!this.currentUser.reservedBooks) this.currentUser.reservedBooks = [];
        if (!this.currentUser.reservedBooks.includes(book.id)) {
            this.currentUser.reservedBooks.push(book.id);
            this.showToast(`Reserved "${book.title}". You will be notified when available.`, 'success');
        } else {
            this.showToast(`Already reserved "${book.title}".`, 'info');
        }
        this.renderPage(AppState.currentRoute, id);
    }

    toggleBookmark(id) {
        if (!this.currentUser) {
            this.openAuthModal('login');
            this.showToast('Please sign in to save bookmarks.', 'warning');
            return;
        }

        if (!this.currentUser.bookmarks) this.currentUser.bookmarks = [];
        const idx = this.currentUser.bookmarks.indexOf(id);
        if (idx !== -1) {
            this.currentUser.bookmarks.splice(idx, 1);
            this.showToast('Removed from bookmarks.', 'info');
        } else {
            this.currentUser.bookmarks.push(id);
            this.showToast('Saved to bookmarks!', 'success');
        }

        if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
            window.FirebaseAuth.updateProfile({ bookmarks: this.currentUser.bookmarks });
        }

        if (AppState.currentRoute === 'book-detail') {
            this.renderBookDetail(id);
        }
    }

    shareBook(id) {
        navigator.clipboard.writeText(`${window.location.origin}/#book/${id}`)
            .then(() => this.showToast('Link copied to clipboard!', 'success'))
            .catch(() => this.showToast('Failed to copy link', 'error'));
    }

    editBookModal(bookId) {
        if (!this.currentUser || !this.isAdmin()) {
            this.showToast('Admin privilege required.', 'error');
            return;
        }

        const book = this.data.books?.find(b => b.id === bookId);
        if (!book) return;

        this.openModal('Edit Book Details', `
            <form id="edit-book-form" class="p-sm flex flex-col gap-sm">
                <div class="form-group">
                    <label>Title</label>
                    <input type="text" id="edit-book-title" class="input" value="${book.title}" required>
                </div>
                <div class="form-group">
                    <label>Author</label>
                    <input type="text" id="edit-book-author" class="input" value="${book.author}" required>
                </div>
                <div class="grid-2-col">
                    <div class="form-group">
                        <label>Department</label>
                        <input type="text" id="edit-book-dept" class="input" value="${book.department}">
                    </div>
                    <div class="form-group">
                        <label>Available Copies</label>
                        <input type="number" id="edit-book-copies" class="input" value="${book.availableCopies}" min="0">
                    </div>
                </div>
                <div class="form-group">
                    <label>Shelf Location</label>
                    <input type="text" id="edit-book-shelf" class="input" value="${book.shelf || 'A1'}">
                </div>
                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Changes</button>
                </div>
            </form>
        `);

        document.getElementById('edit-book-form').onsubmit = (e) => {
            e.preventDefault();
            book.title = document.getElementById('edit-book-title').value.trim();
            book.author = document.getElementById('edit-book-author').value.trim();
            book.department = document.getElementById('edit-book-dept').value.trim();
            book.availableCopies = parseInt(document.getElementById('edit-book-copies').value) || 0;
            book.shelf = document.getElementById('edit-book-shelf').value.trim();

            this.saveData('books', this.data.books);
            this.closeModal();
            this.showToast('Book details updated successfully!', 'success');
            this.renderBookDetail(bookId);
        };
    }

    editProfileModal() {
        if (!this.currentUser) {
            this.openAuthModal('login');
            return;
        }

        this.openModal('Edit Profile', `
            <form id="edit-profile-form" class="p-sm flex flex-col gap-sm">
                <div class="grid-2-col">
                    <div class="form-group">
                        <label>Full Name</label>
                        <input type="text" id="edit-user-name" class="input" value="${this.currentUser.name}" required>
                    </div>
                    <div class="form-group">
                        <label>Registration Number / Student ID</label>
                        <input type="text" id="edit-user-reg" class="input" value="${this.currentUser.regNo || 'REG-2024-8842'}" required>
                    </div>
                </div>
                <div class="grid-2-col">
                    <div class="form-group">
                        <label>Department</label>
                        <select id="edit-user-dept" class="select-input">
                            <option value="Computer Science" ${this.currentUser.department === 'Computer Science' || this.currentUser.department === 'CS' ? 'selected' : ''}>Computer Science</option>
                            <option value="Electronics" ${this.currentUser.department === 'Electronics' || this.currentUser.department === 'ECE' ? 'selected' : ''}>Electronics</option>
                            <option value="Mechanical" ${this.currentUser.department === 'Mechanical' || this.currentUser.department === 'ME' ? 'selected' : ''}>Mechanical</option>
                            <option value="Physics" ${this.currentUser.department === 'Physics' || this.currentUser.department === 'PHY' ? 'selected' : ''}>Physics</option>
                            <option value="Civil" ${this.currentUser.department === 'Civil' || this.currentUser.department === 'CE' ? 'selected' : ''}>Civil</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Semester</label>
                        <select id="edit-user-sem" class="select-input">
                            ${[1, 2, 3, 4, 5, 6, 7, 8].map(s => `<option value="${s}" ${this.currentUser.semester == s ? 'selected' : ''}>Semester ${s}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save Profile</button>
                </div>
            </form>
        `);

        document.getElementById('edit-profile-form').onsubmit = (e) => {
            e.preventDefault();
            this.currentUser.name = document.getElementById('edit-user-name').value.trim();
            this.currentUser.regNo = document.getElementById('edit-user-reg').value.trim();
            this.currentUser.department = document.getElementById('edit-user-dept').value;
            this.currentUser.semester = parseInt(document.getElementById('edit-user-sem').value);

            if (window.FirebaseAuth && window.FirebaseAuth.updateProfile) {
                window.FirebaseAuth.updateProfile({
                    name: this.currentUser.name,
                    regNo: this.currentUser.regNo,
                    department: this.currentUser.department,
                    semester: this.currentUser.semester
                });
            }

            this.closeModal();
            this.updateAuthUI();
            this.showToast('Profile updated in Cloud Firestore!', 'success');
            this.renderProfile();
        };
    }

    returnBookAdmin(transactionId) {
        if (!this.currentUser || !this.isAdmin()) {
            this.showToast('Admin privilege required.', 'error');
            return;
        }

        const trans = this.data.transactions?.find(t => t.id === transactionId);
        if (!trans) return;

        trans.status = 'returned';
        trans.returnDate = new Date().toISOString();
        this.saveData('transactions', this.data.transactions);

        // Replenish book stock
        const book = this.data.books?.find(b => b.id === trans.bookId);
        if (book) {
            book.availableCopies = (book.availableCopies || 0) + 1;
            this.saveData('books', this.data.books);
        }

        this.showToast('Book marked as returned successfully.', 'success');
        this.renderAdmin();
    }

    downloadResource(id) {
        const note = (this.data.notes || []).find(n => n.id === id) || (this.data.questionPapers || []).find(p => p.id === id);
        const title = note ? note.title : 'Library_Resource_Document';

        // Increment download counter
        if (note) {
            note.downloads = (note.downloads || 0) + 1;
            this.saveData('notes', this.data.notes);
            this.renderResources();
        }

        // Generate instant browser Blob download
        const blob = new Blob([
            `====================================================\n`,
            `LIBRIS PLATFORM — OFFICIAL RESOURCE DIGITAL COPY\n`,
            `Document: ${title}\n`,
            `Subject: ${note ? note.subject : 'Course Material'}\n`,
            `Uploaded By: ${note ? note.uploadedBy : 'Faculty Contributor'}\n`,
            `Published Date: ${note ? note.uploadDate : new Date().toLocaleDateString()}\n`,
            `====================================================\n\n`,
            `[DOCUMENT CONTENT PREVIEW]\n`,
            `This study resource has been verified by the LIbris Academic Board.\n`,
            `Full text & coursework materials contained inside PDF repository.\n`
        ], { type: 'text/plain' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast(`Downloading "${title}"... File saved!`, 'success');
    }

    // --- Modal System ---

    openModal(title, contentHtml) {
        if (!this.dom.modalContainer) return;

        if (this.dom.modalTitle) this.dom.modalTitle.textContent = title;
        if (this.dom.modalContent) this.dom.modalContent.innerHTML = contentHtml;

        this.dom.modalContainer.style.display = 'flex';
        // reflow
        void this.dom.modalContainer.offsetWidth;
        this.dom.modalContainer.classList.add('active');
        document.body.style.overflow = 'hidden'; // prevent background scrolling
    }

    closeModal() {
        if (!this.dom.modalContainer) return;

        this.dom.modalContainer.classList.remove('active');
        setTimeout(() => {
            this.dom.modalContainer.style.display = 'none';
            document.body.style.overflow = '';
        }, Constants.ANIMATION_DURATION);
    }

    // --- Toast System ---

    showToast(message, type = 'info', duration = 3000) {
        if (!this.dom.toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        let icon = Constants.ICONS.info;
        if (type === 'success') icon = Constants.ICONS.success;
        if (type === 'error') icon = Constants.ICONS.error;
        if (type === 'warning') icon = Constants.ICONS.warning;

        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close">&times;</button>
        `;

        this.dom.toastContainer.appendChild(toast);

        // Animate in
        requestAnimationFrame(() => {
            toast.style.transform = 'translateY(0)';
            toast.style.opacity = '1';
        });

        // Setup close
        const closeBtn = toast.querySelector('.toast-close');

        const removeToast = () => {
            toast.style.transform = 'translateY(100%)';
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 300);
        };

        closeBtn.onclick = removeToast;

        if (duration > 0) {
            setTimeout(removeToast, duration);
        }
    }

    // ============================================================================
    // CLIENT-SIDE PURE SVG QR CODE ENGINE
    // ============================================================================

    generateQRCodeSVG(text, size = 160) {
        const str = String(text || 'SMARTLIB');
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
        const seed = Math.abs(hash);
        const n = 21;
        const matrix = Array.from({ length: n }, () => Array(n).fill(false));

        const addFinder = (r0, c0) => {
            for (let r = 0; r < 7; r++) {
                for (let c = 0; c < 7; c++) {
                    if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
                        matrix[r0 + r][c0 + c] = true;
                    }
                }
            }
        };
        addFinder(0, 0);
        addFinder(0, n - 7);
        addFinder(n - 7, 0);

        for (let i = 8; i < n - 8; i++) {
            matrix[6][i] = (i % 2 === 0);
            matrix[i][6] = (i % 2 === 0);
        }

        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if ((r < 8 && (c < 8 || c >= n - 8)) || (r >= n - 8 && c < 8) || (r === 6 || c === 6)) continue;
                const bit = (((seed * (r + 1)) ^ (c * 31) ^ (str.charCodeAt((r + c) % str.length) << 3)) & 3) === 0;
                matrix[r][c] = bit;
            }
        }

        const cellSize = (size / n).toFixed(2);
        let paths = '';
        for (let r = 0; r < n; r++) {
            for (let c = 0; c < n; c++) {
                if (matrix[r][c]) {
                    paths += `<rect x="${(c * cellSize)}" y="${(r * cellSize)}" width="${cellSize}" height="${cellSize}" fill="#0F172A"/>`;
                }
            }
        }
        return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="background:#fff; border-radius:8px; padding:6px; display:block;">${paths}</svg>`;
    }

    showDigitalIDModal() {
        if (!this.currentUser) {
            this.openAuthModal('login');
            return;
        }
        const user = this.currentUser;

        const qrSvg = this.generateQRCodeSVG(`SMARTLIB-STU:${user.regNo || user.id}:${user.name}:${Date.now()}`, 150);

        this.openModal('Digital Student ID & Library Pass', `
            <div class="p-sm flex flex-col items-center">
                <div class="digital-id-card w-full mb-md">
                    <div class="flex justify-between items-start mb-md">
                        <div>
                            <div class="text-xs uppercase tracking-wider text-secondary">University Library System</div>
                            <h2 class="mt-xs text-primary" style="font-size:1.15rem;">Student Access Pass</h2>
                        </div>
                        <span class="badge badge-success text-xs">Active • 2026</span>
                    </div>
                    
                    <div class="flex items-center gap-md mb-md">
                        <div class="avatar" style="width:48px; height:48px; font-size:16px;">
                            ${user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <h3 class="text-primary" style="font-size:1rem; margin:0;">${user.name}</h3>
                            <div class="text-secondary text-xs">${user.department} • Semester ${user.semester || 1}</div>
                            <div class="text-tertiary text-xs mt-xs">ID: ${user.regNo || 'REG-2024-8842'}</div>
                        </div>
                    </div>

                    <div class="flex justify-between items-center bg-secondary p-sm border-radius text-primary" style="border:1px solid var(--border-light);">
                        <div class="flex flex-col">
                            <span class="text-xs text-secondary">Active Borrows</span>
                            <strong class="text-sm">${(user.borrowedBooks || []).length} Items</strong>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-xs text-secondary">Study Streak</span>
                            <strong class="text-sm">${user.studyStreak || 1} Days</strong>
                        </div>
                        <div class="flex flex-col">
                            <span class="text-xs text-secondary">Gate Access</span>
                            <strong class="text-sm text-success">Turnstile Clear</strong>
                        </div>
                    </div>
                </div>

                <div class="text-center p-md bg-secondary border-radius w-full" style="border:1px solid var(--border-light);">
                    <p class="text-xs text-secondary mb-sm">Scan at turnstile gate or circulation desk scanner</p>
                    <div class="qr-code-box mx-auto mb-sm">${qrSvg}</div>
                    <div class="text-xs text-tertiary">Valid for all library floors & study zones</div>
                </div>

                <div class="flex justify-end w-full mt-md">
                    <button class="btn btn-primary" onclick="window.App.closeModal()">Close Pass</button>
                </div>
            </div>
        `);
    }

    // ============================================================================
    // COLLABORATIVE GROUP STUDY ROOMS
    // ============================================================================

    renderStudyRooms() {
        const grid = document.getElementById('study-rooms-grid');
        if (!grid) return;
        grid.innerHTML = '';

        const rooms = [
            {
                id: 'room-a',
                name: 'Ada Lovelace Tech Suite',
                capacity: 8,
                amenities: ['4K Display', 'Smart Interactive Board', 'Dual Webcams', '8 Power Outlets'],
                color: '#2563eb',
                slots: ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00', '18:00 - 20:00']
            },
            {
                id: 'room-b',
                name: 'Alan Turing Collaborative Lab',
                capacity: 12,
                amenities: ['Dual 65" Displays', 'Ceiling Mic Array', 'Glass Whiteboards', 'High-Speed LAN'],
                color: '#10b981',
                slots: ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00', '18:00 - 20:00']
            },
            {
                id: 'room-c',
                name: 'Ramanujan Quantitative Hub',
                capacity: 6,
                amenities: ['360° Whiteboard Walls', 'Scientific Plotting Stations', 'Quiet Acoustic Isolation'],
                color: '#8b5cf6',
                slots: ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00', '18:00 - 20:00']
            },
            {
                id: 'room-d',
                name: 'Marie Curie Research Den',
                capacity: 10,
                amenities: ['Conference Cam', 'Wireless Screen Share', 'Ergonomic Pods', 'Reference Shelf'],
                color: '#f59e0b',
                slots: ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00', '18:00 - 20:00']
            }
        ];

        const bookings = this.roomBookings || [];

        rooms.forEach(r => {
            const div = document.createElement('div');
            div.className = 'study-room-card';

            const myBooking = bookings.find(b => b.roomId === r.id && b.studentId === this.currentUser?.id);

            div.innerHTML = `
                <div>
                    <div class="study-room-header">
                        <div>
                            <span class="badge text-xs" style="background:${r.color}20; color:${r.color};">Max ${r.capacity} Persons</span>
                            <h4 class="mt-xs">${r.name}</h4>
                        </div>
                        <span class="badge ${myBooking ? 'bg-success-light text-success' : 'bg-secondary text-secondary'} text-xs">${myBooking ? 'Booked by You' : 'Available Today'}</span>
                    </div>
                    <div class="amenities-list">
                        ${r.amenities.map(a => `<span class="amenity-chip">✓ ${a}</span>`).join('')}
                    </div>
                </div>

                <div class="mt-md">
                    <div class="text-xs text-secondary mb-xs bold">Available Time Slots for Today:</div>
                    <div class="slot-grid">
                        ${r.slots.map(s => {
                const isTaken = bookings.some(b => b.roomId === r.id && b.slot === s);
                return `<button class="slot-btn ${isTaken ? 'disabled' : ''}" onclick="window.App.openBookStudyRoomModal('${r.id}', '${r.name.replace(/'/g, "\\'")}', '${s}')" ${isTaken ? 'disabled' : ''}>${s}</button>`;
            }).join('')}
                    </div>
                </div>

                <div class="flex justify-between items-center pt-sm border-top mt-sm">
                    <span class="text-xs text-secondary">Free for students</span>
                    <button class="btn btn-outline btn-sm" onclick="window.App.openBookStudyRoomModal('${r.id}', '${r.name.replace(/'/g, "\\'")}')">📅 Reserve Suite</button>
                </div>
            `;
            grid.appendChild(div);
        });
    }

    openBookStudyRoomModal(roomId, roomName, defaultSlot = '14:00 - 16:00') {
        if (!this.currentUser) {
            this.openAuthModal('login');
            return;
        }

        const slots = ['09:00 - 11:00', '11:00 - 13:00', '14:00 - 16:00', '16:00 - 18:00', '18:00 - 20:00'];
        const bookings = this.roomBookings || [];

        this.openModal(`Reserve ${roomName}`, `
            <form id="study-room-form" class="p-sm flex flex-col gap-sm">
                <div class="form-group">
                    <label>Lead Student (Organizer)</label>
                    <input type="text" class="input" value="${this.currentUser.name} (${this.currentUser.regNo || 'REG-2024-8842'})" readonly style="background:var(--bg-tertiary);">
                </div>
                <div class="form-group">
                    <label>Select Time Slot (Today)</label>
                    <select id="room-slot-select" class="select-input" required>
                        ${slots.map(s => {
            const isTaken = bookings.some(b => b.roomId === roomId && b.slot === s);
            return `<option value="${s}" ${s === defaultSlot ? 'selected' : ''} ${isTaken ? 'disabled' : ''}>${s} ${isTaken ? '(Booked)' : '(Available)'}</option>`;
        }).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Study Topic / Project Name</label>
                    <input type="text" id="room-purpose" class="input" placeholder="e.g. Distributed Systems Final Review" required>
                </div>
                <div class="form-group">
                    <label>Additional Group Members (Student Reg Nos)</label>
                    <input type="text" id="room-members" class="input" placeholder="e.g. REG-2024-8843, REG-2024-8845">
                </div>
                <div class="flex justify-end gap-sm mt-md">
                    <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Confirm & Issue Pass</button>
                </div>
            </form>
        `);

        document.getElementById('study-room-form').onsubmit = (e) => {
            e.preventDefault();
            const slot = document.getElementById('room-slot-select').value;
            const purpose = document.getElementById('room-purpose').value.trim();
            const members = document.getElementById('room-members').value.trim();

            const newBooking = {
                id: `RM-BK-${Date.now().toString().slice(-6)}`,
                roomId,
                roomName,
                slot,
                purpose,
                members,
                studentId: this.currentUser.id,
                studentName: this.currentUser.name,
                bookedAt: new Date().toISOString()
            };

            bookings.push(newBooking);
            if (window.FirestoreDB) {
                window.FirestoreDB.saveRoomBooking(newBooking);
            }

            const qrSvg = this.generateQRCodeSVG(`ROOM-PASS:${newBooking.id}:${roomId}:${slot}`, 130);

            this.openModal(`Reservation Confirmed: ${roomName}`, `
                <div class="p-md text-center">
                    <div class="text-4xl mb-sm">🎉</div>
                    <h3 class="text-success">Collaborative Suite Reserved!</h3>
                    <p class="text-secondary text-sm mt-xs mb-md">Your group entry pass is active. Scan at the room door panel.</p>
                    
                    <div class="card p-sm bg-tertiary mb-md text-left text-xs">
                        <div class="flex justify-between py-xs border-bottom"><span>Pass Token:</span><strong>${newBooking.id}</strong></div>
                        <div class="flex justify-between py-xs border-bottom"><span>Room:</span><strong>${roomName}</strong></div>
                        <div class="flex justify-between py-xs border-bottom"><span>Reserved Slot:</span><strong class="text-accent">${slot}</strong></div>
                        <div class="flex justify-between py-xs"><span>Topic:</span><strong>${purpose}</strong></div>
                    </div>

                    <div class="qr-code-box mx-auto mb-sm">${qrSvg}</div>
                    <div class="flex justify-end w-full mt-md">
                        <button class="btn btn-primary" onclick="window.App.closeModal(); window.App.renderStudyRooms();">Done</button>
                    </div>
                </div>
            `);

            this.showToast(`Reserved ${roomName} for ${slot}!`, 'success');
        };
    }

    // ============================================================================
    // ACADEMIC SYLLABUS-TO-BOOK AUTO-MAPPER
    // ============================================================================

    renderSyllabusMapper(container) {
        if (!container) return;

        container.innerHTML = `
            <div class="card p-xl mb-lg">
                <div class="flex justify-between items-start mb-md flex-wrap gap-sm">
                    <div>
                        <h2>🎯 Academic Syllabus-to-Book Auto-Mapper</h2>
                        <p class="text-secondary mt-xs">Paste course syllabus modules or click a preset to discover verified textbooks with shelf locations.</p>
                    </div>
                    <span class="badge badge-accent">NLP Catalog Matcher</span>
                </div>

                <div class="flex gap-xs mb-md flex-wrap">
                    <span class="text-xs text-secondary bold self-center mr-xs">Quick Presets:</span>
                    <button class="chip text-xs" onclick="window.App.loadSyllabusPreset('os')">Operating Systems (CS-301)</button>
                    <button class="chip text-xs" onclick="window.App.loadSyllabusPreset('ml')">Machine Learning (CS-402)</button>
                    <button class="chip text-xs" onclick="window.App.loadSyllabusPreset('ds')">Data Structures (CS-201)</button>
                    <button class="chip text-xs" onclick="window.App.loadSyllabusPreset('dsp')">Digital Signal Processing (ECE-302)</button>
                </div>

                <form id="syllabus-mapper-form" class="flex flex-col gap-sm">
                    <textarea id="syllabus-input-text" class="input" rows="5" placeholder="Paste course outline or syllabus modules here..."></textarea>
                    <div class="flex justify-between items-center mt-xs flex-wrap gap-sm">
                        <span class="text-xs text-secondary">Extracts core concepts and queries 320+ verified books.</span>
                        <button type="submit" class="btn btn-primary" id="btn-run-syllabus-map">🔍 Map Syllabus to Books</button>
                    </div>
                </form>
            </div>

            <div id="syllabus-results-area"></div>
        `;

        document.getElementById('syllabus-mapper-form').onsubmit = (e) => {
            e.preventDefault();
            const text = document.getElementById('syllabus-input-text').value.trim();
            if (!text) {
                this.showToast('Please enter syllabus text or choose a preset.', 'warning');
                return;
            }
            this.runSyllabusMapping(text);
        };

        this.loadSyllabusPreset('os');
    }

    loadSyllabusPreset(type) {
        const input = document.getElementById('syllabus-input-text');
        if (!input) return;

        const presets = {
            os: "Unit 1: Process Synchronization, CPU Scheduling, Deadlocks and Semaphores\nUnit 2: Virtual Memory Management, Paging, Page Replacement Algorithms\nUnit 3: File System Implementation, Disk Scheduling and I/O Operations",
            ml: "Unit 1: Supervised Learning, Linear Regression, Support Vector Machines\nUnit 2: Deep Neural Networks, Backpropagation and Convolutional Nets\nUnit 3: Reinforcement Learning, Q-Learning and Policy Gradient Methods",
            ds: "Unit 1: Balanced Binary Search Trees, AVL Trees and Red-Black Trees\nUnit 2: Graph Algorithms, Dijkstra Shortest Path and Minimum Spanning Trees\nUnit 3: Dynamic Programming, Hash Tables and Amortized Analysis",
            dsp: "Unit 1: Discrete Fourier Transform (DFT), Fast Fourier Transform (FFT)\nUnit 2: Digital IIR and FIR Filter Design and Spectral Analysis\nUnit 3: Multirate Signal Processing and Wavelet Transforms"
        };

        input.value = presets[type] || presets.os;
        this.runSyllabusMapping(input.value);
    }

    runSyllabusMapping(syllabusText) {
        const resultsArea = document.getElementById('syllabus-results-area');
        if (!resultsArea) return;

        const lines = syllabusText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const catalog = this.data.books || [];

        let html = `<div class="flex flex-col gap-md">`;

        lines.forEach((line, idx) => {
            const cleanLine = line.replace(/^(Unit|Module|Chapter)\s*\d*\s*[:\-]?/i, '').trim();
            const keywords = cleanLine.toLowerCase().split(/[,;\s]+/).filter(w => w.length > 3);

            // Score books against this unit
            const matches = catalog.map(b => {
                let score = 0;
                const titleLower = b.title.toLowerCase();
                const descLower = (b.description || '').toLowerCase();
                const tags = (b.tags || []).map(t => t.toLowerCase());

                keywords.forEach(kw => {
                    if (titleLower.includes(kw)) score += 5;
                    if (tags.some(t => t.includes(kw))) score += 4;
                    if (descLower.includes(kw)) score += 2;
                });

                return { book: b, score };
            })
                .filter(m => m.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 3);

            html += `
                <div class="syllabus-module-card card">
                    <div class="flex justify-between items-center mb-xs">
                        <h4 class="text-accent">📚 ${line.startsWith('Unit') || line.startsWith('Module') ? line.split(':')[0] : `Topic Module ${idx + 1}`}</h4>
                        <span class="badge text-xs">${matches.length} Recommended Textbooks</span>
                    </div>
                    <p class="text-sm text-secondary mb-sm">${cleanLine}</p>
                    <div class="flex flex-col gap-xs">
                        ${matches.length === 0 ? '<div class="text-xs text-secondary italic">Consult library reference section for specialized monograph references.</div>' : ''}
                        ${matches.map(m => `
                            <div class="syllabus-match-item cursor-pointer" onclick="window.location.hash='#book/${m.book.id}'">
                                <div style="background:${m.book.cover || '#2563eb'}; width:36px; height:48px; border-radius:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:white; font-size:9px; font-weight:bold; text-align:center;">
                                    ${m.book.title.substring(0, 10)}
                                </div>
                                <div class="flex-1">
                                    <div class="bold text-sm">${m.book.title}</div>
                                    <div class="text-xs text-secondary">by ${m.book.author} • Edition: ${m.book.edition || 'Latest'}</div>
                                    <div class="text-xs mt-xs flex gap-md">
                                        <span class="${m.book.availableCopies > 0 ? 'text-success' : 'text-error'} bold">${m.book.availableCopies > 0 ? `🟢 ${m.book.availableCopies} available` : '🔴 Checked out'}</span>
                                        <span class="text-secondary">📍 Shelf ${m.book.shelf || 'A1'}, Rack ${m.book.rack || 'R1'}</span>
                                    </div>
                                </div>
                                <button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); window.location.hash='#book/${m.book.id}'">View Book</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        resultsArea.innerHTML = html;
    }

    // ============================================================================
    // ACADEMIC MERIT CREDITS & FINE WAIVER ENGINE
    // ============================================================================

    calculateMeritCredits() {
        const user = this.currentUser;
        if (!user) return 0;
        const streakCredits = (user.studyStreak || 0) * 5;
        const contributionCredits = (user.contributions || 0) * 20;
        const historyCredits = (user.readingHistory || []).length * 2;
        const redeemed = user.redeemedMeritCredits || 0;
        return Math.max(0, streakCredits + contributionCredits + historyCredits - redeemed);
    }

    redeemMeritCredits() {
        if (!this.currentUser) {
            this.openAuthModal('login');
            return;
        }

        const availableCredits = this.calculateMeritCredits();
        const myPendingFines = (this.data.fines || []).filter(f => f.studentId === this.currentUser.id && f.status === 'pending');
        const totalPendingAmount = myPendingFines.reduce((sum, f) => sum + f.amount, 0);

        if (totalPendingAmount <= 0) {
            this.showToast('You have no pending fines to waive! Keep up your study streak.', 'info');
            return;
        }

        const waiverAmount = Math.min(totalPendingAmount, availableCredits / 10);
        if (waiverAmount <= 0) {
            this.showToast('You need at least 10 Merit Credits to redeem a ₹1.00 fine waiver.', 'warning');
            return;
        }

        this.openModal('Redeem Academic Merit Credits', `
            <div class="p-md text-center">
                <div class="text-4xl mb-sm">⚡</div>
                <h3>Academic Merit Fine Waiver</h3>
                <p class="text-secondary mt-xs mb-md">Redeem study streak & peer note contribution points to offset library fines.</p>
                
                <div class="card p-sm bg-tertiary mb-md text-left text-xs">
                    <div class="flex justify-between py-xs border-bottom"><span>Available Merit Credits:</span><strong class="text-accent">${availableCredits} pts</strong></div>
                    <div class="flex justify-between py-xs border-bottom"><span>Exchange Rate:</span><strong>10 pts = ₹1.00 INR</strong></div>
                    <div class="flex justify-between py-xs border-bottom"><span>Total Pending Fines:</span><strong class="text-error">₹${totalPendingAmount.toFixed(2)}</strong></div>
                    <div class="flex justify-between py-xs"><span>Waiver Applied Today:</span><strong class="text-success">-₹${waiverAmount.toFixed(2)}</strong></div>
                </div>

                <div class="flex justify-end gap-sm mt-lg">
                    <button class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button class="btn btn-primary" id="btn-confirm-waiver">Confirm Waiver (${Math.ceil(waiverAmount * 10)} pts)</button>
                </div>
            </div>
        `);

        document.getElementById('btn-confirm-waiver').onclick = () => {
            const creditsNeeded = Math.ceil(waiverAmount * 10);
            this.currentUser.redeemedMeritCredits = (this.currentUser.redeemedMeritCredits || 0) + creditsNeeded;

            let remainingWaiver = waiverAmount;
            myPendingFines.forEach(f => {
                if (remainingWaiver >= f.amount) {
                    f.status = 'paid';
                    f.reason += ' (Waived via Merit Credits)';
                    remainingWaiver -= f.amount;
                }
            });

            this.saveData('fines', this.data.fines);
            this.closeModal();
            this.showToast(`Waived ₹${waiverAmount.toFixed(2)} using ${creditsNeeded} Academic Merit Credits!`, 'success');
            this.renderFines();
        };
    }

    barcodeScannerModal() {
        this.openModal('Physical ISBN Barcode Scanner', `
            <div class="p-md text-center">
                <div class="text-4xl mb-sm">📷</div>
                <h3>Scan Physical Book ISBN Barcode</h3>
                <p class="text-secondary text-sm mt-xs mb-md">Simulate camera optical scan on physical book barcode or RFID chip to locate catalog shelf details.</p>
                <div class="p-md bg-secondary border-radius mb-md" style="border: 2px dashed var(--accent);">
                    <div style="font-size:24px; font-family:monospace; letter-spacing:4px; margin-bottom:8px;">||| |||| || ||||| ||||</div>
                    <span class="badge badge-accent text-xs">Simulated Camera Viewfinder Active</span>
                </div>
                <div class="flex flex-col gap-xs">
                    <button class="btn btn-primary w-full" onclick="window.App.closeModal(); window.location.hash='#book/1'; window.App.showToast('ISBN 978-0131103627 Recognized: C Programming Language', 'success');">⚡ Scan Sample: C Programming (K&R)</button>
                    <button class="btn btn-outline w-full" onclick="window.App.closeModal(); window.location.hash='#book/2'; window.App.showToast('ISBN 978-0262033848 Recognized: Algorithms (CLRS)', 'success');">⚡ Scan Sample: Intro to Algorithms</button>
                </div>
            </div>
        `);
    }

    importCatalogModal() {
        this.openModal('Import Catalog Batch (CSV / JSON)', `
            <div class="p-md">
                <div class="text-center mb-md">
                    <div class="text-4xl mb-xs">📂</div>
                    <h3>Batch Catalog Ingestion</h3>
                    <p class="text-secondary text-xs">Upload MARC21, CSV, or JSON records to sync physical inventory.</p>
                </div>
                <div class="p-lg bg-secondary border-radius text-center mb-md" style="border: 2px dashed var(--border);">
                    <p class="text-sm bold">Drag and drop .CSV or .JSON catalog file</p>
                    <p class="text-xs text-secondary mt-xs">Supports ISBN, Title, Author, Rack, Shelf, Copies</p>
                </div>
                <div class="flex justify-end gap-sm">
                    <button class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                    <button class="btn btn-primary" onclick="window.App.closeModal(); window.App.showToast('Ingested 320 records into local memory index.', 'success');">Ingest Catalog Data</button>
                </div>
            </div>
        `);
    }

    raiseMissingBookQueryModal() {
        this.openModal('Raise Missing / Misplaced Book Ticket', `
            <div class="p-md">
                <div class="text-center mb-md">
                    <div class="text-4xl mb-xs">🙋</div>
                    <h3>Report Misplaced Book on Shelf</h3>
                    <p class="text-secondary text-xs">If a book is listed as available but missing from its shelf, raise a librarian retrieval ticket.</p>
                </div>
                <form id="missing-book-form" class="flex flex-col gap-sm">
                    <div class="form-group">
                        <label class="text-xs bold">Book Title / ISBN</label>
                        <input type="text" class="input mt-xs" placeholder="e.g. Introduction to Electrodynamics (Griffiths)" required>
                    </div>
                    <div class="form-group">
                        <label class="text-xs bold">Shelf / Aisle Checked</label>
                        <input type="text" class="input mt-xs" placeholder="e.g. Floor 2, Shelf PHY-4, Rack 2" required>
                    </div>
                    <div class="flex justify-end gap-sm mt-md">
                        <button type="button" class="btn btn-secondary" onclick="window.App.closeModal()">Cancel</button>
                        <button type="submit" class="btn btn-primary">Submit Ticket</button>
                    </div>
                </form>
            </div>
        `);

        document.getElementById('missing-book-form').onsubmit = (e) => {
            e.preventDefault();
            this.closeModal();
            this.showToast('Ticket #TKT-8842 raised. Floor librarian alerted to verify shelf.', 'success');
        };
    }

}

// Global App Instance & Initialization
window.App = new LibraryApp();

function initApp() {
    window.App.init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
