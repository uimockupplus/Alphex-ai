/* =========================================================
   ALPHEX AI — SHARED SITE JAVASCRIPT
   ========================================================= */

(() => {

  /* -------------------------------------------------------
     LOAD SHARED COMPONENTS
     ------------------------------------------------------- */

  const loadComponent = async (selector, file) => {

    const container = document.querySelector(selector);

    if (!container) {
      return;
    }

    try {

      const response = await fetch(file);

      if (!response.ok) {
        throw new Error(
          `Unable to load ${file}`
        );
      }

      container.innerHTML = await response.text();

    } catch (error) {

      console.error(
        `Alphex component error:`,
        error
      );

    }

  };


  /* -------------------------------------------------------
     LOAD NAVIGATION + FOOTER
     ------------------------------------------------------- */

  Promise.all([
    loadComponent('#site-nav', 'nav.html'),
    loadComponent('#site-footer', 'footer.html')
  ]).then(() => {

    initializeNavigation();
    initializeTheme();

  });


  /* -------------------------------------------------------
     NAVIGATION
     ------------------------------------------------------- */

  function initializeNavigation() {

    const menuButton =
      document.querySelector('.mobile-menu');

    const mobilePanel =
      document.querySelector('.mobile-panel');


    if (!menuButton || !mobilePanel) {
      return;
    }


    const closeMenu = () => {

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

    });


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
      document.querySelector('.theme-toggle');

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

})();
