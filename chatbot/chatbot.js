/* =========================================================
   ALPHEX AI — CHATBOT CONTROLLER
   ========================================================= */
(() => {
  'use strict';

  const CONFIG = {
    API_ENDPOINT: '/api/chatbot',
    MAX_INPUT_LENGTH: 4000,
    REQUEST_TIMEOUT: 24000,
    STORAGE_KEY: 'alphex_chat_conversation_id',
    FALLBACK_USER_NAME: 'there'
  };

  const chatbot = document.getElementById('alphex-chatbot');

  if (!chatbot) {
    console.warn('[Alphex Chatbot] Root element not found.');
    return;
  }

  const $ = id => document.getElementById(id);

  const toggleButton = $('alphex-chat-toggle');
  const chatWindow = $('alphex-chat-window');
  const closeButton = $('chat-close');
  const newConversationButton = $('chat-new-conversation');
  const chatMessages = $('chat-messages');
  const messageList = $('chat-message-list');
  const chatForm = $('chat-form');
  const chatInput = $('chat-input');
  const chatSend = $('chat-send');
  const thinkingIndicator = $('chat-thinking');
  const welcomeState = $('chat-welcome');
  const returningUser = $('chat-returning-user');
  const userNameElement = $('chat-user-name');
  const continueButton = $('chat-continue-conversation');

  const state = {
    isOpen: false,
    isSending: false,
    currentUser: null,
    currentProfile: null,
    conversationId: null,
    messages: [],
    hasExistingConversation: false
  };

  const SUPABASE_URL =
    'https://nxqxhakjbtdzreimpkdz.supabase.co';

  const SUPABASE_PUBLISHABLE_KEY =
    'sb_publishable_kzCF-pWoVk27YRqvWPIUzg_36ynJbGR';

  let supabaseClient = null;

  function initializeSupabase() {
    if (
      !window.supabase ||
      typeof window.supabase.createClient !== 'function'
    ) {
      console.warn(
        '[Alphex Chatbot] Supabase browser client is not loaded.'
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

  supabaseClient = initializeSupabase();

  async function initialize() {
    bindEvents();
    loadStoredConversation();
    updateSendButton();
    autoResizeInput();

    await loadAuthenticatedUser();

    renderReturningUserState();

    console.log('[Alphex Chatbot] Initialized.');
  }

  function bindEvents() {
    toggleButton?.addEventListener('click', openChat);
    closeButton?.addEventListener('click', closeChat);

    newConversationButton?.addEventListener(
      'click',
      startNewConversation
    );

    continueButton?.addEventListener(
      'click',
      async () => {
        if (!state.isSending) {
          await continuePreviousConversation();
        }
      }
    );

    chatForm?.addEventListener('submit', async event => {
      event.preventDefault();
      await handleSendMessage();
    });

    chatInput?.addEventListener('input', () => {
      enforceInputLimit();
      autoResizeInput();
      updateSendButton();
    });

    chatInput?.addEventListener('keydown', async event => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        await handleSendMessage();
      }
    });

    document.addEventListener('click', async event => {
      const button = event.target.closest('.chat-suggestion');

      if (!button || !chatInput || state.isSending) {
        return;
      }

      const prompt = button.getAttribute('data-prompt');

      if (!prompt) {
        return;
      }

      event.preventDefault();

      chatInput.value = prompt;
      autoResizeInput();
      updateSendButton();

      await handleSendMessage();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.isOpen) {
        closeChat();
      }
    });

    if (supabaseClient?.auth?.onAuthStateChange) {
      supabaseClient.auth.onAuthStateChange(
        async (_event, session) => {
          state.currentUser = session?.user || null;
          state.currentProfile = null;

          if (state.currentUser) {
            await loadUserProfile();
          }

          renderReturningUserState();
        }
      );
    }
  }

  function openChat() {
    if (!chatWindow) {
      return;
    }

    state.isOpen = true;

    chatbot.setAttribute('data-chatbot-state', 'open');
    chatWindow.setAttribute('aria-hidden', 'false');
    toggleButton?.setAttribute('aria-expanded', 'true');

    document.body.classList.add('alphex-chatbot-open');

    setTimeout(() => {
      scrollMessagesToBottom();

      if (chatInput) {
        chatInput.focus();
      }
    }, 120);
  }

  function closeChat() {
    if (!chatWindow) {
      return;
    }

    state.isOpen = false;

    chatbot.setAttribute('data-chatbot-state', 'closed');
    chatWindow.setAttribute('aria-hidden', 'true');
    toggleButton?.setAttribute('aria-expanded', 'false');

    document.body.classList.remove('alphex-chatbot-open');
  }

  function enforceInputLimit() {
    if (!chatInput) {
      return;
    }

    if (chatInput.value.length > CONFIG.MAX_INPUT_LENGTH) {
      chatInput.value = chatInput.value.slice(
        0,
        CONFIG.MAX_INPUT_LENGTH
      );
    }
  }

  function autoResizeInput() {
    if (!chatInput) {
      return;
    }

    chatInput.style.height = 'auto';

    chatInput.style.height =
      Math.min(chatInput.scrollHeight, 180) + 'px';
  }

  function updateSendButton() {
    if (!chatSend || !chatInput) {
      return;
    }

    chatSend.disabled =
      !chatInput.value.trim() ||
      state.isSending;
  }

  async function handleSendMessage() {
    if (!chatInput || state.isSending) {
      return;
    }

    const message = chatInput.value.trim();

    if (!message) {
      return;
    }

    if (message.length > CONFIG.MAX_INPUT_LENGTH) {
      return;
    }

    state.isSending = true;
    updateSendButton();

    chatInput.value = '';
    autoResizeInput();
    updateSendButton();

    hideWelcomeState();

    addMessage('user', message);
    showThinking();

    try {
      const response = await sendToBackend(message);

      hideThinking();

      /*
       The API returns both `message` and `answer`.
       Accept either to remain compatible with older API versions.
      */
      const answer =
        typeof response?.message === 'string'
          ? response.message
          : typeof response?.answer === 'string'
            ? response.answer
            : '';

      if (!answer.trim()) {
        throw new Error(
          'The server returned an empty answer.'
        );
      }

      addMessage('assistant', answer);

      if (response.conversation_id) {
        state.conversationId = response.conversation_id;
        state.hasExistingConversation = true;
        saveStoredConversation();
        renderReturningUserState();
      }
    } catch (error) {
      console.error('[Alphex Chatbot] Message error:', error);

      hideThinking();

      addMessage(
        'assistant',
        getErrorMessage(error)
      );
    } finally {
      state.isSending = false;
      updateSendButton();

      if (chatInput) {
        chatInput.focus();
      }
    }
  }

  async function sendToBackend(message) {
    const session = await getCurrentSession();

    const payload = {
      message,
      conversation_id: state.conversationId || null,
      page: {
        url: window.location.href,
        path: window.location.pathname,
        title: document.title
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };

    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(CONFIG.API_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || `Request failed (${response.status}).`
        );
      }

      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(
          'The request timed out. Please try again.'
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function addMessage(role, content) {
    if (!messageList) {
      return null;
    }

    const messageElement = document.createElement('div');

    messageElement.className =
      `chat-message chat-message-${role}`;

    /*
     * The CSS styles `.chat-message-content`.
     * Use that same class here.
     */
    const bubble = document.createElement('div');
    bubble.className = 'chat-message-content';

    if (role === 'assistant') {
      bubble.innerHTML = renderMarkdown(content);
    } else {
      bubble.textContent = String(content);
    }

    messageElement.appendChild(bubble);
    messageList.appendChild(messageElement);

    state.messages.push({
      role,
      content: String(content)
    });

    scrollMessagesToBottom();

    return messageElement;
  }

  function renderMarkdown(value) {
    if (!value) {
      return '';
    }

    let text = String(value);

    /*
     * Convert common accidental HTML into readable text.
     * This is not a general-purpose HTML parser.
     */
    text = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<\/(div|p|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '');

    let safe = escapeHTML(text);

    /*
     * Code blocks first.
     */
    safe = safe.replace(
      /```([\s\S]*?)```/g,
      '<pre><code>$1</code></pre>'
    );

    safe = safe.replace(
      /`([^`]+)`/g,
      '<code>$1</code>'
    );

    safe = safe.replace(
      /\*\*(.*?)\*\*/g,
      '<strong>$1</strong>'
    );

    safe = safe.replace(
      /(^|[^\*])\*([^\*]+)\*/g,
      '$1<em>$2</em>'
    );

    /*
     * Linkify only http/https links.
     */
    safe = safe.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    /*
     * Convert headings and bullet lines.
     */
    safe = safe.replace(
      /^###\s+(.+)$/gm,
      '<h4>$1</h4>'
    );

    safe = safe.replace(
      /^##\s+(.+)$/gm,
      '<h3>$1</h3>'
    );

    safe = safe.replace(
      /^#\s+(.+)$/gm,
      '<h3>$1</h3>'
    );

    safe = safe.replace(
      /^\s*[-•]\s+(.+)$/gm,
      '<li>$1</li>'
    );

    safe = safe.replace(
      /(<li>[\s\S]*?<\/li>)/g,
      '<ul>$1</ul>'
    );

    safe = safe.replace(/\n\n/g, '</p><p>');
    safe = safe.replace(/\n/g, '<br>');

    return `<p>${safe}</p>`;
  }

  function escapeHTML(value) {
    const element = document.createElement('div');
    element.textContent = String(value);
    return element.innerHTML;
  }

  function showThinking() {
    if (thinkingIndicator) {
      thinkingIndicator.hidden = false;
      scrollMessagesToBottom();
    }
  }

  function hideThinking() {
    if (thinkingIndicator) {
      thinkingIndicator.hidden = true;
    }
  }

  function scrollMessagesToBottom() {
    if (!chatMessages) {
      return;
    }

    requestAnimationFrame(() => {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  function hideWelcomeState() {
    if (welcomeState) {
      welcomeState.hidden = true;
    }
  }

  function showWelcomeState() {
    if (welcomeState) {
      welcomeState.hidden = false;
    }
  }

  async function loadAuthenticatedUser() {
    if (!supabaseClient) {
      return;
    }

    try {
      const session = await getCurrentSession();

      state.currentUser = session?.user || null;

      if (state.currentUser) {
        await loadUserProfile();
      }
    } catch (error) {
      console.warn(
        '[Alphex Chatbot] Could not load authenticated user:',
        error
      );
    }
  }

  async function getCurrentSession() {
    if (!supabaseClient?.auth) {
      return null;
    }

    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) {
      throw error;
    }

    return data?.session || null;
  }

  async function loadUserProfile() {
    if (!supabaseClient || !state.currentUser) {
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('user_id,full_name,company,role,avatar_url')
        .eq('user_id', state.currentUser.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      state.currentProfile = data || null;
    } catch (error) {
      console.warn(
        '[Alphex Chatbot] Profile could not be loaded:',
        error
      );

      state.currentProfile = null;
    }
  }

  function loadStoredConversation() {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_KEY);

      if (stored) {
        state.conversationId = stored;
        state.hasExistingConversation = true;
      }
    } catch (error) {
      console.warn(
        '[Alphex Chatbot] Local storage is unavailable:',
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
        CONFIG.STORAGE_KEY,
        state.conversationId
      );
    } catch (error) {
      console.warn(
        '[Alphex Chatbot] Could not save conversation ID:',
        error
      );
    }
  }

  async function continuePreviousConversation() {
    if (!state.conversationId) {
      return;
    }

    const session = await getCurrentSession();

    if (!session?.access_token) {
      addMessage(
        'assistant',
        'Please sign in to retrieve a saved conversation.'
      );
      return;
    }

    hideWelcomeState();

    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${session.access_token}`
    };

    try {
      const response = await fetch(
        `${CONFIG.API_ENDPOINT}?conversation_id=${encodeURIComponent(
          state.conversationId
        )}`,
        {
          method: 'GET',
          headers
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error || 'Unable to load conversation history.'
        );
      }

      if (!Array.isArray(data.messages)) {
        return;
      }

      clearRenderedMessages();
      state.messages = [];

      data.messages.forEach(item => {
        if (
          ['user', 'assistant'].includes(item.role) &&
          typeof item.content === 'string'
        ) {
          addMessage(item.role, item.content);
        }
      });

      scrollMessagesToBottom();
    } catch (error) {
      console.error(
        '[Alphex Chatbot] Conversation retrieval failed:',
        error
      );

      addMessage(
        'assistant',
        'I could not load that saved conversation. You can start a new conversation instead.'
      );
    }
  }

  function startNewConversation() {
    state.conversationId = null;
    state.messages = [];
    state.hasExistingConversation = false;

    try {
      localStorage.removeItem(CONFIG.STORAGE_KEY);
    } catch {
      // Storage is optional.
    }

    clearRenderedMessages();
    hideThinking();
    showWelcomeState();
    renderReturningUserState();

    if (chatMessages) {
      chatMessages.scrollTo({
        top: 0,
        behavior: 'auto'
      });
    }

    if (chatInput) {
      chatInput.value = '';
      autoResizeInput();
      updateSendButton();
      chatInput.focus();
    }
  }

  function clearRenderedMessages() {
    if (messageList) {
      messageList.replaceChildren();
    }
  }

  function getUserName() {
    if (state.currentProfile?.full_name) {
      return state.currentProfile.full_name;
    }

    const metadata = state.currentUser?.user_metadata || {};

    if (metadata.full_name) {
      return metadata.full_name;
    }

    if (metadata.name) {
      return metadata.name;
    }

    if (state.currentUser?.email) {
      return state.currentUser.email.split('@')[0];
    }

    return CONFIG.FALLBACK_USER_NAME;
  }

  function renderReturningUserState() {
    if (!returningUser || !userNameElement) {
      return;
    }

    if (!state.currentUser) {
      returningUser.hidden = true;
      return;
    }

    userNameElement.textContent = getUserName();

    returningUser.hidden = !state.hasExistingConversation;
  }

  function getErrorMessage(error) {
    /*
     Keep technical provider and database details out
     of the visitor-facing chat bubble.
     Full diagnostics remain in the browser/server logs.
     */
    if (error?.message === 'Failed to fetch') {
      return 'I could not reach the chatbot service. Please try again shortly.';
    }

    if (error?.message?.includes('timed out')) {
      return 'That request took too long. Please try again.';
    }

    return 'I’m sorry, I couldn’t complete that request right now. Please try again in a moment.';
  }

  window.AlphexChatbot = {
    open: openChat,
    close: closeChat,
    newConversation: startNewConversation,

    async send(message) {
      if (!chatInput) {
        return;
      }

      chatInput.value = String(message || '');

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

  initialize();
})();
