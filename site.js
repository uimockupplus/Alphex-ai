/* =========================================================
   ALPHEX AI — SHARED SITE JAVASCRIPT
   ========================================================= */
(() => {
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
  const loadComponent = async (
    selector,
    file
  ) => {
    const container =
      document.querySelector(selector);
    if (!container) {
      return;
    }
    try {
      const response =
        await fetch(file);
      if (!response.ok) {
        throw new Error(
          `Unable to load ${file}`
        );
      }
      container.innerHTML =
        await response.text();
    } catch (error) {
      console.error(
        'Alphex component error:',
        error
      );
    }
  };
  /* -------------------------------------------------------
     INITIALIZE SITE
     ------------------------------------------------------- */
  async function initializeSite() {
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
    menuButton.addEventListener(
      'click',
      () => {
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
    mobilePanel
      .querySelectorAll('a')
      .forEach(link => {
        link.addEventListener(
          'click',
          closeMenu
        );
      });
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
    const getSavedTheme = () => {
      try {
        return localStorage.getItem(
          'alphex-theme'
        );
      } catch (error) {
        return null;
      }
    };
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
          dark ? '☀' : '☾';
      }
      if (label) {
        label.textContent =
          dark ? 'Light' : 'Dark';
      }
      saveTheme(
        dark ? 'dark' : 'light'
      );
    };
    const savedTheme =
      getSavedTheme();
    setTheme(
      savedTheme || 'light'
    );
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
    const button =
      document.querySelector(
        '.header-demo'
      );
    if (!button) {
      return;
    }
    removeAccountMenu();
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
    menu.innerHTML = `
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
        href="#"
        class="account-menu-item account-link-disabled"
        role="menuitem"
        aria-disabled="true"
      >
        <span>Account</span>
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
    const accountLink =
      menu.querySelector(
        '.account-link-disabled'
      );
    if (accountLink) {
      accountLink.addEventListener(
        'click',
        event => {
          event.preventDefault();
        }
      );
    }
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
    document.addEventListener(
      'click',
      handleOutsideAccountClick
    );
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
    style.textContent = `
      /* PROFILE BUTTON */
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
      /* ACCOUNT MENU WRAPPER */
      .account-menu-wrapper {
        position: relative;
        display: inline-flex;
      }
      /* ACCOUNT MENU */
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
        z-index: 200;
      }
      .account-menu-wrapper.open
      .account-menu {
        opacity: 1;
        visibility: visible;
        transform:
          translateY(0)
          scale(1);
      }
      /* USER INFORMATION */
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
      /* DIVIDER */
      .account-menu-divider {
        height: 1px;
        margin: 5px 0;
        background:
          var(--border);
      }
      /* ACCOUNT LINK */
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
      }
      .account-link-disabled {
        opacity: .5;
        cursor: default;
      }
      /* SIGN OUT */
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
      /* DARK MODE */
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
      .account-menu-signout:hover {
        background:
          #321f24;
        color:
          #ffb4b4;
      }
      /* MOBILE */
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
  initializeSite();
})();
