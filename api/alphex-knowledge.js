/* =========================================================
   ALPHEX AI — CHATBOT API
   ---------------------------------------------------------
   Multi-model provider routing:

   Groq pool:
   1. openai/gpt-oss-120b
   2. openai/gpt-oss-20b
   3. qwen/qwen3.8-27b

   Gemini pool:
   1. gemini-3.7-flash
   2. gemini-3.6-flash

   IMPORTANT:
   - Supabase is optional for public/anonymous chat.
   - Provider failure never exposes internal routing to users.
   - Conversation persistence failure never breaks AI replies.
   - Model pools can be overridden through environment variables.
   ========================================================= */

const { createClient } = require('@supabase/supabase-js');

const {
  getAlphexKnowledgeText,
  getAlphexChatbotRules
} = require('./alphex-knowledge');

/* =========================================================
   MODEL POOLS
   ========================================================= */

/*
 * You can override these in Vercel without changing code:
 *
 * GROQ_MODELS
 * Example:
 * openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b
 *
 * GEMINI_MODELS
 * Example:
 * gemini-3.7-flash,gemini-3.6-flash
 *
 * GROQ_MODEL is also supported for backwards compatibility.
 */

const DEFAULT_GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b'
];

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash'
];

function parseModelList(value, fallback) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return fallback;
  }

  const models = value
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

  return models.length > 0
    ? [...new Set(models)]
    : fallback;
}

/*
 * Backwards compatibility:
 *
 * If GROQ_MODELS exists, use it.
 * Otherwise if GROQ_MODEL exists, make it the first model
 * and keep the remaining default fallback models.
 */
const configuredGroqModels =
  parseModelList(
    process.env.GROQ_MODELS,
    null
  );

const GROQ_MODELS =
  configuredGroqModels ||
  (
    process.env.GROQ_MODEL &&
    process.env.GROQ_MODEL.trim()
      ? [
          process.env.GROQ_MODEL.trim(),
          ...DEFAULT_GROQ_MODELS.filter(
            model =>
              model !==
              process.env.GROQ_MODEL.trim()
          )
        ]
      : DEFAULT_GROQ_MODELS
  );

const GEMINI_MODELS =
  parseModelList(
    process.env.GEMINI_MODELS,
    DEFAULT_GEMINI_MODELS
  );

/* =========================================================
   TIMING
   ========================================================= */

const TOTAL_PROVIDER_BUDGET_MS = 7800;

const GROQ_TIMEOUT_MS = 2400;
const GEMINI_TIMEOUT_MS = 2400;

/*
 * Lower history dramatically reduces TPM usage.
 *
 * The system prompt already contains the verified Alphex
 * knowledge. Conversation history is only needed for
 * continuity.
 */
const MAX_HISTORY_MESSAGES = 8;

/*
 * Memories are useful but should not create huge prompts.
 */
const MAX_MEMORY_ITEMS = 6;

const MAX_MESSAGE_LENGTH = 4000;

/*
 * Alphex Minibot normally does not need 1000 output tokens.
 *
 * 650 tokens is enough for conversational answers while
 * reducing provider token pressure.
 */
const MAX_OUTPUT_TOKENS = 650;

const TEMPERATURE = 0.55;

/* =========================================================
   ENVIRONMENT
   ========================================================= */

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || '';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || '';

const SUPABASE_URL =
  process.env.SUPABASE_URL || '';

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/* =========================================================
   SUPABASE
   ========================================================= */

let supabaseAdmin = null;

if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {
  try {
    supabaseAdmin =
      createClient(
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );
  } catch (error) {
    console.error(
      '[Alphex Chatbot] Supabase initialization failed:',
      error?.message || error
    );

    supabaseAdmin = null;
  }
}

/* =========================================================
   CORS
   ========================================================= */

function setCorsHeaders(res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );
}

/* =========================================================
   JSON RESPONSE
   ========================================================= */

function sendJson(
  res,
  status,
  payload
) {
  return res
    .status(status)
    .json(payload);
}

/* =========================================================
   MAIN HANDLER
   ========================================================= */

module.exports = async function handler(
  req,
  res
) {
  setCorsHeaders(res);

  if (
    req.method === 'OPTIONS'
  ) {
    return res
      .status(204)
      .end();
  }

  if (
    req.method === 'GET'
  ) {
    return handleGetConversation(
      req,
      res
    );
  }

  if (
    req.method === 'POST'
  ) {
    return handlePostMessage(
      req,
      res
    );
  }

  return sendJson(
    res,
    405,
    {
      error:
        'Method not allowed.'
    }
  );
};

/* =========================================================
   POST — CHAT MESSAGE
   ========================================================= */

async function handlePostMessage(
  req,
  res
) {
  const startedAt =
    Date.now();

  try {
    /* -------------------------------------------------------
       PROVIDER CONFIGURATION
       ------------------------------------------------------- */

    if (
      !GROQ_API_KEY &&
      !GEMINI_API_KEY
    ) {
      console.error(
        '[Alphex Chatbot] No AI provider API key is configured.'
      );

      return sendJson(
        res,
        500,
        {
          error:
            'No AI provider is configured on the server.'
        }
      );
    }

    /* -------------------------------------------------------
       REQUEST VALIDATION
       ------------------------------------------------------- */

    const body =
      req.body || {};

    const message =
      typeof body.message ===
      'string'
        ? body.message.trim()
        : '';

    if (!message) {
      return sendJson(
        res,
        400,
        {
          error:
            'Message is required.'
        }
      );
    }

    if (
      message.length >
      MAX_MESSAGE_LENGTH
    ) {
      return sendJson(
        res,
        400,
        {
          error:
            `Message must be ${MAX_MESSAGE_LENGTH} characters or less.`
        }
      );
    }

    /* -------------------------------------------------------
       AUTHENTICATION
       ------------------------------------------------------- */

    const accessToken =
      getBearerToken(req);

    let user = null;

    if (
      accessToken &&
      supabaseAdmin
    ) {
      user =
        await authenticateUser(
          accessToken
        );
    }

    /* -------------------------------------------------------
       CONVERSATION
       ------------------------------------------------------- */

    let conversationId =
      sanitizeConversationId(
        body.conversation_id
      );

    if (
      user &&
      !conversationId
    ) {
      conversationId =
        await createConversation(
          user.id
        );
    }

    if (
      user &&
      conversationId
    ) {
      const ownsConversation =
        await verifyConversationOwnership(
          conversationId,
          user.id
        );

      if (!ownsConversation) {
        conversationId =
          await createConversation(
            user.id
          );
      }
    }

    /* -------------------------------------------------------
       LOAD CONTEXT
       ------------------------------------------------------- */

    let history = [];
    let memories = [];

    if (
      user &&
      conversationId
    ) {
      history =
        await loadConversationHistory(
          conversationId,
          user.id
        );

      memories =
        await loadUserMemories(
          user.id
        );
    }

    /* -------------------------------------------------------
       PROFILE
       ------------------------------------------------------- */

    let profile = null;

    if (user) {
      profile =
        await loadProfile(
          user.id
        );
    }

    /* -------------------------------------------------------
       SYSTEM PROMPT
       ------------------------------------------------------- */

    const systemPrompt =
      buildSystemPrompt({
        profile,
        memories
      });

    /* -------------------------------------------------------
       MODEL MESSAGES
       ------------------------------------------------------- */

    const modelMessages =
      buildModelMessages({
        systemPrompt,
        history,
        message
      });

    /* -------------------------------------------------------
       PROVIDER ROUTING
       ------------------------------------------------------- */

    const providerStartedAt =
      Date.now();

    const providerResult =
      await runProviderPool({
        messages:
          modelMessages,
        startedAt
      });

    if (
      !providerResult
    ) {
      const elapsed =
        Date.now() -
        startedAt;

      console.error(
        '[Alphex Chatbot] All AI providers failed.',
        {
          elapsed,
          groqConfigured:
            Boolean(
              GROQ_API_KEY
            ),
          geminiConfigured:
            Boolean(
              GEMINI_API_KEY
            ),
          groqModels:
            GROQ_MODELS,
          geminiModels:
            GEMINI_MODELS,
          supabaseConfigured:
            Boolean(
              supabaseAdmin
            )
        }
      );

      return sendJson(
        res,
        503,
        {
          error:
            'The AI service is temporarily unavailable.',
          detail:
            'All configured AI models were unavailable.'
        }
      );
    }

    /* -------------------------------------------------------
       CLEAN RESPONSE
       ------------------------------------------------------- */

    const assistantMessage =
      cleanAssistantResponse(
        providerResult.text
      );

    if (!assistantMessage) {
      return sendJson(
        res,
        503,
        {
          error:
            'The AI service returned an empty response.'
        }
      );
    }

    /* -------------------------------------------------------
       SAVE CONVERSATION
       ------------------------------------------------------- */

    /*
     * Persistence is NEVER allowed to break a successful
     * AI response.
     */

    if (
      user &&
      conversationId &&
      supabaseAdmin
    ) {
      try {
        await saveMessage(
          conversationId,
          user.id,
          'user',
          message
        );

        await saveMessage(
          conversationId,
          user.id,
          'assistant',
          assistantMessage
        );

        await touchConversation(
          conversationId,
          user.id
        );
      } catch (error) {
        console.warn(
          '[Alphex Chatbot] Conversation persistence unavailable:',
          error?.message ||
            error
        );
      }
    }

    /* -------------------------------------------------------
       RESPONSE
       ------------------------------------------------------- */

    const totalTime =
      Date.now() -
      startedAt;

    const providerTime =
      Date.now() -
      providerStartedAt;

    return sendJson(
      res,
      200,
      {
        message:
          assistantMessage,

        conversation_id:
          conversationId ||
          null,

        authenticated:
          Boolean(user),

        provider:
          providerResult.provider,

        model:
          providerResult.model,

        response_time_ms:
          totalTime,

        provider_time_ms:
          providerTime
      }
    );
  } catch (error) {
    console.error(
      '[Alphex Chatbot] Unhandled error:',
      error?.stack ||
        error
    );

    return sendJson(
      res,
      500,
      {
        error:
          'Something went wrong while processing your message.'
      }
    );
  }
};

/* =========================================================
   PROVIDER POOL
   ========================================================= */

async function runProviderPool({
  messages,
  startedAt
}) {
  /*
   * Groq gets first priority.
   *
   * Every model gets its own attempt.
   *
   * We DO NOT wait for a 429 retry window.
   * If a model is rate-limited, immediately try the next
   * model.
   */

  if (GROQ_API_KEY) {
    for (
      const model of GROQ_MODELS
    ) {
      const remaining =
        TOTAL_PROVIDER_BUDGET_MS -
        (
          Date.now() -
          startedAt
        );

      if (
        remaining <
        700
      ) {
        break;
      }

      const timeoutMs =
        Math.min(
          GROQ_TIMEOUT_MS,
          Math.max(
            700,
            remaining
          )
        );

      try {
        console.log(
          `[Alphex Chatbot] Trying Groq model: ${model}`
        );

        return await callGroq({
          model,
          messages,
          timeoutMs
        });
      } catch (error) {
        console.warn(
          `[Alphex Chatbot] Groq model failed: ${model}`,
          error?.message ||
            error
        );
      }
    }
  }

  /*
   * Gemini becomes the secondary pool.
   *
   * Again, a failed model is immediately skipped.
   */

  if (GEMINI_API_KEY) {
    for (
      const model of GEMINI_MODELS
    ) {
      const remaining =
        TOTAL_PROVIDER_BUDGET_MS -
        (
          Date.now() -
          startedAt
        );

      if (
        remaining <
        700
      ) {
        break;
      }

      const timeoutMs =
        Math.min(
          GEMINI_TIMEOUT_MS,
          Math.max(
            700,
            remaining
          )
        );

      try {
        console.log(
          `[Alphex Chatbot] Trying Gemini model: ${model}`
        );

        return await callGemini({
          model,
          messages,
          timeoutMs
        });
      } catch (error) {
        console.warn(
          `[Alphex Chatbot] Gemini model failed: ${model}`,
          error?.message ||
            error
        );
      }
    }
  }

  return null;
}

/* =========================================================
   GET — PREVIOUS CONVERSATION
   ========================================================= */

async function handleGetConversation(
  req,
  res
) {
  try {
    const conversationId =
      sanitizeConversationId(
        req.query?.conversation_id
      );

    if (!conversationId) {
      return sendJson(
        res,
        400,
        {
          error:
            'conversation_id is required.'
        }
      );
    }

    if (!supabaseAdmin) {
      return sendJson(
        res,
        503,
        {
          error:
            'Conversation storage is not configured.'
        }
      );
    }

    const accessToken =
      getBearerToken(req);

    if (!accessToken) {
      return sendJson(
        res,
        401,
        {
          error:
            'Authentication required.'
        }
      );
    }

    const user =
      await authenticateUser(
        accessToken
      );

    if (!user) {
      return sendJson(
        res,
        401,
        {
          error:
            'Authentication required.'
        }
      );
    }

    const ownsConversation =
      await verifyConversationOwnership(
        conversationId,
        user.id
      );

    if (!ownsConversation) {
      return sendJson(
        res,
        403,
        {
          error:
            'You do not have access to this conversation.'
        }
      );
    }

    const messages =
      await loadConversationHistory(
        conversationId,
        user.id,
        100
      );

    return sendJson(
      res,
      200,
      {
        conversation_id:
          conversationId,
        messages
      }
    );
  } catch (error) {
    console.error(
      '[Alphex Chatbot] GET conversation error:',
      error?.stack ||
        error
    );

    return sendJson(
      res,
      500,
      {
        error:
          'Unable to load the conversation.'
      }
    );
  }
}

/* =========================================================
   AUTHENTICATION
   ========================================================= */

function getBearerToken(req) {
  const header =
    req.headers?.authorization ||
    '';

  if (
    typeof header !==
    'string'
  ) {
    return null;
  }

  if (
    !header
      .toLowerCase()
      .startsWith('bearer ')
  ) {
    return null;
  }

  return (
    header
      .slice(7)
      .trim() ||
    null
  );
}

async function authenticateUser(
  accessToken
) {
  if (
    !supabaseAdmin ||
    !accessToken
  ) {
    return null;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseAdmin.auth.getUser(
        accessToken
      );

    if (
      error ||
      !data?.user
    ) {
      return null;
    }

    return data.user;
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] Authentication failed:',
      error?.message ||
        error
    );

    return null;
  }
}

/* =========================================================
   PROFILE
   ========================================================= */

async function loadProfile(
  userId
) {
  if (
    !supabaseAdmin ||
    !userId
  ) {
    return null;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseAdmin
        .from('profiles')
        .select(
          'user_id,full_name,company,role,avatar_url'
        )
        .eq(
          'user_id',
          userId
        )
        .maybeSingle();

    if (error) {
      console.warn(
        '[Alphex Chatbot] Profile lookup failed:',
        error?.message ||
          error
      );

      return null;
    }

    return data || null;
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] Profile loading failed:',
      error?.message ||
        error
    );

    return null;
  }
}

/* =========================================================
   CONVERSATIONS
   ========================================================= */

async function createConversation(
  userId
) {
  if (
    !supabaseAdmin ||
    !userId
  ) {
    return null;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseAdmin
        .from('conversations')
        .insert({
          user_id:
            userId
        })
        .select('id')
        .single();

    if (error) {
      console.warn(
        '[Alphex Chatbot] Conversation creation failed:',
        error?.message ||
          error
      );

      return null;
    }

    return (
      data?.id ||
      null
    );
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] Conversation creation failed:',
      error?.message ||
        error
    );

    return null;
  }
}

async function verifyConversationOwnership(
  conversationId,
  userId
) {
  if (
    !supabaseAdmin ||
    !conversationId ||
    !userId
  ) {
    return false;
  }

  try {
    const {
      data,
      error
    } =
      await supabaseAdmin
        .from('conversations')
        .select(
          'id,user_id'
        )
        .eq(
          'id',
          conversationId
        )
        .eq(
          'user_id',
          userId
        )
        .maybeSingle();

    if (error) {
      console.warn(
        '[Alphex Chatbot] Conversation ownership check failed:',
        error?.message ||
          error
      );

      return false;
    }

    return Boolean(data);
  } catch (error) {
    return false;
  }
}

async function touchConversation(
  conversationId,
  userId
) {
  if (
    !supabaseAdmin ||
    !conversationId ||
    !userId
  ) {
    return;
  }

  try {
    await supabaseAdmin
      .from('conversations')
      .update({
        updated_at:
          new Date().toISOString()
      })
      .eq(
        'id',
        conversationId
      )
      .eq(
        'user_id',
        userId
      );
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] Conversation timestamp update failed:',
      error?.message ||
        error
    );
  }
}

/* =========================================================
   MESSAGE HISTORY
   ========================================================= */

async function loadConversationHistory(
  conversationId,
  userId,
  limit = MAX_HISTORY_MESSAGES
) {
  if (
    !supabaseAdmin ||
    !conversationId ||
    !userId
  ) {
    return [];
  }

  try {
    const {
      data,
      error
    } =
      await supabaseAdmin
        .from('conversation_messages')
        .select(
          'role,content,created_at'
        )
        .eq(
          'conversation_id',
          conversationId
        )
        .eq(
          'user_id',
          userId
        )
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(limit);

    if (error) {
      /*
       * PGRST205 means the table is not present.
       *
       * This is a persistence problem, NOT an AI problem.
       *
       * Do not allow it to contaminate the chatbot.
       */
      if (
        error.code ===
        'PGRST205'
      ) {
        console.warn(
          '[Alphex Chatbot] conversation_messages table is unavailable. Continuing without history.'
        );
      } else {
        console.warn(
          '[Alphex Chatbot] History lookup failed:',
          error?.message ||
            error
        );
      }

      return [];
    }

    return (data || [])
      .reverse()
      .filter(
        item =>
          (
            item.role ===
              'user' ||
            item.role ===
              'assistant'
          ) &&
          typeof item.content ===
            'string'
      )
      .map(
        item => ({
          role:
            item.role,
          content:
            limitText(
              item.content,
              1800
            )
        })
      );
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] History loading exception:',
      error?.message ||
        error
    );

    return [];
  }
}

/* =========================================================
   USER MEMORY
   ========================================================= */

async function loadUserMemories(
  userId
) {
  if (
    !supabaseAdmin ||
    !userId
  ) {
    return [];
  }

  try {
    const {
      data,
      error
    } =
      await supabaseAdmin
        .from('user_memories')
        .select(
          'memory,memory_type,importance,updated_at'
        )
        .eq(
          'user_id',
          userId
        )
        .order(
          'importance',
          {
            ascending:
              false
          }
        )
        .order(
          'updated_at',
          {
            ascending:
              false
          }
        )
        .limit(
          MAX_MEMORY_ITEMS
        );

    if (error) {
      console.warn(
        '[Alphex Chatbot] Memory lookup failed:',
        error?.message ||
          error
      );

      return [];
    }

    return (data || [])
      .filter(
        item =>
          typeof item.memory ===
          'string'
      )
      .map(
        item => ({
          memory:
            limitText(
              item.memory,
              700
            ),
          memory_type:
            item.memory_type,
          importance:
            item.importance
        })
      );
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] Memory loading failed:',
      error?.message ||
        error
    );

    return [];
  }
}

/* =========================================================
   SAVE MESSAGE
   ========================================================= */

async function saveMessage(
  conversationId,
  userId,
  role,
  content
) {
  if (
    !supabaseAdmin ||
    !conversationId ||
    !userId ||
    !content
  ) {
    return;
  }

  const {
    error
  } =
    await supabaseAdmin
      .from(
        'conversation_messages'
      )
      .insert({
        conversation_id:
          conversationId,
        user_id:
          userId,
        role,
        content
      });

  if (error) {
    throw error;
  }
}

/* =========================================================
   SYSTEM PROMPT
   ========================================================= */

function buildSystemPrompt({
  profile,
  memories
}) {
  let knowledge = '';

  try {
    knowledge =
      getAlphexKnowledgeText() ||
      '';
  } catch (error) {
    console.error(
      '[Alphex Chatbot] Knowledge loading failed:',
      error?.message ||
        error
    );
  }

  let rules = '';

  try {
    rules =
      getAlphexChatbotRules() ||
      '';
  } catch (error) {
    console.error(
      '[Alphex Chatbot] Rules loading failed:',
      error?.message ||
        error
    );
  }

  const profileContext =
    profile
      ? `
CURRENT USER PROFILE
Name: ${limitText(profile.full_name || 'Not provided', 150)}
Company: ${limitText(profile.company || 'Not provided', 150)}
Role: ${limitText(profile.role || 'Not provided', 150)}
`
      : '';

  const memoryContext =
    Array.isArray(memories) &&
    memories.length > 0
      ? `
RELEVANT USER MEMORY
${memories
  .map(
    item =>
      `- ${item.memory}`
  )
  .join('\n')}
`
      : '';

  return `
You are Alphex Minibot, the conversational AI assistant for Alphex AI.

Your job is to communicate naturally with visitors and customers while representing Alphex AI accurately.

CORE BEHAVIOR

Be conversational, intelligent, concise, helpful and human-friendly.

You should feel like a modern conversational AI assistant rather than a rigid FAQ bot.

Understand:
- greetings
- casual conversation
- short messages
- incomplete sentences
- typos
- slang
- jokes
- playful messages
- follow-up questions
- pronouns
- references such as "it", "they", "that", "the first one", "your company"

Use conversation context.

Do not repeatedly say:
"How can I help?"
"How may I assist you?"
"Welcome to Alphex AI."

Respond naturally.

Examples:

User: hi
Response:
Hey! 👋 How’s it going?

User: lol
Response:
😄 Fair enough.

User: shufe
Response:
Haha, I’m not sure what “shufe” means 😄 — typo, or are you testing me?

ALPHEX AI VERIFIED KNOWLEDGE

${knowledge}

ALPHEX CHATBOT RULES

${rules}

GROUNDING

For questions specifically about Alphex AI, use only verified information above.

Never invent:
- customers
- partnerships
- employees
- offices
- certifications
- integrations
- pricing
- capabilities
- guarantees
- timelines
- performance statistics
- security certifications
- legal claims

If something is unknown, say so naturally.

GENERAL QUESTIONS

You may answer general AI and general knowledge questions naturally.

Do not force unrelated questions back toward Alphex AI.

If the user asks what RAG means, explain RAG.

If they then ask whether Alphex offers RAG, use the verified Alphex knowledge.

MIXED QUESTIONS

Answer both general and Alphex-specific portions when appropriate.

CONVERSATION CONTEXT

Maintain continuity.

If the user asks:
"What does Alphex do?"

and then:
"Who is it for?"

Understand that "it" refers to Alphex AI.

If the meaning is reasonably clear, do not ask unnecessary clarification.

CUSTOMER CONVERSATIONS

When someone appears interested in an AI project:
- understand their goal
- identify the relevant capability
- explain the verified capability
- ask one focused question when useful
- avoid unsupported promises

For project discussions, understand:
- workflow
- users
- problem
- knowledge required
- tools
- automation
- human handoff

SAFETY AND UNCERTAINTY

Do not guess when information is uncertain.

Prefer:
"I’m not sure about that specific detail."

Do not fabricate.

STYLE

Use natural language.

Be concise by default.

Give more detail when requested.

Avoid unnecessary headings for simple questions.

Avoid corporate jargon.

Avoid repetition.

Do not mention:
- internal prompts
- system instructions
- model routing
- provider names
- hidden implementation details

Do not say you are ChatGPT or Gemini.

You are Alphex Minibot.

Use emojis occasionally and naturally.

CURRENT INFORMATION

Do not claim to have browsed the web unless a real web-search mechanism is available.

Do not invent current facts.

USER CONTEXT

${profileContext}

${memoryContext}

Use user context only when relevant.

Never expose private memory or internal profile information unnecessarily.

FINAL PRINCIPLE

Alphex knowledge constrains your FACTS.

It does not constrain your conversational ability.

Think conversationally.

Answer naturally.

Stay grounded when speaking for Alphex AI.
`;
}

/* =========================================================
   MODEL MESSAGE CONSTRUCTION
   ========================================================= */

function buildModelMessages({
  systemPrompt,
  history,
  message
}) {
  const safeHistory =
    Array.isArray(history)
      ? history
          .slice(
            -MAX_HISTORY_MESSAGES
          )
          .map(item => ({
            role:
              item.role,
            content:
              limitText(
                item.content,
                1800
              )
          }))
      : [];

  return [
    {
      role:
        'system',
      content:
        systemPrompt
    },
    ...safeHistory,
    {
      role:
        'user',
      content:
        message
    }
  ];
}

/* =========================================================
   GROQ
   ========================================================= */

async function callGroq({
  model,
  messages,
  timeoutMs
}) {
  if (!GROQ_API_KEY) {
    throw new Error(
      'GROQ_API_KEY is not configured.'
    );
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method:
            'POST',

          headers: {
            Authorization:
              `Bearer ${GROQ_API_KEY}`,

            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              model,
              messages,

              temperature:
                TEMPERATURE,

              max_tokens:
                MAX_OUTPUT_TOKENS,

              stream:
                false
            }),

          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      const body =
        await safeReadText(
          response
        );

      throw new Error(
        `Groq HTTP ${response.status}: ${body}`
      );
    }

    const data =
      await response.json();

    const text =
      data
        ?.choices?.[0]
        ?.message
        ?.content;

    if (
      typeof text !==
        'string' ||
      !text.trim()
    ) {
      throw new Error(
        'Groq returned an empty response.'
      );
    }

    return {
      provider:
        'groq',

      model,

      text:
        text.trim()
    };
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Groq model ${model} timed out after ${timeoutMs}ms.`
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timer
    );
  }
}

/* =========================================================
   GEMINI
   ========================================================= */

async function callGemini({
  model,
  messages,
  timeoutMs
}) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured.'
    );
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const systemMessage =
      messages.find(
        item =>
          item.role ===
          'system'
      );

    const conversationMessages =
      messages.filter(
        item =>
          item.role !==
          'system'
      );

    const contents =
      convertMessagesToGemini(
        conversationMessages
      );

    if (
      contents.length ===
      0
    ) {
      throw new Error(
        'No Gemini conversation content was provided.'
      );
    }

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model
      )}:generateContent?key=${encodeURIComponent(
        GEMINI_API_KEY
      )}`;

    const requestBody = {
      contents,

      generationConfig: {
        temperature:
          TEMPERATURE,

        maxOutputTokens:
          MAX_OUTPUT_TOKENS
      }
    };

    if (
      systemMessage &&
      systemMessage.content
    ) {
      requestBody.system_instruction = {
        parts: [
          {
            text:
              systemMessage.content
          }
        ]
      };
    }

    const response =
      await fetch(
        endpoint,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(
              requestBody
            ),

          signal:
            controller.signal
        }
      );

    if (!response.ok) {
      const body =
        await safeReadText(
          response
        );

      throw new Error(
        `Gemini HTTP ${response.status}: ${body}`
      );
    }

    const data =
      await response.json();

    const text =
      extractGeminiText(
        data
      );

    if (
      typeof text !==
        'string' ||
      !text.trim()
    ) {
      throw new Error(
        'Gemini returned an empty response.'
      );
    }

    return {
      provider:
        'gemini',

      model,

      text:
        text.trim()
    };
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Gemini model ${model} timed out after ${timeoutMs}ms.`
      );
    }

    throw error;
  } finally {
    clearTimeout(
      timer
    );
  }
}

/* =========================================================
   GEMINI MESSAGE CONVERSION
   ========================================================= */

function convertMessagesToGemini(
  messages
) {
  const contents = [];

  for (
    const message of
      messages
  ) {
    if (
      !message ||
      typeof message.content !==
        'string' ||
      !message.content.trim()
    ) {
      continue;
    }

    const role =
      message.role ===
      'assistant'
        ? 'model'
        : 'user';

    const previous =
      contents[
        contents.length - 1
      ];

    /*
     * Gemini requires alternating roles.
     */
    if (
      previous &&
      previous.role ===
        role
    ) {
      previous.parts[0].text +=
        `\n${message.content}`;

      continue;
    }

    contents.push({
      role,

      parts: [
        {
          text:
            message.content
        }
      ]
    });
  }

  return contents;
}

/* =========================================================
   GEMINI RESPONSE EXTRACTION
   ========================================================= */

function extractGeminiText(
  data
) {
  const candidates =
    data?.candidates;

  if (
    !Array.isArray(
      candidates
    )
  ) {
    return '';
  }

  const parts =
    candidates[0]
      ?.content
      ?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return '';
  }

  return parts
    .map(
      part =>
        typeof part?.text ===
        'string'
          ? part.text
          : ''
    )
    .join('')
    .trim();
}

/* =========================================================
   RESPONSE CLEANING
   ========================================================= */

function cleanAssistantResponse(
  text
) {
  if (
    typeof text !==
    'string'
  ) {
    return '';
  }

  return text
    .replace(
      /\u0000/g,
      ''
    )
    .trim();
}

/* =========================================================
   SAFE RESPONSE BODY
   ========================================================= */

async function safeReadText(
  response
) {
  try {
    const text =
      await response.text();

    return text
      ? text.slice(
          0,
          1500
        )
      : '';
  } catch {
    return '';
  }
}

/* =========================================================
   TEXT LIMITER
   ========================================================= */

function limitText(
  value,
  maxLength
) {
  if (
    typeof value !==
    'string'
  ) {
    return '';
  }

  const text =
    value.trim();

  if (
    text.length <=
    maxLength
  ) {
    return text;
  }

  return (
    text.slice(
      0,
      maxLength
    ) +
    '…'
  );
}

/* =========================================================
   CONVERSATION ID VALIDATION
   ========================================================= */

function sanitizeConversationId(
  value
) {
  if (
    typeof value !==
    'string'
  ) {
    return null;
  }

  const id =
    value.trim();

  if (
    !/^[0-9a-fA-F-]{36}$/.test(
      id
    )
  ) {
    return null;
  }

  return id;
}
