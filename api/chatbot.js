/* =========================================================
   ALPHEX AI — CHATBOT API
   ---------------------------------------------------------
   Vercel Serverless Function
   Responsibilities:
   - Authenticate Supabase users
   - Load profile
   - Load conversation history
   - Load user memories
   - Inject verified Alphex AI knowledge
   - Call Groq
   - Save user + assistant messages
   - Create conversations
   - Recover from stale/invalid conversation IDs
   - Return the response to chatbot.js
   Environment variables required:
   GROQ_API_KEY
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   IMPORTANT:
   Never expose SUPABASE_SERVICE_ROLE_KEY or GROQ_API_KEY
   to the browser.
   ========================================================= */
const {
  createClient
} = require('@supabase/supabase-js');
const {
  getAlphexKnowledgeText,
  getAlphexChatbotRules
} = require('./alphex-knowledge');
/* =========================================================
   CONFIGURATION
   ========================================================= */
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  'https://nxqxhakjbtdzreimpkdz.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY =
  process.env.GROQ_API_KEY;
/*
   Change this model later if you decide to use another
   Groq-supported model.
*/
const GROQ_MODEL =
  process.env.GROQ_MODEL ||
  'openai/gpt-oss-120b';
const MAX_HISTORY_MESSAGES = 30;
const MAX_MEMORY_ITEMS = 12;
const MAX_MESSAGE_LENGTH = 4000;
/* =========================================================
   SUPABASE
   ========================================================= */
let supabaseAdmin = null;
function getSupabaseAdmin() {
  if (supabaseAdmin) {
    return supabaseAdmin;
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured.'
    );
  }
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
  return supabaseAdmin;
}
/* =========================================================
   MAIN HANDLER
   ========================================================= */
module.exports = async function handler(
  req,
  res
) {
  /*
     CORS
     The chatbot is part of the same Alphex website,
     but allowing OPTIONS makes the endpoint easier
     to use if the site architecture changes later.
  */
  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  try {
    validateEnvironment();
    /*
       GET
       ----
       Used by chatbot.js to retrieve a previous
       conversation.
    */
    if (req.method === 'GET') {
      return await handleGetConversation(
        req,
        res
      );
    }
    /*
       POST
       -----
       Used when the visitor sends a message.
    */
    if (req.method !== 'POST') {
      return res.status(405).json({
        error: 'Method not allowed.'
      });
    }
    return await handleChat(
      req,
      res
    );
  } catch (error) {
    console.error(
      '[Alphex Chatbot API]',
      error
    );
    return res.status(500).json({
      error:
        'The Alphex AI Assistant is temporarily unavailable. Please try again.'
    });
  }
};
/* =========================================================
   ENVIRONMENT VALIDATION
   ========================================================= */
function validateEnvironment() {
  if (!GROQ_API_KEY) {
    throw new Error(
      'GROQ_API_KEY is not configured.'
    );
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured.'
    );
  }
}
/* =========================================================
   POST — CHAT
   ========================================================= */
async function handleChat(
  req,
  res
) {
  const body =
    req.body || {};
  const userMessage =
    typeof body.message === 'string'
      ? body.message.trim()
      : '';
  if (!userMessage) {
    return res.status(400).json({
      error:
        'Please enter a message.'
    });
  }
  if (
    userMessage.length >
    MAX_MESSAGE_LENGTH
  ) {
    return res.status(400).json({
      error:
        `Message is too long. Maximum ${MAX_MESSAGE_LENGTH} characters.`
    });
  }
  /*
     Authenticate through Supabase.
     Logged-in users get:
     - profile
     - memories
     - saved conversations
     Anonymous users can still use the general
     conversational assistant.
  */
  const user =
    await authenticateRequest(req);
  let profile = null;
  /*
     Only accept a syntactically valid UUID from
     the browser.
     IMPORTANT:
     A valid UUID does NOT mean the conversation
     belongs to the current user. Ownership is
     verified below.
  */
  let conversationId =
    cleanUUID(
      body.conversation_id
    );
  if (user) {
    profile =
      await getProfile(
        user.id
      );
  }
  /*
     ---------------------------------------------------------
     STALE CONVERSATION RECOVERY
     ---------------------------------------------------------
     If the browser sends a conversation ID, verify that
     the conversation actually exists and belongs to the
     authenticated user.
     If it doesn't, discard the stale ID and create a new
     conversation instead of allowing the request to fail.
  */
  if (
    user &&
    conversationId
  ) {
    const conversationExists =
      await conversationBelongsToUser(
        conversationId,
        user.id
      );
    if (!conversationExists) {
      console.warn(
        '[Alphex Chatbot] Stale or inaccessible conversation ID. Creating a new conversation.'
      );
      conversationId =
        null;
    }
  }
  /*
     If no valid conversation exists, create one
     for authenticated users.
  */
  if (
    user &&
    !conversationId
  ) {
    conversationId =
      await createConversation(
        user.id,
        createConversationTitle(
          userMessage
        )
      );
  }
  /*
     Load previous messages.
  */
  let history = [];
  if (
    user &&
    conversationId
  ) {
    history =
      await getConversationMessages(
        conversationId,
        user.id
      );
  }
  /*
     Load long-term user memory.
  */
  let memories = [];
  if (user) {
    memories =
      await getUserMemories(
        user.id
      );
  }
  /*
     Build the Groq messages.
  */
  const systemPrompt =
    buildSystemPrompt({
      user,
      profile,
      memories,
      pageContext:
        body.page || null
    });
  const groqMessages = [
    {
      role: 'system',
      content: systemPrompt
    },
    ...history.map(
      message => ({
        role:
          message.role,
        content:
          message.content
      })
    ),
    {
      role: 'user',
      content:
        userMessage
    }
  ];
  /*
     Call Groq.
  */
  const assistantMessage =
    await callGroq(
      groqMessages
    );
  /*
     Save conversation.
     Only authenticated users receive
     persistent database conversation history.
  */
  if (
    user &&
    conversationId
  ) {
    await saveMessage(
      conversationId,
      user.id,
      'user',
      userMessage
    );
    await saveMessage(
      conversationId,
      user.id,
      'assistant',
      assistantMessage
    );
    /*
       Update conversation timestamp.
    */
    await updateConversation(
      conversationId,
      user.id
    );
  }
  /*
     Return answer.
     If a stale ID was supplied, this response contains
     the newly created conversation ID so chatbot.js can
     replace the old browser value automatically.
  */
  return res.status(200).json({
    message:
      assistantMessage,
    conversation_id:
      conversationId || null,
    authenticated:
      Boolean(user)
  });
}
/* =========================================================
   GET — PREVIOUS CONVERSATION
   ========================================================= */
async function handleGetConversation(
  req,
  res
) {
  const conversationId =
    cleanUUID(
      req.query?.conversation_id
    );
  /*
     A malformed/stale browser ID should not become
     a fatal chatbot error.
     Return an empty conversation so the frontend can
     gracefully start fresh.
  */
  if (!conversationId) {
    return res.status(200).json({
      conversation_id: null,
      messages: [],
      recovered: true
    });
  }
  const user =
    await authenticateRequest(req);
  if (!user) {
    return res.status(401).json({
      error:
        'Authentication required.'
    });
  }
  /*
     Verify ownership before loading messages.
  */
  const conversationExists =
    await conversationBelongsToUser(
      conversationId,
      user.id
    );
  if (!conversationExists) {
    console.warn(
      '[Alphex Chatbot] Requested conversation no longer exists or is not owned by the user.'
    );
    return res.status(200).json({
      conversation_id: null,
      messages: [],
      recovered: true
    });
  }
  const messages =
    await getConversationMessages(
      conversationId,
      user.id
    );
  return res.status(200).json({
    conversation_id:
      conversationId,
    messages
  });
}
/* =========================================================
   AUTHENTICATION
   ========================================================= */
async function authenticateRequest(req) {
  const authorization =
    req.headers.authorization ||
    '';
  if (
    !authorization.startsWith(
      'Bearer '
    )
  ) {
    /*
       Anonymous visitor.
       This is intentionally allowed for general
       chatbot questions.
    */
    return null;
  }
  const accessToken =
    authorization.substring(
      7
    ).trim();
  if (!accessToken) {
    return null;
  }
  const supabase =
    getSupabaseAdmin();
  const {
    data,
    error
  } =
    await supabase.auth.getUser(
      accessToken
    );
  if (error) {
    console.warn(
      '[Alphex Chatbot] Invalid Supabase session:',
      error.message
    );
    return null;
  }
  return data?.user || null;
}
/* =========================================================
   PROFILE
   ========================================================= */
async function getProfile(
  userId
) {
  const supabase =
    getSupabaseAdmin();
  const {
    data,
    error
  } =
    await supabase
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
      error.message
    );
    return null;
  }
  return data || null;
}
/* =========================================================
   CONVERSATIONS
   ========================================================= */
/*
   Verify conversation ownership.
   This is intentionally separate from
   getConversationMessages() so the POST and GET
   recovery logic can cheaply determine whether
   a conversation is still valid.
*/
async function conversationBelongsToUser(
  conversationId,
  userId
) {
  if (
    !conversationId ||
    !userId
  ) {
    return false;
  }
  const supabase =
    getSupabaseAdmin();
  const {
    data,
    error
  } =
    await supabase
      .from('conversations')
      .select('id')
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
      error.message
    );
    return false;
  }
  return Boolean(data);
}
async function createConversation(
  userId,
  title
) {
  const supabase =
    getSupabaseAdmin();
  const {
    data,
    error
  } =
    await supabase
      .from('conversations')
      .insert({
        user_id:
          userId,
        title:
          title,
        summary:
          null
      })
      .select('id')
      .single();
  if (error) {
    throw new Error(
      `Conversation creation failed: ${error.message}`
    );
  }
  return data.id;
}
async function getConversationMessages(
  conversationId,
  userId
) {
  const supabase =
    getSupabaseAdmin();
  /*
     Because the service role key bypasses RLS,
     explicitly restrict the conversation to the
     authenticated user.
  */
  const {
    data: conversation,
    error: conversationError
  } =
    await supabase
      .from('conversations')
      .select('id,user_id')
      .eq(
        'id',
        conversationId
      )
      .eq(
        'user_id',
        userId
      )
      .maybeSingle();
  if (
    conversationError ||
    !conversation
  ) {
    return [];
  }
  const {
    data,
    error
  } =
    await supabase
      .from('messages')
      .select(
        'id,role,content,created_at'
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
          ascending: true
        }
      )
      .limit(
        MAX_HISTORY_MESSAGES
      );
  if (error) {
    console.warn(
      '[Alphex Chatbot] Message history lookup failed:',
      error.message
    );
    return [];
  }
  return data || [];
}
async function updateConversation(
  conversationId,
  userId
) {
  const supabase =
    getSupabaseAdmin();
  const {
    error
  } =
    await supabase
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
  if (error) {
    console.warn(
      '[Alphex Chatbot] Conversation update failed:',
      error.message
    );
  }
}
/* =========================================================
   MESSAGES
   ========================================================= */
async function saveMessage(
  conversationId,
  userId,
  role,
  content
) {
  const supabase =
    getSupabaseAdmin();
  const {
    error
  } =
    await supabase
      .from('messages')
      .insert({
        conversation_id:
          conversationId,
        user_id:
          userId,
        role:
          role,
        content:
          content
      });
  if (error) {
    throw new Error(
      `Message save failed: ${error.message}`
    );
  }
}
/* =========================================================
   USER MEMORY
   ========================================================= */
async function getUserMemories(
  userId
) {
  const supabase =
    getSupabaseAdmin();
  const {
    data,
    error
  } =
    await supabase
      .from('user_memories')
      .select(
        'memory,memory_type,importance'
      )
      .eq(
        'user_id',
        userId
      )
      .order(
        'importance',
        {
          ascending: false
        }
      )
      .order(
        'updated_at',
        {
          ascending: false
        }
      )
      .limit(
        MAX_MEMORY_ITEMS
      );
  if (error) {
    console.warn(
      '[Alphex Chatbot] Memory lookup failed:',
      error.message
    );
    return [];
  }
  return data || [];
}
/* =========================================================
   SYSTEM PROMPT
   ========================================================= */
function buildSystemPrompt({
  user,
  profile,
  memories,
  pageContext
}) {
  const knowledge =
    getAlphexKnowledgeText();
  const rules =
    getAlphexChatbotRules()
      .map(
        rule => `- ${rule}`
      )
      .join('\n');
  const userIdentity =
    user
      ? `
Authenticated user:
- User ID: ${user.id}
- Email: ${user.email || 'not available'}
`
      : `
Visitor:
- Not authenticated
- Do not assume a name or identity.
`;
  const profileContext =
    profile
      ? `
Verified profile information:
- Name: ${profile.full_name || 'not provided'}
- Company: ${profile.company || 'not provided'}
- Role: ${profile.role || 'not provided'}
`
      : `
No verified profile information is available.
`;
  const memoryContext =
    memories.length > 0
      ? `
Verified long-term memories:
${memories
  .map(
    memory =>
      `- [${memory.memory_type}] ${memory.memory}`
  )
  .join('\n')}
`
      : `
No long-term memories are currently available.
`;
  const pageInformation =
    pageContext
      ? `
Current website context:
- Page title: ${pageContext.title || 'unknown'}
- Page URL: ${pageContext.url || 'unknown'}
- Page path: ${pageContext.path || 'unknown'}
Use this only as navigation/context information.
Do not treat page metadata as authoritative company facts.
`
      : '';
  return `
You are the official conversational AI assistant for Alphex AI.
=========================================================
PRIMARY ROLE
=========================================================
Your job is to help visitors and customers understand
Alphex AI accurately and naturally.
You also have general LLM capabilities.
You must be able to handle both:
1. Questions about Alphex AI
2. General questions outside Alphex AI
=========================================================
ALPHEX AI KNOWLEDGE
=========================================================
The following is verified company/product context.
Use it as the source of truth for Alphex AI-specific
questions:
${knowledge}
=========================================================
ALPHEX AI RULES
=========================================================
${rules}
=========================================================
USER CONTEXT
=========================================================
${userIdentity}
${profileContext}
${memoryContext}
${pageInformation}
=========================================================
MEMORY RULE
=========================================================
You may say that you remember something ONLY when that
information appears in the verified user context or
conversation history provided to you.
Never pretend to remember something that was not supplied.
Never invent a previous conversation.
=========================================================
GENERAL LLM MODE
=========================================================
If the user asks something unrelated to Alphex AI, you may
answer it normally using your language-model capabilities.
For example:
- General AI concepts
- Programming questions
- Writing help
- Explanations
- Technical concepts
- Business concepts
- General knowledge
Do not artificially connect unrelated questions to Alphex AI.
=========================================================
MIXED QUESTIONS
=========================================================
If the question contains both a general concept and an
Alphex AI question, answer both parts.
Example:
"What is LLM evaluation and how does Alphex AI approach it?"
Explain the general concept and then explain Alphex AI
using only verified company information.
=========================================================
UNKNOWN INFORMATION
=========================================================
If an Alphex AI-specific detail is not present in the
provided knowledge:
DO NOT GUESS.
Say that the specific information is not currently available
and, when appropriate, guide the visitor toward the official
Alphex AI contact channel.
=========================================================
BUSINESS QUESTIONS
=========================================================
When someone expresses genuine business interest:
1. Understand their requirement.
2. Explain the relevant Alphex AI capability.
3. Do not promise pricing, delivery dates, SLAs, contracts,
   integrations, or implementation details unless verified.
4. Encourage them to contact Alphex AI when a human/business
   discussion is appropriate.
=========================================================
STYLE
=========================================================
Be:
- Clear
- Professional
- Helpful
- Natural
- Concise when possible
- Detailed when useful
Do not sound like a generic customer-support script.
Do not repeatedly say "As an AI".
Do not unnecessarily repeat the user's question.
Do not use excessive corporate jargon.
=========================================================
IMPORTANT
=========================================================
Alphex AI-specific claims must come from verified context.
General knowledge can come from the LLM.
Never confuse general LLM knowledge with official
Alphex AI information.
`;
}
/* =========================================================
   GROQ
   ========================================================= */
async function callGroq(
  messages
) {
  const response =
    await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization':
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
              0.25,
            max_tokens:
              1800,
            stream:
              false
          })
      }
    );
  if (!response.ok) {
    const errorText =
      await response.text();
    console.error(
      '[Groq API Error]',
      errorText
    );
    throw new Error(
      'Groq request failed.'
    );
  }
  const data =
    await response.json();
  const content =
    data?.choices?.[0]?.message?.content;
  if (
    typeof content !== 'string' ||
    !content.trim()
  ) {
    throw new Error(
      'Groq returned an empty response.'
    );
  }
  return content.trim();
}
/* =========================================================
   UTILITIES
   ========================================================= */
function cleanUUID(
  value
) {
  if (
    typeof value !== 'string'
  ) {
    return null;
  }
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value)
    ? value
    : null;
}
function createConversationTitle(
  message
) {
  const cleaned =
    message
      .replace(/\s+/g, ' ')
      .trim();
  if (!cleaned) {
    return 'New conversation';
  }
  if (
    cleaned.length <= 60
  ) {
    return cleaned;
  }
  return (
    cleaned.substring(
      0,
      57
    ) +
    '...'
  );
}
