/* =========================================================
   ALPHEX AI — SHARED SITE JAVASCRIPT
   ========================================================= */

(() => {
  'use strict';

  /* =======================================================
     CONFIGURATION
     ======================================================= */

  const SUPABASE_URL =
    'https://nxqxhakjbtdzreimpkdz.supabase.co';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_kzCF-pWoVk27YRqvWPIUzg_36ynJbGR';


  /* =======================================================
     SUPABASE CLIENT
     ======================================================= */

  let supabaseClient = null;

  function getSupabaseClient() {

    if (!window.supabase) {
      console.error(
        'Alphex AI: Supabase library was not loaded.'
      );
      return null;
    }

    /*
     * Reuse an existing shared client if one exists.
     * This prevents different pages/scripts from
     * accidentally creating competing clients.
     */

    if (window.alphexSupabase) {
      return window.alphexSupabase;
    }

    window.alphexSupabase =
      window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );

    return window.alphexSupabase;
  }


  /* =======================================================
     LOAD SHARED COMPONENT
     ======================================================= */

  async function loadComponent(selector, file) {

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
          `Failed to load ${file}: ${response.status}`
        );
      }

      container.innerHTML =
        await response.text();

      return true;

    } catch (error) {

      console.error(
        `Alphex AI component loading error (${file}):`,
        error
      );

      return false;
    }
  }


  /* =======================================================
     LOAD NAV + FOOTER
     ======================================================= */

  async function loadSharedComponents() {

    await Promise.all([
      loadComponent('#site-nav', 'nav.html'),
      loadComponent('#site-footer', 'footer.html')
    ]);

    initializeSite();
  }


  /* =======================================================
     INITIALIZE EVERYTHING
     ======================================================= */

  function initializeSite() {

    initializeNavigation();

    initializeTheme();

    initializeAuthentication();

    initializeAnchorScrolling();

    initializeReactiveAnimations();
  }


  /* =======================================================
     NAVIGATION
     ======================================================= */

  function initializeNavigation() {

    const menuButton =
      document.querySelector('.mobile-menu');

    const mobilePanel =
      document.querySelector('.mobile-panel');

    if (!menuButton || !mobilePanel) {
      return;
    }


    function closeMenu() {

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
    }


    function openMenu() {

      menuButton.classList.add('open');

      menuButton.setAttribute(
        'aria-expanded',
        'true'
      );

      mobilePanel.classList.add('open');

      mobilePanel.setAttribute(
        'aria-hidden',
        'false'
      );
    }


    menuButton.addEventListener(
      'click',
      () => {

        const isOpen =
          mobilePanel.classList.contains('open');

        if (isOpen) {
          closeMenu();
        } else {
          openMenu();
        }
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


    window.alphexCloseMobileMenu =
      closeMenu;
  }


  /* =======================================================
     THEME
     ======================================================= */

  function initializeTheme() {

    const root =
      document.documentElement;

    const body =
      document.body;

    const themeToggle =
      document.querySelector('.theme-toggle');

    if (!themeToggle) {
      return;
    }


    function getSavedTheme() {

      try {

        return window.localStorage.getItem(
          'alphex-theme'
        );

      } catch (error) {

        return null;

      }
    }


    function saveTheme(theme) {

      try {

        window.localStorage.setItem(
          'alphex-theme',
          theme
        );

      } catch (error) {

        /* Theme still works for this visit. */

      }
    }


    function setTheme(theme) {

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
    }


    setTheme(
      getSavedTheme() || 'light'
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


  /* =======================================================
     AUTHENTICATION
     ======================================================= */

  function initializeAuthentication() {

    supabaseClient =
      getSupabaseClient();

    if (!supabaseClient) {
      return;
    }


    /* =====================================================
       NAV ELEMENTS
       ===================================================== */

    const loginNavButton =
      document.getElementById(
        'loginNavButton'
      );

    const authProfile =
      document.getElementById(
        'authProfile'
      );

    const profileButton =
      document.getElementById(
        'profileButton'
      );

    const profileMenu =
      document.getElementById(
        'profileMenu'
      );

    const profileInitial =
      document.getElementById(
        'profileInitial'
      );

    const profileName =
      document.getElementById(
        'profileName'
      );

    const profileEmail =
      document.getElementById(
        'profileEmail'
      );

    const profileSignout =
      document.getElementById(
        'profileSignout'
      );

    const mobileLoginLink =
      document.getElementById(
        'mobileLoginLink'
      );

    const mobileProfileLink =
      document.getElementById(
        'mobileProfileLink'
      );


    /* =====================================================
       USER DISPLAY NAME
       ===================================================== */

    function getUserDisplayName(user) {

      if (!user) {
        return 'Alphex AI';
      }


      const metadata =
        user.user_metadata || {};


      const fullName =
        metadata.full_name ||
        metadata.name ||
        '';


      if (fullName.trim()) {
        return fullName.trim();
      }


      if (user.email) {
        return user.email.split('@')[0];
      }


      return 'Alphex AI';
    }


    /* =====================================================
       PROFILE INITIAL
       ===================================================== */

    function getProfileInitial(name) {

      if (!name) {
        return 'A';
      }


      return (
        name
          .trim()
          .charAt(0)
          .toUpperCase() || 'A'
      );
    }


    /* =====================================================
       LOGGED OUT
       ===================================================== */

    function showLoggedOutNavigation() {

      document.body.classList.remove(
        'authenticated'
      );


      if (loginNavButton) {
        loginNavButton.style.display =
          'inline-flex';
      }


      if (authProfile) {
        authProfile.style.display =
          'none';
      }


      if (mobileLoginLink) {
        mobileLoginLink.style.display =
          'flex';
      }


      if (mobileProfileLink) {
        mobileProfileLink.style.display =
          'none';
      }


      if (profileMenu) {
        profileMenu.classList.remove(
          'open'
        );
      }


      if (profileButton) {
        profileButton.setAttribute(
          'aria-expanded',
          'false'
        );
      }
    }


    /* =====================================================
       LOGGED IN
       ===================================================== */

    function showLoggedInNavigation(user) {

      document.body.classList.add(
        'authenticated'
      );


      const name =
        getUserDisplayName(user);


      const initial =
        getProfileInitial(name);


      if (loginNavButton) {
        loginNavButton.style.display =
          'none';
      }


      if (authProfile) {
        authProfile.style.display =
          'inline-flex';
      }


      if (profileInitial) {
        profileInitial.textContent =
          initial;
      }


      if (profileName) {
        profileName.textContent =
          name;
      }


      if (profileEmail) {
        profileEmail.textContent =
          user.email || 'Signed in';
      }


      if (mobileLoginLink) {
        mobileLoginLink.style.display =
          'none';
      }


      if (mobileProfileLink) {
        mobileProfileLink.style.display =
          'flex';
      }
    }


    /* =====================================================
       CURRENT SESSION
     ===================================================== */

    async function updateAuthenticationUI() {

      try {

        const {
          data,
          error
        } =
          await supabaseClient.auth.getSession();


        if (error) {

          console.error(
            'Alphex AI auth session error:',
            error
          );

          showLoggedOutNavigation();

          return;
        }


        const session =
          data?.session || null;


        if (
          session?.user
        ) {

          showLoggedInNavigation(
            session.user
          );

        } else {

          showLoggedOutNavigation();

        }

      } catch (error) {

        console.error(
          'Alphex AI authentication error:',
          error
        );

        showLoggedOutNavigation();

      }
    }


    /* =====================================================
       AUTH STATE LISTENER
       ===================================================== */

    supabaseClient.auth.onAuthStateChange(
      (event, session) => {

        console.log(
          'Alphex AI auth event:',
          event
        );


        if (
          session?.user
        ) {

          showLoggedInNavigation(
            session.user
          );

        } else {

          showLoggedOutNavigation();

        }
      }
    );


    /* =====================================================
       PROFILE MENU
       ===================================================== */

    if (
      profileButton &&
      profileMenu
    ) {

      profileButton.addEventListener(
        'click',
        event => {

          event.stopPropagation();


          const isOpen =
            profileMenu.classList.contains(
              'open'
            );


          profileMenu.classList.toggle(
            'open',
            !isOpen
          );


          profileButton.setAttribute(
            'aria-expanded',
            String(!isOpen)
          );
        }
      );
    }


    /* =====================================================
       CLOSE PROFILE MENU
       ===================================================== */

    document.addEventListener(
      'click',
      event => {

        if (
          authProfile &&
          profileMenu &&
          !authProfile.contains(
            event.target
          )
        ) {

          profileMenu.classList.remove(
            'open'
          );


          if (profileButton) {

            profileButton.setAttribute(
              'aria-expanded',
              'false'
            );
          }
        }
      }
    );


    /* =====================================================
       SIGN OUT
       ===================================================== */

    if (profileSignout) {

      profileSignout.addEventListener(
        'click',
        async () => {

          profileSignout.disabled =
            true;

          profileSignout.textContent =
            'Signing out...';


          try {

            const {
              error
            } =
              await supabaseClient.auth.signOut();


            if (error) {

              console.error(
                'Alphex AI sign out error:',
                error
              );


              profileSignout.disabled =
                false;

              profileSignout.textContent =
                'Sign out';

              return;
            }


            if (profileMenu) {

              profileMenu.classList.remove(
                'open'
              );
            }


            showLoggedOutNavigation();


            window.location.replace(
              'index.html'
            );

          } catch (error) {

            console.error(
              'Alphex AI sign out error:',
              error
            );


            profileSignout.disabled =
              false;

            profileSignout.textContent =
              'Sign out';
          }
        }
      );
    }


    /* =====================================================
       MOBILE PROFILE
       ===================================================== */

    if (mobileProfileLink) {

      mobileProfileLink.addEventListener(
        'click',
        event => {

          event.preventDefault();


          if (
            profileMenu &&
            profileButton
          ) {

            profileMenu.classList.toggle(
              'open'
            );


            const isOpen =
              profileMenu.classList.contains(
                'open'
              );


            profileButton.setAttribute(
              'aria-expanded',
              String(isOpen)
            );
          }


          if (
            typeof window.alphexCloseMobileMenu ===
            'function'
          ) {

            window.alphexCloseMobileMenu();

          }
        }
      );
    }


    /* =====================================================
       INITIAL SESSION CHECK
     ===================================================== */

    updateAuthenticationUI();
  }


  /* =======================================================
     SMOOTH ANCHOR SCROLLING
     ======================================================= */

  function initializeAnchorScrolling() {

    document
      .querySelectorAll(
        'a[href^="#"]'
      )
      .forEach(anchor => {

        anchor.addEventListener(
          'click',
          event => {

            const target =
              anchor.getAttribute(
                'href'
              );


            if (
              !target ||
              target === '#'
            ) {
              return;
            }


            const element =
              document.querySelector(
                target
              );


            if (element) {

              event.preventDefault();


              element.scrollIntoView({
                behavior: 'smooth'
              });


              if (
                typeof window.alphexCloseMobileMenu ===
                'function'
              ) {

                window.alphexCloseMobileMenu();

              }
            }
          }
        );
      });
  }


  /* =======================================================
     HERO / VISUAL POINTER ANIMATION
     ======================================================= */

  function initializeReactiveAnimations() {

    const reactive =
      document.querySelectorAll(
        '.hero-stage,.feature-visual'
      );


    reactive.forEach(panel => {

      panel.addEventListener(
        'pointermove',
        event => {

          const rect =
            panel.getBoundingClientRect();


          const x =
            (event.clientX - rect.left) /
              rect.width -
            0.5;


          const y =
            (event.clientY - rect.top) /
              rect.height -
            0.5;


          panel.style.setProperty(
            '--mx',
            x.toFixed(3)
          );


          panel.style.setProperty(
            '--my',
            y.toFixed(3)
          );
        }
      );


      panel.addEventListener(
        'pointerleave',
        () => {

          panel.style.setProperty(
            '--mx',
            '0'
          );


          panel.style.setProperty(
            '--my',
            '0'
          );
        }
      );
    });
  }


  /* =======================================================
     START
     ======================================================= */

  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      loadSharedComponents
    );

  } else {

    loadSharedComponents();

  }

})();
