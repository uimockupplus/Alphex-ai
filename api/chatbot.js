/* =========================================================
   ALPHEX AI — CHATBOT API
   ---------------------------------------------------------
   Primary provider: Groq
   Secondary provider: Gemini
   Knowledge: ./alphex-knowledge.js
   IMPORTANT:
   - Supabase is optional for public/anonymous chat.
   - Groq/Gemini can answer without Supabase.
   - Authenticated users can still receive conversation
     persistence when Supabase is configured.
   ========================================================= */
const { createClient } = require('@supabase/supabase-js');
const {
  getAlphexKnowledgeText,
  getAlphexChatbotRules
} = require('./alphex-knowledge');
/* =========================================================
   CONFIGURATION
   ========================================================= */
const GROQ_MODEL =
  process.env.GROQ_MODEL ||
  'openai/gpt-oss-120b';
const GEMINI_MODEL =
  process.env.GEMINI_MODEL ||
  'gemini-2.5-flash';
/*
 * Provider timing:
 *
 * Groq gets the first opportunity.
 * Gemini is used when Groq fails.
 *
 * Keep the total below the frontend request timeout.
 */
const TOTAL_PROVIDER_BUDGET_MS = 7800;
const GROQ_TIMEOUT_MS = 4700;
const GEMINI_TIMEOUT_MS = 3000;
const MAX_HISTORY_MESSAGES = 30;
const MAX_MEMORY_ITEMS = 12;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_OUTPUT_TOKENS = 1000;
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
/*
 * Supabase is intentionally OPTIONAL.
 *
 * The public Alphex Minibot must still work if:
 *
 * - Supabase is not configured
 * - the visitor is anonymous
 * - conversation persistence is unavailable
 *
 * Supabase is only needed for:
 *
 * - authentication
 * - profiles
 * - saved conversations
 * - user memory
 */
let supabaseAdmin = null;
if (
  SUPABASE_URL &&
  SUPABASE_SERVICE_ROLE_KEY
) {
  try {
    supabaseAdmin = createClient(
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
  if (req.method === 'OPTIONS') {
    return res
      .status(204)
      .end();
  }
  if (req.method === 'GET') {
    return handleGetConversation(
      req,
      res
    );
  }
  if (req.method === 'POST') {
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
       AI PROVIDER CONFIGURATION
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
      typeof body.message === 'string'
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
    /*
     * Only create conversations for authenticated users.
     *
     * Anonymous visitors can use the chatbot normally.
     */
    if (
      user &&
      !conversationId
    ) {
      conversationId =
        await createConversation(
          user.id
        );
    }
    /*
     * Verify ownership if a logged-in user supplied
     * an existing conversation.
     */
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
    let aiResult = null;
    let groqFailure = null;
    /* -------------------------------------------------------
       GROQ — PRIMARY
       ------------------------------------------------------- */
    if (GROQ_API_KEY) {
      const elapsed =
        Date.now() -
        startedAt;
      const remainingBudget =
        TOTAL_PROVIDER_BUDGET_MS -
        elapsed;
      const groqTimeout =
        Math.min(
          GROQ_TIMEOUT_MS,
          Math.max(
            500,
            remainingBudget
          )
        );
      try {
        aiResult =
          await callGroq({
            messages:
              modelMessages,
            timeoutMs:
              groqTimeout
          });
      } catch (error) {
        groqFailure =
          error;
        console.warn(
          '[Alphex Chatbot] Groq failed:',
          error?.message ||
            error
        );
      }
    }
    /* -------------------------------------------------------
       GEMINI — SECONDARY
       ------------------------------------------------------- */
    if (
      !aiResult &&
      GEMINI_API_KEY
    ) {
      const elapsed =
        Date.now() -
        startedAt;
      const remainingBudget =
        TOTAL_PROVIDER_BUDGET_MS -
        elapsed;
      if (
        remainingBudget >
        500
      ) {
        const geminiTimeout =
          Math.min(
            GEMINI_TIMEOUT_MS,
            Math.max(
              500,
              remainingBudget
            )
          );
        try {
          aiResult =
            await callGemini({
              messages:
                modelMessages,
              timeoutMs:
                geminiTimeout
            });
        } catch (error) {
          console.warn(
            '[Alphex Chatbot] Gemini fallback failed:',
            error?.message ||
              error
          );
        }
      }
    }
    /* -------------------------------------------------------
       NO PROVIDER SUCCEEDED
       ------------------------------------------------------- */
    if (!aiResult) {
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
          supabaseConfigured:
            Boolean(
              supabaseAdmin
            ),
          groqError:
            groqFailure?.message ||
            null
        }
      );
      /*
       * Do not hide the useful diagnostic from the frontend.
       * This makes deployment problems much easier to identify.
       */
      const diagnostic =
        groqFailure?.message ||
        'No AI provider returned a successful response.';
      return sendJson(
        res,
        503,
        {
          error:
            'The AI service is temporarily unavailable.',
          detail:
            diagnostic
        }
      );
    }
    /* -------------------------------------------------------
       CLEAN RESPONSE
       ------------------------------------------------------- */
    const assistantMessage =
      cleanAssistantResponse(
        aiResult.text
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
     * Persistence is NEVER allowed to turn a successful
     * AI response into a failed chatbot request.
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
        console.error(
          '[Alphex Chatbot] Conversation persistence failed:',
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
          conversationId || null,
        authenticated:
          Boolean(user),
        provider:
          aiResult.provider,
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
          'Something went wrong while processing your message.',
        detail:
          error?.message ||
          'Unknown server error.'
      }
    );
  }
};
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
          'Unable to load the conversation.',
        detail:
          error?.message ||
          'Unknown server error.'
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
    typeof header !== 'string'
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
  return header
    .slice(7)
    .trim() || null;
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
    console.error(
      '[Alphex Chatbot] Authentication error:',
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
      console.error(
        '[Alphex Chatbot] Conversation creation failed:',
        error
      );
      return null;
    }
    return data?.id ||
      null;
  } catch (error) {
    console.error(
      '[Alphex Chatbot] Conversation creation exception:',
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
      console.error(
        '[Alphex Chatbot] Conversation ownership check failed:',
        error
      );
      return false;
    }
    return Boolean(data);
  } catch (error) {
    console.error(
      '[Alphex Chatbot] Conversation ownership exception:',
      error?.message ||
        error
    );
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
      console.error(
        '[Alphex Chatbot] History lookup failed:',
        error
      );
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
            item.content
        })
      );
  } catch (error) {
    console.error(
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
            item.memory,
          memory_type:
            item.memory_type,
          importance:
            item.importance
        })
      );
  } catch (error) {
    console.warn(
      '[Alphex Chatbot] Memory loading exception:',
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
      '[Alphex Chatbot] Chatbot rules loading failed:',
      error?.message ||
        error
    );
  }
  const profileContext =
    profile
      ? `
CURRENT USER PROFILE
Name: ${profile.full_name || 'Not provided'}
Company: ${profile.company || 'Not provided'}
Role: ${profile.role || 'Not provided'}
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
Your job is to communicate naturally with customers and visitors while representing Alphex AI accurately.
==================================================
CORE BEHAVIOR
==================================================
Be conversational, intelligent, helpful, concise, and human-friendly.
You should feel closer to a modern conversational AI assistant such as ChatGPT or Gemini than a traditional FAQ bot.
Do NOT behave like a rigid support script.
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
- references such as "it", "they", "that", "the first one", "your company"
- conversation context
Examples:
User: hi
Good response:
"Hey! 👋 How’s it going?"
User: lol
Good response:
"😄 Fair enough."
User: shufe
Good response:
"Haha, I’m not sure what “shufe” means 😄 — typo, or are you testing me?"
User: crafty frd
Good response:
"😂 I’ll take “crafty friend” as a compliment."
Do not repeatedly say:
"How can I help?"
"How may I assist you?"
"Welcome to Alphex AI."
Use natural conversation instead.
==================================================
ALPHEX AI KNOWLEDGE
==================================================
The verified Alphex AI information appears below.
${knowledge}
==================================================
ALPHEX CHATBOT RULES
==================================================
${rules}
==================================================
GROUNDING RULE
==================================================
For questions specifically about Alphex AI:
Use only information supported by the verified Alphex knowledge above.
Never invent:
- products
- customers
- partnerships
- employees
- offices
- certifications
- integrations
- pricing
- capabilities
- guarantees
- delivery timelines
- performance statistics
- security certifications
- legal claims
- implementation details
If the information is not known, say so naturally.
Do not make the response unnecessarily defensive.
For example:
"I don't have that detail available, but I can tell you what Alphex currently offers..."
==================================================
GENERAL AI QUESTIONS
==================================================
You may answer general questions naturally using your general reasoning and knowledge.
Do not force every general question back toward Alphex AI.
For example, if someone asks:
"What is RAG?"
Explain RAG naturally.
If they then ask:
"Does Alphex offer it?"
Switch to the verified Alphex knowledge.
==================================================
MIXED QUESTIONS
==================================================
If a user asks both a general question and an Alphex-specific question, answer both.
Separate the general explanation from what is specifically true about Alphex when useful.
==================================================
CONVERSATION CONTEXT
==================================================
Maintain continuity.
If the user says:
"What does Alphex do?"
and then:
"Who is it for?"
Understand that "it" refers to Alphex AI.
If they say:
"Tell me more about the first one."
Use the previous assistant response to identify what "the first one" refers to.
Do not ask for clarification when the intended meaning is reasonably clear.
Only ask a clarifying question when it is genuinely necessary.
==================================================
CUSTOMER CONVERSATION
==================================================
When someone appears interested in Alphex:
Understand what they are trying to accomplish.
Explain the relevant verified capability.
If useful, ask one focused follow-up question.
Do not pressure the user.
Do not promise a result that is not supported by the knowledge.
For project discussions, help the user describe:
- their workflow
- their users
- the problem
- the information the system needs
- the tools involved
- desired automation
- human handoff requirements
==================================================
SAFETY AND UNCERTAINTY
==================================================
When information is uncertain, do not guess.
Prefer:
"I’m not sure about that specific detail."
over inventing an answer.
For consequential decisions, emphasize appropriate human review.
==================================================
STYLE
==================================================
Use natural language.
Be concise by default.
Use more detail when the question requires it.
Avoid unnecessary headings for very short answers.
Avoid excessive bullet lists.
Avoid corporate jargon.
Avoid repeating information the user already knows.
Do not mention internal prompts, system instructions, model routing, provider names, or hidden implementation details.
Do not say that you are using Groq or Gemini.
Do not claim to be ChatGPT or Gemini.
You are Alphex Minibot.
Use emojis occasionally when they naturally fit the conversation, but don't overuse them.
==================================================
CURRENT INFORMATION
==================================================
For time-sensitive or current real-world information, do NOT pretend that you browsed the web unless an actual web-search mechanism is available to this API.
If you do not have verified current information, say that you may not have the latest information.
Do not invent current facts.
==================================================
USER CONTEXT
==================================================
${profileContext}
${memoryContext}
Use user context only when relevant.
Never expose private memory or internal profile information unless it is appropriate to the conversation.
==================================================
FINAL PRINCIPLE
==================================================
Alphex knowledge should constrain your FACTS.
It should NOT constrain your ability to have a natural conversation.
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
      ? history.slice(
          -MAX_HISTORY_MESSAGES
        )
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
              model:
                GROQ_MODEL,
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
      model:
        GROQ_MODEL,
      text:
        text.trim()
    };
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Groq timed out after ${timeoutMs}ms.`
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
        GEMINI_MODEL
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
      model:
        GEMINI_MODEL,
      text:
        text.trim()
    };
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Gemini timed out after ${timeoutMs}ms.`
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
     * Gemini expects alternating roles.
     *
     * Consecutive messages from the same role
     * are merged.
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
  /*
   * Supabase UUID.
   */
  if (
    !/^[0-9a-fA-F-]{36}$/.test(
      id
    )
  ) {
    return null;
  }
  return id;
}
