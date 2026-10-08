/* =========================================================
   ALPHEX AI — SHARED SITE JAVASCRIPT
   ========================================================= */
(() => {
  'use strict';
  /* -------------------------------------------------------
     SUPABASE CONFIGURATION
     ------------------------------------------------------- */
  const SUPABASE_URL =
    'https://nxqxhakjbtdzreimpkdz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_kzCF-pWoVk27YRqvWPIUzg_36ynJbGR';
  let supabaseClient = null;
  /* -------------------------------------------------------
     LOAD SUPABASE
     ------------------------------------------------------- */
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (
        window.supabase &&
        typeof window.supabase.createClient === 'function'
      ) {
        resolve();
        return;
      }
      const existingScript =
        document.querySelector(
          'script[src*="supabase-js"]'
        );
      if (existingScript) {
        existingScript.addEventListener(
          'load',
          resolve,
          { once: true }
        );
        existingScript.addEventListener(
          'error',
          reject,
          { once: true }
        );
        return;
      }
      const script =
        document.createElement('script');
      script.src =
        'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        reject(
          new Error(
            'Unable to load Supabase.'
          )
        );
      };
      document.head.appendChild(script);
    });
  }
  /* -------------------------------------------------------
     INITIALIZE SUPABASE
     ------------------------------------------------------- */
  async function initializeSupabase() {
    try {
      await loadSupabase();
      if (
        !window.supabase ||
        typeof window.supabase.createClient !== 'function'
      ) {
        throw new Error(
          'Supabase library is unavailable.'
        );
      }
      supabaseClient =
        window.supabase.createClient(
          SUPABASE_URL,
          SUPABASE_PUBLISHABLE_KEY
        );
      await initializeAuth();
    } catch (error) {
      console.error(
        'Alphex authentication error:',
        error
      );
    }
  }
  /* -------------------------------------------------------
     LOAD SHARED COMPONENT
     ------------------------------------------------------- */
  async function loadComponent(
    selector,
    file
  ) {
    const container =
      document.querySelector(selector);
    if (!container) {
      return false;
    }
    try {
      const response =
        await fetch(file, {
          cache: 'no-cache'
        });
      if (!response.ok) {
        throw new Error(
          `Unable to load ${file}`
        );
      }
      container.innerHTML =
        await response.text();
      return true;
    } catch (error) {
      console.error(
        'Alphex component error:',
        error
      );
      return false;
    }
  }
  /* -------------------------------------------------------
     INITIALIZE SITE
     ------------------------------------------------------- */
  async function initializeSite() {
    /*
     Load shared components first.
     This is important because authentication,
     navigation and theme code depend on elements
     inside nav.html.
    */
    await Promise.all([
      loadComponent(
        '#site-nav',
        'nav.html'
      ),
      loadComponent(
        '#site-footer',
        'footer.html'
      )
    ]);
    /* Initialize shared functionality */
    initializeNavigation();
    initializeTheme();
    initializeSupabase();
  }
  /* -------------------------------------------------------
     NAVIGATION
     ------------------------------------------------------- */
  function initializeNavigation() {
    const menuButton =
      document.querySelector(
        '.mobile-menu'
      );
    const mobilePanel =
      document.querySelector(
        '.mobile-panel'
      );
    if (!menuButton || !mobilePanel) {
      return;
    }
    /* ---------------------------------------------------
       CLOSE MOBILE MENU
       --------------------------------------------------- */
    const closeMenu = () => {
      menuButton.classList.remove(
        'open'
      );
      menuButton.setAttribute(
        'aria-expanded',
        'false'
      );
      mobilePanel.classList.remove(
        'open'
      );
      mobilePanel.setAttribute(
        'aria-hidden',
        'true'
      );
    };
    /* ---------------------------------------------------
       TOGGLE MOBILE MENU
       --------------------------------------------------- */
    menuButton.addEventListener(
      'click',
      event => {
        event.preventDefault();
        const open =
          !mobilePanel.classList.contains(
            'open'
          );
        menuButton.classList.toggle(
          'open',
          open
        );
        menuButton.setAttribute(
          'aria-expanded',
          String(open)
        );
        mobilePanel.classList.toggle(
          'open',
          open
        );
        mobilePanel.setAttribute(
          'aria-hidden',
          String(!open)
        );
      }
    );
    /* ---------------------------------------------------
       CLOSE MENU AFTER LINK CLICK
       --------------------------------------------------- */
    mobilePanel
      .querySelectorAll('a')
      .forEach(link => {
        link.addEventListener(
          'click',
          closeMenu
        );
      });
    /* ---------------------------------------------------
       CLOSE MENU WITH ESCAPE
       --------------------------------------------------- */
    document.addEventListener(
      'keydown',
      event => {
        if (
          event.key === 'Escape' &&
          mobilePanel.classList.contains('open')
        ) {
          closeMenu();
        }
      }
    );
    /* ---------------------------------------------------
       CLOSE MENU WHEN CLICKING OUTSIDE
       --------------------------------------------------- */
    document.addEventListener(
      'click',
      event => {
        if (
          !mobilePanel.classList.contains('open')
        ) {
          return;
        }
        if (
          mobilePanel.contains(event.target) ||
          menuButton.contains(event.target)
        ) {
          return;
        }
        closeMenu();
      }
    );
    /*
     Expose close function so other shared
     navigation functionality can use it.
    */
    window.alphexCloseMobileMenu =
      closeMenu;
  }
  /* -------------------------------------------------------
     DARK / LIGHT MODE
     ------------------------------------------------------- */
  function initializeTheme() {
    const themeToggle =
      document.querySelector(
        '.theme-toggle'
      );
    if (!themeToggle) {
      return;
    }
    const body =
      document.body;
    const root =
      document.documentElement;
    /* ---------------------------------------------------
       GET SAVED THEME
       --------------------------------------------------- */
    const getSavedTheme = () => {
      try {
        return localStorage.getItem(
          'alphex-theme'
        );
      } catch (error) {
        return null;
      }
    };
    /* ---------------------------------------------------
       SAVE THEME
       --------------------------------------------------- */
    const saveTheme = theme => {
      try {
        localStorage.setItem(
          'alphex-theme',
          theme
        );
      } catch (error) {
        /* Storage may be unavailable. */
      }
    };
    /* ---------------------------------------------------
       APPLY THEME
       --------------------------------------------------- */
    const setTheme = theme => {
      const dark =
        theme === 'dark';
      body.classList.toggle(
        'dark-theme',
        dark
      );
      root.classList.toggle(
        'dark-theme',
        dark
      );
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
      const icon =
        themeToggle.querySelector(
          '.theme-icon'
        );
      const label =
        themeToggle.querySelector(
          '.theme-label'
        );
      if (icon) {
        icon.textContent =
          dark
            ? '☀'
            : '☾';
      }
      if (label) {
        label.textContent =
          dark
            ? 'Light'
            : 'Dark';
      }
      saveTheme(
        dark
          ? 'dark'
          : 'light'
      );
    };
    /* ---------------------------------------------------
       INITIAL THEME
       --------------------------------------------------- */
    const savedTheme =
      getSavedTheme();
    setTheme(
      savedTheme || 'light'
    );
    /* ---------------------------------------------------
       TOGGLE THEME
       --------------------------------------------------- */
    themeToggle.addEventListener(
      'click',
      () => {
        setTheme(
          body.classList.contains(
            'dark-theme'
          )
            ? 'light'
            : 'dark'
        );
      }
    );
  }
  /* -------------------------------------------------------
     AUTHENTICATION
     ------------------------------------------------------- */
  async function initializeAuth() {
    if (!supabaseClient) {
      return;
    }
    try {
      const {
        data,
        error
      } =
        await supabaseClient.auth.getSession();
      if (error) {
        throw error;
      }
      updateAuthUI(
        data.session
      );
    } catch (error) {
      console.error(
        'Unable to get Alphex session:',
        error
      );
    }
    /*
     Listen for:
     SIGNED_IN
     SIGNED_OUT
     TOKEN_REFRESHED
     USER_UPDATED
    */
    supabaseClient.auth.onAuthStateChange(
      (_event, session) => {
        updateAuthUI(
          session
        );
      }
    );
  }
  /* -------------------------------------------------------
     UPDATE AUTHENTICATION UI
     ------------------------------------------------------- */
  function updateAuthUI(session) {
    const signInButton =
      document.querySelector(
        '.header-demo'
      );
    /*
     The navbar may not contain the auth button
     on a special page. In that case, simply stop.
    */
    if (!signInButton) {
      return;
    }
    if (session) {
      showAuthenticatedNavigation(
        session
      );
    } else {
      showLoggedOutNavigation();
    }
  }
  /* -------------------------------------------------------
     LOGGED OUT NAVIGATION
     ------------------------------------------------------- */
  function showLoggedOutNavigation() {
    removeAccountMenu();
    const button =
      document.querySelector(
        '.header-demo'
      );
    if (!button) {
      return;
    }
    button.className =
      'pill dark header-demo';
    button.href =
      'login.html';
    button.removeAttribute(
      'role'
    );
    button.removeAttribute(
      'aria-haspopup'
    );
    button.removeAttribute(
      'aria-expanded'
    );
    button.removeAttribute(
      'aria-label'
    );
    button.innerHTML =
      'Sign in <span>↗</span>';
    /*
     Mobile authentication state.
    */
    const mobileLoginLink =
      document.querySelector(
        '#mobileLoginLink'
      );
    const mobileProfileLink =
      document.querySelector(
        '#mobileProfileLink'
      );
    if (mobileLoginLink) {
      mobileLoginLink.style.display =
        '';
    }
    if (mobileProfileLink) {
      mobileProfileLink.style.display =
        'none';
    }
  }
  /* -------------------------------------------------------
     LOGGED IN NAVIGATION
     ------------------------------------------------------- */
  function showAuthenticatedNavigation(
    session
  ) {
    const button =
      document.querySelector(
        '.header-demo'
      );
    if (!button) {
      return;
    }
    const user =
      session.user;
    const metadata =
      user?.user_metadata || {};
    const email =
      user?.email || '';
    const fullName =
      metadata.full_name ||
      metadata.name ||
      email.split('@')[0] ||
      'Account';
    const initial =
      fullName
        .trim()
        .charAt(0)
        .toUpperCase() ||
      'A';
    /*
     Convert the Sign in button into
     the circular profile button.
    */
    button.className =
      'profile-button header-demo';
    button.href =
      '#';
    button.setAttribute(
      'role',
      'button'
    );
    button.setAttribute(
      'aria-haspopup',
      'true'
    );
    button.setAttribute(
      'aria-expanded',
      'false'
    );
    button.setAttribute(
      'aria-label',
      `Open account menu for ${fullName}`
    );
    button.innerHTML =
      `
        <span class="profile-initial">
          ${escapeHtml(initial)}
        </span>
      `;
    injectProfileStyles();
    createAccountMenu(
      button,
      fullName,
      email
    );
    /*
     Mobile authentication state.
    */
    const mobileLoginLink =
      document.querySelector(
        '#mobileLoginLink'
      );
    const mobileProfileLink =
      document.querySelector(
        '#mobileProfileLink'
      );
    if (mobileLoginLink) {
      mobileLoginLink.style.display =
        'none';
    }
    if (mobileProfileLink) {
      mobileProfileLink.style.display =
        '';
      mobileProfileLink.textContent =
        'Workspace →';
    }
  }
  /* -------------------------------------------------------
     CREATE ACCOUNT MENU
     ------------------------------------------------------- */
  function createAccountMenu(
    profileButton,
    fullName,
    email
  ) {
    removeAccountMenu();
    const wrapper =
      document.createElement(
        'div'
      );
    wrapper.className =
      'account-menu-wrapper';
    /*
     Insert wrapper exactly where the
     original Sign in button existed.
    */
    profileButton.parentNode.insertBefore(
      wrapper,
      profileButton
    );
    wrapper.appendChild(
      profileButton
    );
    const menu =
      document.createElement(
        'div'
      );
    menu.className =
      'account-menu';
    menu.setAttribute(
      'role',
      'menu'
    );
    menu.setAttribute(
      'aria-hidden',
      'true'
    );
    menu.innerHTML =
      `
        <div class="account-menu-user">
          <div class="account-menu-avatar">
            ${escapeHtml(
              fullName
                .trim()
                .charAt(0)
                .toUpperCase()
            )}
          </div>
          <div class="account-menu-details">
            <strong>
              ${escapeHtml(fullName)}
            </strong>
            <span>
              ${escapeHtml(email)}
            </span>
          </div>
        </div>
        <div class="account-menu-divider"></div>
        <a
          href="workspace.html"
          class="account-menu-item"
          role="menuitem"
        >
          <span>Workspace</span>
          <span>→</span>
        </a>
        <div class="account-menu-divider"></div>
        <button
          type="button"
          class="account-menu-signout"
        >
          Sign out
        </button>
      `;
    wrapper.appendChild(
      menu
    );
    /* ---------------------------------------------------
       PROFILE BUTTON
       --------------------------------------------------- */
    profileButton.addEventListener(
      'click',
      event => {
        event.preventDefault();
        const isOpen =
          wrapper.classList.contains(
            'open'
          );
        closeAllAccountMenus();
        if (!isOpen) {
          wrapper.classList.add(
            'open'
          );
          profileButton.setAttribute(
            'aria-expanded',
            'true'
          );
          menu.setAttribute(
            'aria-hidden',
            'false'
          );
        }
      }
    );
    /* ---------------------------------------------------
       WORKSPACE LINK
       --------------------------------------------------- */
    const workspaceLink =
      menu.querySelector(
        'a[href="workspace.html"]'
      );
    if (workspaceLink) {
      workspaceLink.addEventListener(
        'click',
        () => {
          closeAllAccountMenus();
          if (
            typeof window.alphexCloseMobileMenu ===
            'function'
          ) {
            window.alphexCloseMobileMenu();
          }
        }
      );
    }
    /* ---------------------------------------------------
       SIGN OUT
       --------------------------------------------------- */
    const signOutButton =
      menu.querySelector(
        '.account-menu-signout'
      );
    if (signOutButton) {
      signOutButton.addEventListener(
        'click',
        handleSignOut
      );
    }
    /*
     Mobile Workspace link from nav.html.
    */
    const mobileProfileLink =
      document.querySelector(
        '#mobileProfileLink'
      );
    if (mobileProfileLink) {
      mobileProfileLink.onclick =
        event => {
          event.preventDefault();
          if (
            typeof window.alphexCloseMobileMenu ===
            'function'
          ) {
            window.alphexCloseMobileMenu();
          }
          window.location.href =
            'workspace.html';
        };
    }
  }
  /* -------------------------------------------------------
     OUTSIDE ACCOUNT MENU CLICK
     ------------------------------------------------------- */
  function handleOutsideAccountClick(
    event
  ) {
    const wrapper =
      document.querySelector(
        '.account-menu-wrapper'
      );
    if (!wrapper) {
      return;
    }
    if (
      !wrapper.contains(
        event.target
      )
    ) {
      closeAllAccountMenus();
    }
  }
  /* -------------------------------------------------------
     CLOSE ACCOUNT MENU
     ------------------------------------------------------- */
  function closeAllAccountMenus() {
    document
      .querySelectorAll(
        '.account-menu-wrapper'
      )
      .forEach(wrapper => {
        wrapper.classList.remove(
          'open'
        );
        const button =
          wrapper.querySelector(
            '.profile-button'
          );
        const menu =
          wrapper.querySelector(
            '.account-menu'
          );
        if (button) {
          button.setAttribute(
            'aria-expanded',
            'false'
          );
        }
        if (menu) {
          menu.setAttribute(
            'aria-hidden',
            'true'
          );
        }
      });
  }
  /* -------------------------------------------------------
     REMOVE ACCOUNT MENU
     ------------------------------------------------------- */
  function removeAccountMenu() {
    document
      .querySelectorAll(
        '.account-menu-wrapper'
      )
      .forEach(wrapper => {
        const button =
          wrapper.querySelector(
            '.profile-button'
          );
        /*
         Restore the profile button to
         .nav-actions before removing wrapper.
        */
        if (button) {
          const navActions =
            document.querySelector(
              '.nav-actions'
            );
          if (navActions) {
            navActions.insertBefore(
              button,
              wrapper
            );
          }
        }
        wrapper.remove();
      });
  }
  /* -------------------------------------------------------
     SIGN OUT
     ------------------------------------------------------- */
  async function handleSignOut() {
    if (!supabaseClient) {
      return;
    }
    try {
      const signOutButton =
        document.querySelector(
          '.account-menu-signout'
        );
      if (signOutButton) {
        signOutButton.disabled =
          true;
        signOutButton.textContent =
          'Signing out…';
      }
      const {
        error
      } =
        await supabaseClient.auth.signOut();
      if (error) {
        throw error;
      }
      window.location.href =
        'index.html';
    } catch (error) {
      console.error(
        'Alphex sign out error:',
        error
      );
      const signOutButton =
        document.querySelector(
          '.account-menu-signout'
        );
      if (signOutButton) {
        signOutButton.disabled =
          false;
        signOutButton.textContent =
          'Sign out';
      }
      alert(
        'Unable to sign out. Please try again.'
      );
    }
  }
  /* -------------------------------------------------------
     ESCAPE HTML
     ------------------------------------------------------- */
  function escapeHtml(value) {
    return String(value)
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&#039;'
      );
  }
  /* -------------------------------------------------------
     PROFILE / ACCOUNT MENU STYLES
     ------------------------------------------------------- */
  function injectProfileStyles() {
    if (
      document.getElementById(
        'alphex-profile-styles'
      )
    ) {
      return;
    }
    const style =
      document.createElement(
        'style'
      );
    style.id =
      'alphex-profile-styles';
    style.textContent =
      `
      /* ================================================
         PROFILE BUTTON
         ================================================ */
      .profile-button {
        width: 40px;
        height: 40px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 1px solid var(--accent);
        border-radius: 50%;
        background:
          linear-gradient(
            135deg,
            var(--accent-dark),
            var(--accent)
          );
        color: #fff;
        text-decoration: none;
        cursor: pointer;
        transition:
          transform .2s ease,
          box-shadow .2s ease;
      }
      .profile-button:hover {
        transform:
          translateY(-2px);
        box-shadow:
          0 8px 22px
          rgba(112,87,255,.24);
      }
      .profile-initial {
        font-family:
          var(--sans);
        font-size: 14px;
        font-weight: 500;
        line-height: 1;
        color: #fff;
      }
      /* ================================================
         ACCOUNT MENU WRAPPER
         ================================================ */
      .account-menu-wrapper {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      /* ================================================
         ACCOUNT MENU
         ================================================ */
      .account-menu {
        position: absolute;
        top:
          calc(100% + 12px);
        right: 0;
        width: 270px;
        padding: 10px;
        background:
          var(--white);
        border:
          1px solid var(--border);
        border-radius: 18px;
        box-shadow:
          0 18px 50px
          rgba(16,16,16,.13);
        opacity: 0;
        visibility: hidden;
        transform:
          translateY(-6px)
          scale(.98);
        transform-origin:
          top right;
        transition:
          opacity .18s ease,
          visibility .18s ease,
          transform .18s ease;
        z-index: 2000;
      }
      .account-menu-wrapper.open
      .account-menu {
        opacity: 1;
        visibility: visible;
        transform:
          translateY(0)
          scale(1);
      }
      /* ================================================
         USER INFORMATION
         ================================================ */
      .account-menu-user {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 10px;
      }
      .account-menu-avatar {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        background:
          var(--lavender);
        color:
          var(--accent-dark);
        font-size: 13px;
        font-weight: 500;
      }
      .account-menu-details {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .account-menu-details strong {
        overflow: hidden;
        color:
          var(--ink);
        font-size: 13px;
        font-weight: 500;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .account-menu-details span {
        overflow: hidden;
        color:
          var(--muted);
        font-size: 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* ================================================
         DIVIDER
         ================================================ */
      .account-menu-divider {
        height: 1px;
        margin: 5px 0;
        background:
          var(--border);
      }
      /* ================================================
         ACCOUNT MENU ITEM
         ================================================ */
      .account-menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        padding: 11px 10px;
        border-radius: 10px;
        color:
          var(--ink);
        text-decoration: none;
        font-size: 12px;
        font-weight: 500;
        transition:
          background .18s ease,
          color .18s ease;
      }
      .account-menu-item:hover {
        background:
          var(--lavender);
        color:
          var(--accent-dark);
      }
      /* ================================================
         SIGN OUT
         ================================================ */
      .account-menu-signout {
        display: flex;
        align-items: center;
        width: 100%;
        padding: 11px 10px;
        border: 0;
        border-radius: 10px;
        background:
          transparent;
        color:
          var(--ink);
        font-family:
          var(--sans);
        font-size: 12px;
        font-weight: 500;
        text-align: left;
        cursor: pointer;
        transition:
          background .18s ease,
          color .18s ease;
      }
      .account-menu-signout:hover {
        background:
          #fff0f0;
        color:
          #b42318;
      }
      .account-menu-signout:disabled {
        opacity: .55;
        cursor: wait;
      }
      /* ================================================
         DARK MODE
         ================================================ */
      body.dark-theme
      .account-menu {
        background:
          #171817;
        border-color:
          #343634;
        box-shadow:
          0 18px 50px
          rgba(0,0,0,.35);
      }
      body.dark-theme
      .account-menu-details strong {
        color:
          #f4f4f1;
      }
      body.dark-theme
      .account-menu-details span {
        color:
          #999b96;
      }
      body.dark-theme
      .account-menu-divider {
        background:
          #343634;
      }
      body.dark-theme
      .account-menu-item {
        color:
          #f4f4f1;
      }
      body.dark-theme
      .account-menu-item:hover {
        background:
          #242044;
        color:
          #c8c0ff;
      }
      body.dark-theme
      .account-menu-avatar {
        background:
          #242044;
        color:
          #c8c0ff;
      }
      body.dark-theme
      .account-menu-signout {
        color:
          #f4f4f1;
      }
      body.dark-theme
      .account-menu-signout:hover {
        background:
          #321f24;
        color:
          #ffb4b4;
      }
      /* ================================================
         MOBILE
         ================================================ */
      @media(max-width:800px) {
        .account-menu {
          position: fixed;
          top: 80px;
          right: 14px;
          width:
            min(
              270px,
              calc(100vw - 28px)
            );
        }
      }
      @media(max-width:480px) {
        .account-menu {
          top: 74px;
          right: 14px;
          width:
            calc(100vw - 28px);
        }
      }
    `;
    document.head.appendChild(
      style
    );
  }
  /* -------------------------------------------------------
     START ALPHEX AI
     ------------------------------------------------------- */
  if (
    document.readyState === 'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      initializeSite,
      { once: true }
    );
  } else {
    initializeSite();
  }
})();

What this version fixes

* nav.html loads before authentication logic runs.
* Supabase can load from the page or automatically from the CDN.
* Logged out → Sign in ↗
* Logged in → circular profile initial
* Profile click → Account menu
* Account menu → Workspace + Sign out
* Sign out → returns to index.html
* Mobile menu works independently.
* Mobile authenticated state → Workspace
* Theme toggle still works with localStorage.
* Escape closes the mobile menu.
* Clicking outside closes the mobile menu.
* Clicking outside closes the account menu.
* No landing-page content is changed.
* No inline landing-page sections are touched.

Important: your pages should have these containers:

<div id="site-nav"></div>
<!-- your existing page content -->
<div id="site-footer"></div>

And site.js should be loaded after the Supabase CDN if you already include it:

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="site.js"></script>

The code also works if you remove that Supabase CDN line because site.js can load it itself.
