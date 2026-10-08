/* =========================================================
   ALPHEX AI — CHATBOT CONTROLLER
   ---------------------------------------------------------
   Frontend responsibilities:
   - Open / close chatbot
   - User interaction
   - Message rendering
   - Suggested prompts
   - Conversation UI
   - Supabase authenticated-user awareness
   - Secure backend communication
   - Backend AI responses through /api/chatbot

   IMPORTANT:
   Never put the Groq API key in this file.
   Never put the Gemini API key in this file.
   Never put the Supabase service-role key in this file.
   ========================================================= */

(() => {
  'use strict';


  /* =========================================================
     CONFIGURATION
     ========================================================= */

  const CONFIG = {
    API_ENDPOINT: '/api/chatbot',

    MAX_INPUT_LENGTH: 4000,

    /*
     Frontend request timeout.

     This prevents the chatbot UI from appearing frozen
     indefinitely if the backend/provider does not respond.
    */
    REQUEST_TIMEOUT: 8500,

    STORAGE_KEYS: {
      conversationId: 'alphex_chat_conversation_id'
    },

    FALLBACK_USER_NAME: 'there'
  };


  /* =========================================================
     DOM REFERENCES
     ========================================================= */

  const chatbot =
    document.getElementById('alphex-chatbot');

  if (!chatbot) {
    console.warn(
      '[Alphex Chatbot] Root element not found.'
    );

    return;
  }


  const toggleButton =
    document.getElementById('alphex-chat-toggle');

  const chatWindow =
    document.getElementById('alphex-chat-window');

  const closeButton =
    document.getElementById('chat-close');

  const newConversationButton =
    document.getElementById('chat-new-conversation');

  const messageList =
    document.getElementById('chat-message-list');

  const chatForm =
    document.getElementById('chat-form');

  const chatInput =
    document.getElementById('chat-input');

  const chatSend =
    document.getElementById('chat-send');

  const thinkingIndicator =
    document.getElementById('chat-thinking');

  const welcomeState =
    document.getElementById('chat-welcome');

  const returningUser =
    document.getElementById('chat-returning-user');

  const userNameElement =
    document.getElementById('chat-user-name');

  const continueConversationButton =
    document.getElementById('chat-continue-conversation');


  /* =========================================================
     STATE
     ========================================================= */

  const state = {
    isOpen: false,
    isSending: false,

    currentUser: null,
    currentProfile: null,

    conversationId: null,

    messages: [],

    hasExistingConversation: false
  };


  /* =========================================================
     SUPABASE
     ---------------------------------------------------------
     This is the browser-safe publishable key.

     NEVER place the Supabase service-role/secret key here.
     ========================================================= */

  const SUPABASE_URL =
    'https://nxqxhakjbtdzreimpkdz.supabase.co';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_kzCF-pWoVk27YRqvWPIUzg_36ynJbGR';

  let supabaseClient = null;


  function initializeSupabase() {

    if (
      typeof window.supabase === 'undefined' ||
      typeof window.supabase.createClient !== 'function'
    ) {

      console.warn(
        '[Alphex Chatbot] Supabase client is not loaded.'
      );

      return null;
    }


    try {

      return window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );

    } catch (error) {

      console.error(
        '[Alphex Chatbot] Supabase initialization failed:',
        error
      );

      return null;
    }
  }


  supabaseClient =
    initializeSupabase();


  /* =========================================================
     INITIALIZATION
     ========================================================= */

  async function initialize() {

    bindEvents();

    loadStoredConversation();

    updateSendButton();

    autoResizeInput();

    await loadAuthenticatedUser();

    renderReturningUserState();

    console.log(
      '[Alphex Chatbot] Initialized.'
    );
  }


  /* =========================================================
     EVENT LISTENERS
     ========================================================= */

  function bindEvents() {


    /* -------------------------------------------------------
       OPEN CHATBOT
       ------------------------------------------------------- */

    if (toggleButton) {

      toggleButton.addEventListener(
        'click',
        () => {
          openChat();
        }
      );
    }


    /* -------------------------------------------------------
       CLOSE CHATBOT
       ------------------------------------------------------- */

    if (closeButton) {

      closeButton.addEventListener(
        'click',
        () => {
          closeChat();
        }
      );
    }


    /* -------------------------------------------------------
       NEW CONVERSATION
       ------------------------------------------------------- */

    if (newConversationButton) {

      newConversationButton.addEventListener(
        'click',
        () => {
          startNewConversation();
        }
      );
    }


    /* -------------------------------------------------------
       CONTINUE PREVIOUS CONVERSATION
       ------------------------------------------------------- */

    if (continueConversationButton) {

      continueConversationButton.addEventListener(
        'click',
        async () => {

          if (state.isSending) {
            return;
          }

          await continuePreviousConversation();
        }
      );
    }


    /* -------------------------------------------------------
       CHAT FORM
       ------------------------------------------------------- */

    if (chatForm) {

      chatForm.addEventListener(
        'submit',
        async (event) => {

          event.preventDefault();

          await handleSendMessage();
        }
      );
    }


    /* -------------------------------------------------------
       TEXTAREA
       ------------------------------------------------------- */

    if (chatInput) {


      chatInput.addEventListener(
        'input',
        () => {

          enforceInputLimit();

          autoResizeInput();

          updateSendButton();
        }
      );


      chatInput.addEventListener(
        'keydown',
        async (event) => {

          /*
           Enter = send
           Shift + Enter = new line
          */

          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.isComposing
          ) {

            event.preventDefault();

            await handleSendMessage();
          }
        }
      );
    }


    /* =======================================================
       SUGGESTED PROMPTS
       -------------------------------------------------------
       IMPORTANT:

       The HTML uses:

       data-prompt="..."

       NOT:

       data-chat-prompt="..."

       Event delegation is used so the buttons continue to
       work even if the welcome UI is injected/re-rendered.
       ======================================================= */

    document.addEventListener(
      'click',
      async (event) => {

        const button =
          event.target.closest(
            '.chat-suggestion'
          );


        if (!button) {
          return;
        }


        const prompt =
          button.getAttribute(
            'data-prompt'
          );


        if (!prompt) {

          console.warn(
            '[Alphex Chatbot] Suggestion button has no data-prompt.'
          );

          return;
        }


        event.preventDefault();


        if (state.isSending) {
          return;
        }


        if (!chatInput) {
          return;
        }


        /*
         Put the selected question into the input
         and send it immediately.
        */

        chatInput.value =
          prompt;


        autoResizeInput();

        updateSendButton();


        await handleSendMessage();
      }
    );


    /* -------------------------------------------------------
       ESCAPE CLOSES CHATBOT
       ------------------------------------------------------- */

    document.addEventListener(
      'keydown',
      (event) => {

        if (
          event.key === 'Escape' &&
          state.isOpen
        ) {

          closeChat();
        }
      }
    );


    /* -------------------------------------------------------
       SUPABASE AUTHENTICATION CHANGES
       ------------------------------------------------------- */

    if (
      supabaseClient &&
      supabaseClient.auth &&
      typeof supabaseClient.auth.onAuthStateChange ===
        'function'
    ) {

      supabaseClient.auth.onAuthStateChange(
        async (_event, session) => {

          state.currentUser =
            session?.user || null;


          if (state.currentUser) {

            await loadUserProfile();

          } else {

            state.currentProfile =
              null;
          }


          renderReturningUserState();
        }
      );
    }
  }


  /* =========================================================
     CHAT WINDOW
     ========================================================= */

  function openChat() {

    if (!chatWindow) {
      return;
    }


    state.isOpen =
      true;


    chatbot.setAttribute(
      'data-chatbot-state',
      'open'
    );


    chatWindow.setAttribute(
      'aria-hidden',
      'false'
    );


    if (toggleButton) {

      toggleButton.setAttribute(
        'aria-expanded',
        'true'
      );
    }


    document.body.classList.add(
      'alphex-chatbot-open'
    );


    setTimeout(() => {

      if (chatInput) {

        chatInput.focus();
      }

    }, 120);
  }


  function closeChat() {

    if (!chatWindow) {
      return;
    }


    state.isOpen =
      false;


    chatbot.setAttribute(
      'data-chatbot-state',
      'closed'
    );


    chatWindow.setAttribute(
      'aria-hidden',
      'true'
    );


    if (toggleButton) {

      toggleButton.setAttribute(
        'aria-expanded',
        'false'
      );
    }


    document.body.classList.remove(
      'alphex-chatbot-open'
    );
  }


  /* =========================================================
     INPUT
     ========================================================= */

  function enforceInputLimit() {

    if (!chatInput) {
      return;
    }


    if (
      chatInput.value.length >
      CONFIG.MAX_INPUT_LENGTH
    ) {

      chatInput.value =
        chatInput.value.substring(
          0,
          CONFIG.MAX_INPUT_LENGTH
        );
    }
  }


  function autoResizeInput() {

    if (!chatInput) {
      return;
    }


    chatInput.style.height =
      'auto';


    const maxHeight =
      180;


    chatInput.style.height =
      Math.min(
        chatInput.scrollHeight,
        maxHeight
      ) + 'px';
  }


  function updateSendButton() {

    if (
      !chatSend ||
      !chatInput
    ) {

      return;
    }


    const hasText =
      chatInput.value.trim().length > 0;


    chatSend.disabled =
      !hasText ||
      state.isSending;
  }


  /* =========================================================
     MESSAGE SENDING
     ========================================================= */

  async function handleSendMessage() {

    if (
      !chatInput ||
      state.isSending
    ) {

      return;
    }


    const message =
      chatInput.value.trim();


    if (!message) {
      return;
    }


    if (
      message.length >
      CONFIG.MAX_INPUT_LENGTH
    ) {

      return;
    }


    state.isSending =
      true;


    updateSendButton();


    /*
     Clear input immediately.
    */

    chatInput.value =
      '';


    autoResizeInput();

    updateSendButton();


    /*
     Hide welcome UI.
    */

    hideWelcomeState();


    /*
     Render user's message immediately.
    */

    addMessage(
      'user',
      message
    );


    /*
     Show thinking indicator.
    */

    showThinking();


    try {

      const response =
        await sendToBackend(
          message
        );


      hideThinking();


      if (
        response &&
        typeof response.message ===
          'string'
      ) {

        addMessage(
          'assistant',
          response.message
        );


        if (
          response.conversation_id
        ) {

          state.conversationId =
            response.conversation_id;


          state.hasExistingConversation =
            true;


          saveStoredConversation();


          renderReturningUserState();
        }

      } else {

        addMessage(
          'assistant',
          getFallbackErrorMessage()
        );
      }

    } catch (error) {

      console.error(
        '[Alphex Chatbot] Message error:',
        error
      );


      hideThinking();


      addMessage(
        'assistant',
        getFallbackErrorMessage()
      );

    } finally {

      state.isSending =
        false;


      updateSendButton();


      if (chatInput) {

        chatInput.focus();
      }
    }
  }


  /* =========================================================
     SECURE BACKEND REQUEST
     ========================================================= */

  async function sendToBackend(
    message
  ) {

    /*
     Get the current Supabase session.

     The access token is used only for authentication.

     The backend is responsible for identifying
     the user and authorizing access.
    */

    const session =
      await getCurrentSession();


    /*
     IMPORTANT:

     Do NOT send user IDs or emails as trusted
     authorization information.

     The backend gets the authenticated user from:

     Authorization: Bearer <access_token>
    */

    const payload = {

      message,

      conversation_id:
        state.conversationId || null,

      page: {

        url:
          window.location.href,

        path:
          window.location.pathname,

        title:
          document.title
      }
    };


    const headers = {

      'Content-Type':
        'application/json'
    };


    if (
      session &&
      session.access_token
    ) {

      headers.Authorization =
        `Bearer ${session.access_token}`;
    }


    /*
     AbortController prevents a request from hanging
     forever in the browser.
    */

    const controller =
      new AbortController();


    const timeoutId =
      setTimeout(
        () => {
          controller.abort();
        },
        CONFIG.REQUEST_TIMEOUT
      );


    try {

      const response =
        await fetch(
          CONFIG.API_ENDPOINT,
          {
            method: 'POST',

            headers,

            body:
              JSON.stringify(payload),

            signal:
              controller.signal
          }
        );


      if (!response.ok) {

        let errorMessage =
          'Chat request failed.';


        try {

          const errorData =
            await response.json();


          if (
            errorData &&
            errorData.error
          ) {

            errorMessage =
              errorData.error;
          }

        } catch {
          /*
           Ignore invalid error response.
          */
        }


        throw new Error(
          errorMessage
        );
      }


      return await response.json();

    } catch (error) {

      if (
        error &&
        error.name ===
          'AbortError'
      ) {

        throw new Error(
          'The request took too long.'
        );
      }


      throw error;

    } finally {

      clearTimeout(
        timeoutId
      );
    }
  }


  /* =========================================================
     MESSAGE RENDERING
     ========================================================= */

  function addMessage(
    role,
    content
  ) {

    if (!messageList) {
      return null;
    }


    const messageElement =
      document.createElement(
        'div'
      );


    messageElement.className =
      `chat-message chat-message-${role}`;


    const bubble =
      document.createElement(
        'div'
      );


    bubble.className =
      'chat-message-bubble';


    if (
      role === 'assistant'
    ) {

      bubble.innerHTML =
        renderMarkdown(
          content
        );

    } else {

      bubble.textContent =
        content;
    }


    messageElement.appendChild(
      bubble
    );


    messageList.appendChild(
      messageElement
    );


    state.messages.push({
      role,
      content
    });


    scrollMessagesToBottom();


    return messageElement;
  }


  /* =========================================================
     MARKDOWN
     ---------------------------------------------------------
     Lightweight renderer.
     ========================================================= */

  function renderMarkdown(
    text
  ) {

    if (!text) {
      return '';
    }


    let safe =
      escapeHTML(
        text
      );


    /*
     Code blocks
    */

    safe =
      safe.replace(
        /```([\s\S]*?)```/g,
        '<pre><code>$1</code></pre>'
      );


    /*
     Inline code
    */

    safe =
      safe.replace(
        /`([^`]+)`/g,
        '<code>$1</code>'
      );


    /*
     Bold
    */

    safe =
      safe.replace(
        /\*\*(.*?)\*\*/g,
        '<strong>$1</strong>'
      );


    /*
     Italic
    */

    safe =
      safe.replace(
        /(^|[^\*])\*([^\*]+)\*/g,
        '$1<em>$2</em>'
      );


    /*
     Links

     Only allow http/https.
    */

    safe =
      safe.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
      );


    /*
     Bullet lists
    */

    safe =
      safe.replace(
        /^\s*[-•]\s+(.+)$/gm,
        '<li>$1</li>'
      );


    /*
     Convert consecutive list items.
    */

    safe =
      safe.replace(
        /(<li>.*<\/li>)/gs,
        '<ul>$1</ul>'
      );


    /*
     Headings
    */

    safe =
      safe.replace(
        /^###\s+(.+)$/gm,
        '<h4>$1</h4>'
      );


    safe =
      safe.replace(
        /^##\s+(.+)$/gm,
        '<h3>$1</h3>'
      );


    safe =
      safe.replace(
        /^#\s+(.+)$/gm,
        '<h3>$1</h3>'
      );


    /*
     Paragraph / line breaks
    */

    safe =
      safe.replace(
        /\n\n/g,
        '</p><p>'
      );


    safe =
      safe.replace(
        /\n/g,
        '<br>'
      );


    return `<p>${safe}</p>`;
  }


  function escapeHTML(
    value
  ) {

    const div =
      document.createElement(
        'div'
      );


    div.textContent =
      value;


    return div.innerHTML;
  }


  /* =========================================================
     THINKING INDICATOR
     ========================================================= */

  function showThinking() {

    if (!thinkingIndicator) {
      return;
    }


    thinkingIndicator.hidden =
      false;


    scrollMessagesToBottom();
  }


  function hideThinking() {

    if (!thinkingIndicator) {
      return;
    }


    thinkingIndicator.hidden =
      true;
  }


  function scrollMessagesToBottom() {

    if (!messageList) {
      return;
    }


    requestAnimationFrame(() => {

      messageList.scrollTop =
        messageList.scrollHeight;
    });
  }


  /* =========================================================
     WELCOME STATE
     ========================================================= */

  function hideWelcomeState() {

    if (!welcomeState) {
      return;
    }


    welcomeState.hidden =
      true;
  }


  function showWelcomeState() {

    if (!welcomeState) {
      return;
    }


    welcomeState.hidden =
      false;
  }


  /* =========================================================
     RETURNING USER
     ========================================================= */

  function renderReturningUserState() {

    if (
      !returningUser ||
      !userNameElement
    ) {

      return;
    }


    if (!state.currentUser) {

      returningUser.hidden =
        true;

      return;
    }


    const name =
      getUserName();


    userNameElement.textContent =
      name;


    returningUser.hidden =
      !state.hasExistingConversation;
  }


  function getUserName() {

    if (
      state.currentProfile &&
      state.currentProfile.full_name
    ) {

      return state.currentProfile.full_name;
    }


    if (
      state.currentUser &&
      state.currentUser.user_metadata
    ) {

      const metadata =
        state.currentUser.user_metadata;


      if (
        metadata.full_name
      ) {

        return metadata.full_name;
      }


      if (
        metadata.name
      ) {

        return metadata.name;
      }
    }


    if (
      state.currentUser &&
      state.currentUser.email
    ) {

      const email =
        state.currentUser.email;


      return email.split('@')[0];
    }


    return CONFIG.FALLBACK_USER_NAME;
  }


  /* =========================================================
     AUTHENTICATION
     ========================================================= */

  async function loadAuthenticatedUser() {

    if (!supabaseClient) {
      return;
    }


    try {

      const session =
        await getCurrentSession();


      state.currentUser =
        session?.user || null;


      if (state.currentUser) {

        await loadUserProfile();
      }

    } catch (error) {

      console.warn(
        '[Alphex Chatbot] Could not load user:',
        error
      );
    }
  }


  async function getCurrentSession() {

    if (
      !supabaseClient ||
      !supabaseClient.auth
    ) {

      return null;
    }


    const {
      data,
      error
    } =
      await supabaseClient.auth.getSession();


    if (error) {
      throw error;
    }


    return data?.session || null;
  }


  async function loadUserProfile() {

    if (
      !supabaseClient ||
      !state.currentUser
    ) {

      return;
    }


    try {

      const {
        data,
        error
      } =
        await supabaseClient
          .from('profiles')
          .select(
            'user_id,full_name,company,role,avatar_url'
          )
          .eq(
            'user_id',
            state.currentUser.id
          )
          .maybeSingle();


      if (error) {
        throw error;
      }


      state.currentProfile =
        data || null;

    } catch (error) {

      console.warn(
        '[Alphex Chatbot] Profile could not be loaded:',
        error
      );


      state.currentProfile =
        null;
    }
  }


  /* =========================================================
     CONVERSATION STORAGE
     ========================================================= */

  function loadStoredConversation() {

    try {

      const storedId =
        localStorage.getItem(
          CONFIG.STORAGE_KEYS.conversationId
        );


      if (storedId) {

        state.conversationId =
          storedId;


        state.hasExistingConversation =
          true;
      }

    } catch (error) {

      console.warn(
        '[Alphex Chatbot] Local storage unavailable:',
        error
      );
    }
  }


  function saveStoredConversation() {

    if (!state.conversationId) {
      return;
    }


    try {

      localStorage.setItem(
        CONFIG.STORAGE_KEYS.conversationId,
        state.conversationId
      );

    } catch (error) {

      console.warn(
        '[Alphex Chatbot] Could not save conversation:',
        error
      );
    }
  }


  /* =========================================================
     CONTINUE PREVIOUS CONVERSATION
     ========================================================= */

  async function continuePreviousConversation() {

    if (!state.conversationId) {
      return;
    }


    hideWelcomeState();


    try {

      const session =
        await getCurrentSession();


      const headers = {
        'Accept':
          'application/json'
      };


      if (
        session &&
        session.access_token
      ) {

        headers.Authorization =
          `Bearer ${session.access_token}`;
      }


      const response =
        await fetch(
          `${CONFIG.API_ENDPOINT}?conversation_id=${encodeURIComponent(
            state.conversationId
          )}`,
          {
            method: 'GET',

            headers
          }
        );


      if (!response.ok) {

        throw new Error(
          'Unable to load previous conversation.'
        );
      }


      const data =
        await response.json();


      if (
        Array.isArray(
          data.messages
        )
      ) {

        clearRenderedMessages();


        state.messages =
          [];


        data.messages.forEach(
          (message) => {

            if (
              message.role === 'user' ||
              message.role === 'assistant'
            ) {

              addMessage(
                message.role,
                message.content
              );
            }
          }
        );
      }

    } catch (error) {

      console.warn(
        '[Alphex Chatbot] Previous conversation could not be loaded:',
        error
      );


      /*
       Do not show a scary error to the visitor.
       The chatbot can simply start fresh.
      */
    }
  }


  /* =========================================================
     NEW CONVERSATION
     ========================================================= */

  function startNewConversation() {

    state.conversationId =
      null;


    state.messages =
      [];


    state.hasExistingConversation =
      false;


    try {

      localStorage.removeItem(
        CONFIG.STORAGE_KEYS.conversationId
      );

    } catch {
      /* Ignore storage errors */
    }


    clearRenderedMessages();


    hideThinking();


    showWelcomeState();


    renderReturningUserState();


    if (chatInput) {

      chatInput.value =
        '';


      autoResizeInput();


      updateSendButton();


      chatInput.focus();
    }
  }


  function clearRenderedMessages() {

    if (!messageList) {
      return;
    }


    messageList.innerHTML =
      '';
  }


  /* =========================================================
     ERROR HANDLING
     ========================================================= */

  function getFallbackErrorMessage() {

    return `
      <p>I'm sorry, I couldn't complete that request right now.</p>
      <p>Please try again in a moment.</p>
    `;
  }


  /* =========================================================
     PUBLIC API
     ========================================================= */

  window.AlphexChatbot = {

    open() {

      openChat();
    },


    close() {

      closeChat();
    },


    newConversation() {

      startNewConversation();
    },


    send(message) {

      if (!chatInput) {
        return;
      }


      chatInput.value =
        String(
          message || ''
        );


      enforceInputLimit();

      autoResizeInput();

      updateSendButton();


      return handleSendMessage();
    },


    getUser() {

      return state.currentUser;
    },


    getConversationId() {

      return state.conversationId;
    }
  };


  /* =========================================================
     START
     ========================================================= */

  initialize();

})();
