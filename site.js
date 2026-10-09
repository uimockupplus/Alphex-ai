/* =========================================================
   ALPHEX AI — SHARED SITE SYSTEM
   Navigation + Theme + Authentication + Interactions
   + Global Alphex Minibot
   ========================================================= */
(() => {
  'use strict';
  /* =========================================================
     CONFIGURATION
     ========================================================= */
  const SUPABASE_URL =
    'https://nxqxhakjbtdzreimpkdz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_kzCF-pWoVk27YRqvWPIUzg_36ynJbGR';
  let supabaseClient = null;
  /* =========================================================
     SUPABASE
     ========================================================= */
  function getSupabaseClient() {
    if (!window.supabase) {
      return null;
    }
    /*
     * Reuse the same client if another Alphex script
     * has already created one.
     */
    if (window.alphexSupabase) {
      supabaseClient = window.alphexSupabase;
      return supabaseClient;
    }
    supabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    );
    window.alphexSupabase = supabaseClient;
    return supabaseClient;
  }
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase) {
        resolve();
        return;
      }
      const existing = document.querySelector(
        'script[data-alphex-supabase]'
      );
      if (existing) {
        existing.addEventListener('load', resolve, {
          once: true
        });
        existing.addEventListener('error', reject, {
          once: true
        });
        return;
      }
      const script = document.createElement('script');
      script.src =
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.dataset.alphexSupabase = 'true';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  /* =========================================================
     SHARED COMPONENTS
     ========================================================= */
  async function loadComponent(selector, file) {
    const container = document.querySelector(selector);
    if (!container) {
      return false;
    }
    try {
      const response = await fetch(file, {
        cache: 'no-store'
      });
      if (!response.ok) {
        throw new Error(
          `Failed to load ${file}: ${response.status}`
        );
      }
      container.innerHTML = await response.text();
      return true;
    } catch (error) {
      console.error(
        `Alphex AI: failed to load ${file}`,
        error
      );
      return false;
    }
  }
  async function loadSharedComponents() {
    await loadComponent('#site-nav', '/nav.html');
    await loadComponent('#site-footer', '/footer.html');
  }
  /* =========================================================
     AUTH ELEMENTS
     ========================================================= */
  function getAuthElements() {
    return {
      loginNavButton:
        document.getElementById('loginNavButton'),
      authProfile:
        document.getElementById('authProfile'),
      profileButton:
        document.getElementById('profileButton'),
      profileMenu:
        document.getElementById('profileMenu'),
      profileInitial:
        document.getElementById('profileInitial'),
      profileName:
        document.getElementById('profileName'),
      profileEmail:
        document.getElementById('profileEmail'),
      profileSignout:
        document.getElementById('profileSignout'),
      mobileLoginLink:
        document.getElementById('mobileLoginLink'),
      mobileProfileLink:
        document.getElementById('mobileProfileLink')
    };
  }
  /* =========================================================
     USER DISPLAY
     ========================================================= */
  function getUserDisplayName(user) {
    if (!user) {
      return 'Alphex AI';
    }
    const metadata = user.user_metadata || {};
    const fullName =
      metadata.full_name ||
      metadata.name ||
      '';
    if (
      typeof fullName === 'string' &&
      fullName.trim()
    ) {
      return fullName.trim();
    }
    if (user.email) {
      return user.email.split('@')[0];
    }
    return 'Alphex AI';
  }
  function getProfileInitial(name) {
    if (!name) {
      return 'A';
    }
    return (
      name.trim().charAt(0).toUpperCase() || 'A'
    );
  }
  /* =========================================================
     LOGGED OUT
     ========================================================= */
  function showLoggedOutNavigation() {
    const elements = getAuthElements();
    document.body.classList.remove('authenticated');
    if (elements.loginNavButton) {
      elements.loginNavButton.style.display =
        'inline-flex';
    }
    if (elements.authProfile) {
      elements.authProfile.style.display = 'none';
    }
    if (elements.mobileLoginLink) {
      elements.mobileLoginLink.style.display = 'flex';
    }
    if (elements.mobileProfileLink) {
      elements.mobileProfileLink.style.display = 'none';
    }
    if (elements.profileMenu) {
      elements.profileMenu.classList.remove('open');
    }
    if (elements.profileButton) {
      elements.profileButton.setAttribute(
        'aria-expanded',
        'false'
      );
    }
  }
  /* =========================================================
     LOGGED IN
     ========================================================= */
  function showLoggedInNavigation(user) {
    if (!user) {
      showLoggedOutNavigation();
      return;
    }
    const elements = getAuthElements();
    document.body.classList.add('authenticated');
    const name = getUserDisplayName(user);
    const initial = getProfileInitial(name);
    if (elements.loginNavButton) {
      elements.loginNavButton.style.display = 'none';
    }
    if (elements.authProfile) {
      elements.authProfile.style.display = 'inline-flex';
    }
    if (elements.profileInitial) {
      elements.profileInitial.textContent = initial;
    }
    if (elements.profileName) {
      elements.profileName.textContent = name;
    }
    if (elements.profileEmail) {
      elements.profileEmail.textContent =
        user.email || 'Signed in';
    }
    if (elements.mobileLoginLink) {
      elements.mobileLoginLink.style.display = 'none';
    }
    if (elements.mobileProfileLink) {
      elements.mobileProfileLink.style.display = 'flex';
    }
  }
  /* =========================================================
     SESSION CHECK
     ========================================================= */
  async function updateAuthenticationUI() {
    const client = getSupabaseClient();
    if (!client) {
      console.error(
        'Alphex AI: Supabase client unavailable.'
      );
      showLoggedOutNavigation();
      return;
    }
    try {
      const { data, error } =
        await client.auth.getSession();
      if (error) {
        console.error(
          'Alphex AI: session error',
          error
        );
        showLoggedOutNavigation();
        return;
      }
      const session = data?.session || null;
      if (session && session.user) {
        showLoggedInNavigation(session.user);
      } else {
        showLoggedOutNavigation();
      }
    } catch (error) {
      console.error(
        'Alphex AI: authentication error',
        error
      );
      showLoggedOutNavigation();
    }
  }
  /* =========================================================
     AUTH EVENTS
     ========================================================= */
  function initializeAuthentication() {
    const client = getSupabaseClient();
    if (!client) {
      return;
    }
    /*
     * Check the existing session first.
     */
    updateAuthenticationUI();
    /*
     * Keep every page synchronized with login,
     * logout, token refresh, and other auth events.
     */
    client.auth.onAuthStateChange(
      (_event, session) => {
        if (session && session.user) {
          showLoggedInNavigation(session.user);
        } else {
          showLoggedOutNavigation();
        }
      }
    );
  }
  /* =========================================================
     PROFILE MENU
     ========================================================= */
  function initializeProfileMenu() {
    const elements = getAuthElements();
    if (
      !elements.profileButton ||
      !elements.profileMenu
    ) {
      return;
    }
    elements.profileButton.addEventListener(
      'click',
      event => {
        event.stopPropagation();
        const isOpen =
          elements.profileMenu.classList.contains('open');
        elements.profileMenu.classList.toggle(
          'open',
          !isOpen
        );
        elements.profileButton.setAttribute(
          'aria-expanded',
          String(!isOpen)
        );
      }
    );
    document.addEventListener('click', event => {
      if (
        elements.authProfile &&
        !elements.authProfile.contains(event.target)
      ) {
        elements.profileMenu.classList.remove('open');
        elements.profileButton.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    });
    if (elements.profileSignout) {
      elements.profileSignout.addEventListener(
        'click',
        async () => {
          const client = getSupabaseClient();
          if (!client) {
            return;
          }
          elements.profileSignout.disabled = true;
          elements.profileSignout.textContent =
            'Signing out...';
          try {
            const { error } =
              await client.auth.signOut();
            if (error) {
              throw error;
            }
            window.location.replace('/index.html');
          } catch (error) {
            console.error(
              'Alphex AI: sign out error',
              error
            );
            elements.profileSignout.disabled = false;
            elements.profileSignout.textContent =
              'Sign out';
          }
        }
      );
    }
    if (elements.mobileProfileLink) {
      elements.mobileProfileLink.addEventListener(
        'click',
        event => {
          event.preventDefault();
          if (elements.profileMenu) {
            elements.profileMenu.classList.toggle('open');
          }
          closeMobileMenu();
        }
      );
    }
  }
  /* =========================================================
     THEME
     ========================================================= */
  function initializeTheme() {
    const root = document.documentElement;
    const body = document.body;
    const themeToggle = document.querySelector(
      '.theme-toggle'
    );
    if (!themeToggle) {
      return;
    }
    const getSavedTheme = () => {
      try {
        return window.localStorage.getItem(
          'alphex-theme'
        );
      } catch (_error) {
        return null;
      }
    };
    const saveTheme = theme => {
      try {
        window.localStorage.setItem(
          'alphex-theme',
          theme
        );
      } catch (_error) {
        /*
         * Theme still works for this visit.
         */
      }
    };
    const setTheme = theme => {
      const dark = theme === 'dark';
      body.classList.toggle('dark-theme', dark);
      root.classList.toggle('dark-theme', dark);
      themeToggle.setAttribute(
        'aria-pressed',
        String(dark)
      );
      themeToggle.setAttribute(
        'aria-label',
        dark
          ? 'Switch to light mode'
          : 'Switch to dark mode'
      );
      const icon = themeToggle.querySelector(
        '.theme-icon'
      );
      const label = themeToggle.querySelector(
        '.theme-label'
      );
      if (icon) {
        icon.textContent = dark ? '☀' : '☾';
      }
      if (label) {
        label.textContent = dark ? 'Light' : 'Dark';
      }
      saveTheme(dark ? 'dark' : 'light');
    };
    setTheme(getSavedTheme() || 'light');
    themeToggle.addEventListener('click', () => {
      setTheme(
        body.classList.contains('dark-theme')
          ? 'light'
          : 'dark'
      );
    });
  }
  /* =========================================================
     MOBILE NAVIGATION
     ========================================================= */
  let closeMobileMenu = () => {};
  function initializeMobileNavigation() {
    const menuButton = document.querySelector(
      '.mobile-menu'
    );
    const mobilePanel = document.querySelector(
      '.mobile-panel'
    );
    if (!menuButton || !mobilePanel) {
      return;
    }
    closeMobileMenu = () => {
      menuButton.classList.remove('open');
      menuButton.setAttribute(
        'aria-expanded',
        'false'
      );
      mobilePanel.classList.remove('open');
      mobilePanel.setAttribute(
        'aria-hidden',
        'true'
      );
    };
    menuButton.addEventListener('click', () => {
      const open =
        !mobilePanel.classList.contains('open');
      menuButton.classList.toggle('open', open);
      menuButton.setAttribute(
        'aria-expanded',
        String(open)
      );
      mobilePanel.classList.toggle('open', open);
      mobilePanel.setAttribute(
        'aria-hidden',
        String(!open)
      );
    });
    mobilePanel
      .querySelectorAll('a')
      .forEach(link => {
        link.addEventListener(
          'click',
          closeMobileMenu
        );
      });
  }
  /* =========================================================
     ANCHOR NAVIGATION
     ========================================================= */
  function initializeAnchorNavigation() {
    document
      .querySelectorAll('a[href^="#"]')
      .forEach(link => {
        link.addEventListener('click', event => {
          const target = link.getAttribute('href');
          if (!target || target === '#') {
            return;
          }
          const element =
            document.querySelector(target);
          if (!element) {
            return;
          }
          event.preventDefault();
          element.scrollIntoView({
            behavior: 'smooth'
          });
          closeMobileMenu();
        });
      });
  }
  /* =========================================================
     REACTIVE VISUALS
     ========================================================= */
  function initializeReactiveVisuals() {
    const reactive = document.querySelectorAll(
      '.hero-stage, .feature-visual'
    );
    reactive.forEach(panel => {
      panel.addEventListener('pointermove', event => {
        const rect = panel.getBoundingClientRect();
        const x =
          (event.clientX - rect.left) /
            rect.width -
          0.5;
        const y =
          (event.clientY - rect.top) /
            rect.height -
          0.5;
        panel.style.setProperty('--mx', x.toFixed(3));
        panel.style.setProperty('--my', y.toFixed(3));
      });
      panel.addEventListener('pointerleave', () => {
        panel.style.setProperty('--mx', '0');
        panel.style.setProperty('--my', '0');
      });
    });
  }
  /* =========================================================
     ALPHEX AI — GLOBAL CHATBOT LOADER
     Automatically adds Alphex Minibot to every page
     that loads site.js.
     ========================================================= */
  async function loadAlphexChatbot() {
    /*
     * Reuse an existing root if the page already has one.
     * Otherwise, create it automatically.
     */
    let root = document.getElementById(
      'alphex-chatbot-root'
    );
    if (!root) {
      root = document.createElement('div');
      root.id = 'alphex-chatbot-root';
      document.body.appendChild(root);
    }
    /*
     * Prevent the chatbot HTML from being injected twice.
     */
    if (root.dataset.loaded === 'true') {
      return;
    }
    root.dataset.loaded = 'true';
    try {
      /*
       * Load the chatbot interface.
       */
      const response = await fetch(
        '/chatbot/chatbot.html',
        { cache: 'no-cache' }
      );
      if (!response.ok) {
        throw new Error(
          `Failed to load chatbot HTML: ${response.status}`
        );
      }
      root.innerHTML = await response.text();
      /*
       * Load the controller after the interface exists.
       */
      const existingScript = document.querySelector(
        'script[data-alphex-chatbot-script="true"]'
      );
      if (existingScript) {
        return;
      }
      const script = document.createElement('script');
      script.src = '/chatbot/chatbot.js';
      script.dataset.alphexChatbotScript = 'true';
      script.async = true;
      script.onload = () => {
        console.log(
          '[Alphex Minibot] Loaded successfully.'
        );
      };
      script.onerror = () => {
        root.dataset.loaded = 'false';
        console.error(
          '[Alphex Minibot] Failed to load chatbot.js'
        );
      };
      document.body.appendChild(script);
    } catch (error) {
      root.dataset.loaded = 'false';
      console.error(
        '[Alphex Minibot] Failed to initialize:',
        error
      );
    }
  }
  /* =========================================================
     STARTUP
     ========================================================= */
  async function start() {
    /*
     * Load Supabase first.
     */
    try {
      await loadSupabase();
    } catch (error) {
      console.error(
        'Alphex AI: unable to load Supabase',
        error
      );
    }
    /*
     * Load shared navigation and footer.
     */
    await loadSharedComponents();
    /*
     * The navbar now exists in the DOM.
     * Authentication starts after this point.
     */
    initializeAuthentication();
    initializeProfileMenu();
    initializeTheme();
    initializeMobileNavigation();
    initializeAnchorNavigation();
    initializeReactiveVisuals();
    /*
     * Load Alphex Minibot on every page
     * that includes this shared site.js file.
     */
    await loadAlphexChatbot();
  }
  /*
   * Wait for the DOM before starting.
   */
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      start,
      { once: true }
    );
  } else {
    start();
  }
})();
