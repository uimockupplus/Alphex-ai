'use strict';

/*
 * ALPHEX AI — CHATBOT API
 *
 * Supports:
 * - Groq primary provider
 * - Gemini fallback provider
 * - Verified Alphex knowledge
 * - Authenticated conversation persistence
 * - Conversation history retrieval
 * - Consistent response format
 *
 * Required Vercel environment variables:
 * SUPABASE_URL
 * SUPABASE_SERVICE_ROLE_KEY
 * GROQ_API_KEY
 * GEMINI_API_KEY
 *
 * Never expose SUPABASE_SERVICE_ROLE_KEY in frontend code.
 */

const crypto = require('crypto');

const {
  getAlphexKnowledge,
  getAlphexKnowledgeText,
  getAlphexChatbotRules
} = require('./alphex-knowledge.js');

const DEFAULT_GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
  'llama-3.3-70b-versatile'
];

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite'
];

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_TOTAL_PROVIDER_TIME = 18000;
const PROVIDER_TIMEOUT = 6500;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getEnv(...names) {
  for (const name of names) {
    const value = process.env[name];

    if (value && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function getSupabaseConfig() {
  return {
    url: getEnv(
      'SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_URL'
    ).replace(/\/+$/, ''),

    serviceKey: getEnv(
      'SUPABASE_SERVICE_ROLE_KEY'
    )
  };
}

function getGroqModels() {
  const configured = getEnv('GROQ_MODELS');

  if (configured) {
    return configured
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }

  const single = getEnv('GROQ_MODEL');

  return single
    ? [single]
    : DEFAULT_GROQ_MODELS;
}

function getGeminiModels() {
  const configured = getEnv('GEMINI_MODELS');

  if (configured) {
    return configured
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);
  }

  const single = getEnv('GEMINI_MODEL');

  return single
    ? [single]
    : DEFAULT_GEMINI_MODELS;
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, statusCode, data) {
  return res.status(statusCode).json(data);
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';

  const match = header.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : '';
}

function getPageContext(page) {
  if (!page || typeof page !== 'object') {
    return 'Page context unavailable.';
  }

  return [
    `Title: ${String(page.title || '').slice(0, 200)}`,
    `Path: ${String(page.path || '').slice(0, 500)}`,
    `URL: ${String(page.url || '').slice(0, 1000)}`
  ].join('\n');
}

function getKnowledgeContext() {
  const knowledge = getAlphexKnowledge();

  /*
   * Use a compact selection instead of sending the entire
   * knowledge file on every request. This helps control
   * input-token consumption and provider rate limits.
   */
  const compact = {
    company: knowledge.company,
    business_model: knowledge.business_model,
    solutions: knowledge.solutions,
    products: knowledge.products,
    evaluation: knowledge.evaluation,
    pricing: knowledge.pricing,
    industries: knowledge.industries,
    contact: knowledge.contact,
    chatbot: knowledge.chatbot,
    chatbot_behavior: knowledge.chatbot_behavior,
    general_ai: knowledge.general_ai,
    business_enquiries: knowledge.business_enquiries,
    boundaries: knowledge.boundaries,
    response_style: knowledge.response_style
  };

  return JSON.stringify(compact);
}

function buildSystemPrompt(pageContext) {
  const rules = getAlphexChatbotRules();

  return `
You are Alphex Minibot, the conversational assistant on the Alphex AI website.

YOUR JOB
Help visitors understand Alphex AI, answer general questions naturally, explain relevant services and products, and help visitors explore potential business requirements.

VERIFIED COMPANY KNOWLEDGE
Use the following knowledge as the source of truth for claims about Alphex AI.

${getKnowledgeContext()}

CONVERSATION RULES
${rules.map(rule => '- ' + rule).join('\n')}

GENERAL QUESTIONS
You may answer general knowledge and AI questions naturally.
Do not force unrelated questions back toward Alphex AI.
Do not pretend general knowledge is an official company statement.
If a question requires current information that you cannot verify, say so.

ACCURACY
Never invent customers, partnerships, certifications, integrations, pricing, delivery dates, statistics, or guarantees.
When a company-specific fact is unavailable, say that you do not have confirmed information.

STYLE
Be natural, concise, clear, and conversational.
Answer the actual question first.
Use readable paragraphs and Markdown when useful.
Avoid repeating greetings and company introductions.
Ask a clarifying question only when genuinely necessary.

CURRENT PAGE
${pageContext}

Return only the answer intended for the visitor.
`.trim();
}

function normalizeHistory(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter(item => {
      return (
        item &&
        ['user', 'assistant'].includes(item.role) &&
        typeof item.content === 'string'
      );
    })
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => ({
      role: item.role,
      content: item.content.slice(0, 8000)
    }));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getAuthenticatedUser(req) {
  const token = getBearerToken(req);

  if (!token) {
    return null;
  }

  const { url, serviceKey } = getSupabaseConfig();

  if (!url || !serviceKey) {
    return null;
  }

  const response = await fetchWithTimeout(
    `${url}/auth/v1/user`,
    {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${token}`
      }
    },
    5000
  );

  if (!response.ok) {
    return null;
  }

  const user = await response.json();

  if (!user || !user.id) {
    return null;
  }

  return user;
}

async function supabaseRest(path, options = {}) {
  const { url, serviceKey } = getSupabaseConfig();

  if (!url || !serviceKey) {
    throw new Error('Supabase server configuration is missing.');
  }

  const response = await fetchWithTimeout(
    `${url}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    },
    6000
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.hint ||
      `Supabase request failed (${response.status}).`
    );

    error.status = response.status;

    throw error;
  }

  return data;
}

async function loadConversationHistory(conversationId, userId) {
  if (!UUID_PATTERN.test(conversationId)) {
    throw new Error('Invalid conversation ID.');
  }

  const query = new URLSearchParams({
    conversation_id: `eq.${conversationId}`,
    user_id: `eq.${userId}`,
    select: 'role,content,created_at',
    order: 'created_at.desc',
    limit: String(MAX_HISTORY_MESSAGES)
  });

  const rows = await supabaseRest(
    `conversation_messages?${query.toString()}`
  );

  return (Array.isArray(rows) ? rows : [])
    .reverse()
    .map(row => ({
      role: row.role,
      content: row.content
    }));
}

async function saveConversationMessages(
  conversationId,
  userId,
  userMessage,
  assistantMessage
) {
  if (
    !conversationId ||
    !userId ||
    !userMessage ||
    !assistantMessage
  ) {
    return;
  }

  const rows = [
    {
      conversation_id: conversationId,
      user_id: userId,
      role: 'user',
      content: userMessage
    },
    {
      conversation_id: conversationId,
      user_id: userId,
      role: 'assistant',
      content: assistantMessage
    }
  ];

  await supabaseRest('conversation_messages', {
    method: 'POST',
    headers: {
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
}

async function callGroq(model, messages) {
  const apiKey = getEnv('GROQ_API_KEY');

  if (!apiKey) {
    throw new Error('Groq API key is not configured.');
  }

  const response = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 900
      })
    },
    PROVIDER_TIMEOUT
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `Groq request failed (${response.status}).`
    );
  }

  const answer = data?.choices?.[0]?.message?.content;

  if (typeof answer !== 'string' || !answer.trim()) {
    throw new Error('Groq returned an empty answer.');
  }

  return answer.trim();
}

async function callGemini(model, systemPrompt, history) {
  const apiKey = getEnv('GEMINI_API_KEY');

  if (!apiKey) {
    throw new Error('Gemini API key is not configured.');
  }

  const contents = history.map(item => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: item.content }]
  }));

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 900
        }
      })
    },
    PROVIDER_TIMEOUT
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      `Gemini request failed (${response.status}).`
    );
  }

  const answer = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  if (!answer) {
    throw new Error('Gemini returned an empty answer.');
  }

  return answer;
}

async function generateAnswer(systemPrompt, history) {
  const started = Date.now();
  const errors = [];

  const groqModels = getGroqModels();
  const geminiModels = getGeminiModels();

  const providers = [];

  for (const model of groqModels) {
    providers.push({
      name: 'groq',
      model,
      run: () => callGroq(model, [
        { role: 'system', content: systemPrompt },
        ...history
      ])
    });
  }

  for (const model of geminiModels) {
    providers.push({
      name: 'gemini',
      model,
      run: () => callGemini(model, systemPrompt, history)
    });
  }

  for (const provider of providers) {
    if (Date.now() - started >= MAX_TOTAL_PROVIDER_TIME) {
      break;
    }

    try {
      const answer = await provider.run();

      return {
        answer,
        provider: provider.name,
        model: provider.model,
        elapsed_ms: Date.now() - started
      };
    } catch (error) {
      errors.push({
        provider: provider.name,
        model: provider.model,
        message: error.message
      });

      console.warn('[Alphex Chatbot] Provider attempt failed:', {
        provider: provider.name,
        model: provider.model,
        message: error.message
      });
    }
  }

  const error = new Error(
    'All configured AI providers failed or timed out.'
  );

  error.providerErrors = errors;

  throw error;
}

function sendAnswer(res, {
  answer,
  provider,
  model,
  conversationId,
  elapsedMs
}) {
  return sendJson(res, 200, {
    success: true,

    /*
     * Return both keys so old and new frontend versions
     * can consume the same response.
     */
    message: answer,
    answer,

    provider,
    model,
    conversation_id: conversationId || null,
    elapsed_ms: elapsedMs
  });
}

async function handleGet(req, res) {
  const conversationId = String(
    req.query?.conversation_id || ''
  );

  if (!UUID_PATTERN.test(conversationId)) {
    return sendJson(res, 400, {
      error: 'A valid conversation ID is required.'
    });
  }

  let user;

  try {
    user = await getAuthenticatedUser(req);
  } catch (error) {
    console.error('[Alphex Chatbot] Authentication error:', error);

    return sendJson(res, 401, {
      error: 'Please sign in again to access conversation history.'
    });
  }

  if (!user) {
    return sendJson(res, 401, {
      error: 'Sign in to access saved conversations.'
    });
  }

  try {
    const messages = await loadConversationHistory(
      conversationId,
      user.id
    );

    return sendJson(res, 200, {
      success: true,
      conversation_id: conversationId,
      messages
    });
  } catch (error) {
    console.error('[Alphex Chatbot] History retrieval failed:', error);

    return sendJson(res, 500, {
      error: 'Unable to load conversation history.'
    });
  }
}

async function handlePost(req, res) {
  const started = Date.now();

  const body = req.body || {};

  const message = String(body.message || '').trim();

  if (!message) {
    return sendJson(res, 400, {
      error: 'Please enter a message.'
    });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return sendJson(res, 400, {
      error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer.`
    });
  }

  let user = null;

  try {
    user = await getAuthenticatedUser(req);
  } catch (error) {
    console.warn('[Alphex Chatbot] Authentication lookup failed.');
  }

  let conversationId = null;

  if (user) {
    const requestedId = String(body.conversation_id || '');

    conversationId = UUID_PATTERN.test(requestedId)
      ? requestedId
      : crypto.randomUUID();
  }

  let history = [];

  if (user && conversationId && body.conversation_id) {
    try {
      history = await loadConversationHistory(
        conversationId,
        user.id
      );
    } catch (error) {
      /*
       * A missing conversation table must not prevent the
       * assistant from generating an answer.
       */
      console.warn(
        '[Alphex Chatbot] Could not load history:',
        error.message
      );
    }
  }

  history = normalizeHistory([
    ...history,
    { role: 'user', content: message }
  ]);

  const pageContext = getPageContext(body.page);
  const systemPrompt = buildSystemPrompt(pageContext);

  try {
    const result = await generateAnswer(
      systemPrompt,
      history
    );

    if (user && conversationId) {
      try {
        await saveConversationMessages(
          conversationId,
          user.id,
          message,
          result.answer
        );
      } catch (error) {
        /*
         * Do not discard a valid AI answer because storage
         * failed. The answer should still reach the visitor.
         */
        console.error(
          '[Alphex Chatbot] Message persistence failed:',
          error.message
        );
      }
    }

    return sendAnswer(res, {
      answer: result.answer,
      provider: result.provider,
      model: result.model,
      conversationId,
      elapsedMs: Date.now() - started
    });
  } catch (error) {
    console.error('[Alphex Chatbot] Generation failed:', {
      message: error.message,
      providerErrors: error.providerErrors || []
    });

    return sendJson(res, 503, {
      error: 'The AI service is temporarily unavailable. Please try again shortly.'
    });
  }
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    if (req.method === 'GET') {
      return await handleGet(req, res);
    }

    if (req.method === 'POST') {
      return await handlePost(req, res);
    }

    res.setHeader('Allow', 'GET, POST, OPTIONS');

    return sendJson(res, 405, {
      error: 'Method not allowed.'
    });
  } catch (error) {
    console.error('[Alphex Chatbot] Unexpected API error:', error);

    return sendJson(res, 500, {
      error: 'An unexpected chatbot error occurred.'
    });
  }
};
