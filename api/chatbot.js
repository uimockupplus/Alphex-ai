/**
 * =========================================================
 * ALPHEX AI — CHATBOT API
 * Deterministic knowledge routing + multi-model AI fallback
 * =========================================================
 *
 * Providers:
 *   1. Groq
 *      - OpenAI GPT-OSS 120B
 *      - OpenAI GPT-OSS 20B
 *      - Qwen 3.8 27B
 *
 *   2. Gemini
 *      - Gemini 3.7 Flash
 *      - Gemini 3.6 Flash
 *
 * Important:
 *   - Alphex facts come from ./alphex-knowledge.js
 *   - High-confidence business questions are routed through
 *     deterministic knowledge handlers first.
 *   - LLMs handle conversational/general AI questions.
 *   - Provider failures are hidden from the user.
 *   - Supabase persistence failures never break a successful
 *     AI response.
 */

import {
  getAlphexKnowledge,
  getAlphexKnowledgeText,
  getAlphexChatbotRules
} from './alphex-knowledge.js';

/* =========================================================
   CONFIGURATION
   ========================================================= */

const DEFAULT_GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b'
];

const DEFAULT_GEMINI_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash'
];

const TOTAL_PROVIDER_BUDGET_MS = 7800;

const GROQ_TIMEOUT_MS = 2200;
const GEMINI_TIMEOUT_MS = 2200;

const MAX_HISTORY_MESSAGES = 8;
const MAX_MEMORY_ITEMS = 6;

const MAX_MESSAGE_LENGTH = 4000;

const MAX_OUTPUT_TOKENS = 650;

const TEMPERATURE = 0.55;

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  '';

const GROQ_API_KEY =
  process.env.GROQ_API_KEY ||
  '';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  '';

const configuredGroqModels = parseModelList(
  process.env.GROQ_MODELS
);

const configuredGeminiModels = parseModelList(
  process.env.GEMINI_MODELS
);

const GROQ_MODELS =
  configuredGroqModels.length > 0
    ? configuredGroqModels
    : process.env.GROQ_MODEL
      ? [process.env.GROQ_MODEL, ...DEFAULT_GROQ_MODELS]
          .filter((model, index, arr) => arr.indexOf(model) === index)
      : DEFAULT_GROQ_MODELS;

const GEMINI_MODELS =
  configuredGeminiModels.length > 0
    ? configuredGeminiModels
    : process.env.GEMINI_MODEL
      ? [process.env.GEMINI_MODEL, ...DEFAULT_GEMINI_MODELS]
          .filter((model, index, arr) => arr.indexOf(model) === index)
      : DEFAULT_GEMINI_MODELS;


/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(req, res) {
  const requestStartedAt = Date.now();

  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {
    const body = req.body || {};

    const message = normalizeMessage(body.message);

    if (!message) {
      return res.status(400).json({
        error: 'Message is required.'
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`
      });
    }

    const conversationId =
      typeof body.conversation_id === 'string'
        ? body.conversation_id.trim()
        : null;

    const page =
      typeof body.page === 'string'
        ? body.page.trim().slice(0, 500)
        : '';

    const authorization =
      typeof req.headers.authorization === 'string'
        ? req.headers.authorization
        : '';

    const accessToken = extractBearerToken(authorization);

    const knowledge = getAlphexKnowledge();

    /* -------------------------------------------------------
       Authentication / user context
       ------------------------------------------------------- */

    let currentUser = null;
    let currentProfile = null;

    if (accessToken && isSupabaseConfigured()) {
      try {
        currentUser = await getSupabaseUser(accessToken);

        if (currentUser?.id) {
          currentProfile = await getSupabaseProfile(
            currentUser.id
          );
        }
      } catch (error) {
        console.warn(
          '[Alphex Chatbot] User context lookup failed:',
          safeError(error)
        );
      }
    }

    /* -------------------------------------------------------
       Load conversation history
       ------------------------------------------------------- */

    let history = [];

    if (
      conversationId &&
      currentUser?.id &&
      isSupabaseConfigured()
    ) {
      try {
        history = await loadConversationHistory(
          conversationId,
          currentUser.id
        );
      } catch (error) {
        /*
         * Missing conversation_messages table is deliberately
         * treated as non-fatal.
         */
        console.warn(
          '[Alphex Chatbot] History lookup failed:',
          safeError(error)
        );
      }
    }

    /* -------------------------------------------------------
       Deterministic Alphex knowledge routing
       ------------------------------------------------------- */

    const deterministicAnswer =
      getDeterministicKnowledgeAnswer(
        message,
        knowledge
      );

    if (deterministicAnswer) {
      const responseText = deterministicAnswer.answer;

      /*
       * Save the interaction if persistence is available.
       * Failure here must never prevent the answer.
       */
      if (
        conversationId &&
        currentUser?.id &&
        isSupabaseConfigured()
      ) {
        try {
          await saveConversationMessages({
            conversationId,
            userId: currentUser.id,
            userMessage: message,
            assistantMessage: responseText
          });
        } catch (error) {
          console.warn(
            '[Alphex Chatbot] Deterministic response persistence failed:',
            safeError(error)
          );
        }
      }

      return res.status(200).json({
        success: true,
        answer: responseText,
        provider: 'alphex-knowledge',
        model: deterministicAnswer.route,
        deterministic: true,
        conversation_id: conversationId || null,
        elapsed_ms: Date.now() - requestStartedAt
      });
    }

    /* -------------------------------------------------------
       Build LLM prompt
       ------------------------------------------------------- */

    const systemPrompt = buildSystemPrompt({
      knowledgeText: getAlphexKnowledgeText(),
      chatbotRules: getAlphexChatbotRules(),
      currentProfile,
      page
    });

    const compactHistory = normalizeHistory(history);

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      },
      ...compactHistory,
      {
        role: 'user',
        content: message
      }
    ];

    /* -------------------------------------------------------
       Multi-provider AI generation
       ------------------------------------------------------- */

    const aiResult = await generateWithProviderPool(
      messages
    );

    if (!aiResult?.answer) {
      console.error(
        '[Alphex Chatbot] All AI providers failed.',
        {
          elapsed: Date.now() - requestStartedAt,
          groqConfigured: Boolean(GROQ_API_KEY),
          geminiConfigured: Boolean(GEMINI_API_KEY),
          supabaseConfigured: isSupabaseConfigured()
        }
      );

      return res.status(503).json({
        error:
          'The AI service is temporarily unavailable.'
      });
    }

    const responseText = cleanAssistantResponse(
      aiResult.answer
    );

    /* -------------------------------------------------------
       Persist successful conversation
       ------------------------------------------------------- */

    if (
      conversationId &&
      currentUser?.id &&
      isSupabaseConfigured()
    ) {
      try {
        await saveConversationMessages({
          conversationId,
          userId: currentUser.id,
          userMessage: message,
          assistantMessage: responseText
        });
      } catch (error) {
        console.warn(
          '[Alphex Chatbot] Message persistence failed:',
          safeError(error)
        );
      }
    }

    /* -------------------------------------------------------
       Final response
       ------------------------------------------------------- */

    return res.status(200).json({
      success: true,
      answer: responseText,
      provider: aiResult.provider,
      model: aiResult.model,
      deterministic: false,
      conversation_id: conversationId || null,
      elapsed_ms: Date.now() - requestStartedAt
    });

  } catch (error) {
    console.error(
      '[Alphex Chatbot] Unexpected error:',
      safeError(error)
    );

    return res.status(500).json({
      error:
        'I’m sorry, I couldn’t complete that request right now.'
    });
  }
}


/* =========================================================
   DETERMINISTIC KNOWLEDGE ROUTING
   ========================================================= */

/**
 * This is the important new layer.
 *
 * It prevents the LLM from inventing or forgetting core
 * Alphex business facts.
 *
 * The answer is generated from the verified knowledge object.
 */

function getDeterministicKnowledgeAnswer(
  message,
  knowledge
) {
  const text = normalizeForIntent(message);

  /* -------------------------------------------------------
     PRICING
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'pricing',
      'price',
      'prices',
      'cost',
      'costs',
      'how much',
      'how much does',
      'how much is',
      'plans',
      'plan price',
      'pricing plans',
      'what do you charge',
      'what are your charges',
      'setup price',
      'setup cost'
    ])
  ) {
    return {
      route: 'pricing',
      answer: buildPricingAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     NEGOTIATION / DISCOUNTS
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'negotiation',
      'negotiate',
      'can you negotiate',
      'can i negotiate',
      'negotiable',
      'is it negotiable',
      'discount',
      'discounts',
      'lower price',
      'cheaper',
      'reduce the price',
      'reduce pricing',
      'flexible pricing',
      'flexible price'
    ])
  ) {
    return {
      route: 'pricing-boundary',
      answer: buildNegotiationAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     WHAT DOES ALPHEX DO?
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'what does alphex do',
      'what does alphex ai do',
      'what is alphex',
      'what is alphex ai',
      'tell me about alphex',
      'tell me about alphex ai',
      'about alphex',
      'about alphex ai',
      'alphex ai company',
      'what kind of company is alphex',
      'what services does alphex offer',
      'what services does alphex ai offer'
    ])
  ) {
    return {
      route: 'company-overview',
      answer: buildCompanyOverviewAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     SOLUTIONS / CAPABILITIES
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'what can alphex build',
      'what can alphex ai build',
      'what solutions do you provide',
      'what solutions does alphex provide',
      'what services do you provide',
      'what can you build',
      'what can you help with',
      'alphex capabilities',
      'alphex solutions',
      'your capabilities',
      'your services'
    ])
  ) {
    return {
      route: 'solutions',
      answer: buildSolutionsAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     PRODUCTS
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'what products do you have',
      'what are your products',
      'alphex products',
      'products',
      'list your products',
      'show me your products',
      'what product does alphex have',
      'what products does alphex ai have'
    ])
  ) {
    return {
      route: 'products',
      answer: buildProductsAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     EVALLOOP AI
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'what is evalloop ai',
      'what is eval loop ai',
      'tell me about evalloop ai',
      'tell me about eval loop ai',
      'what does evalloop ai do',
      'what does eval loop ai do',
      'evalloop ai',
      'eval loop ai'
    ])
  ) {
    return {
      route: 'evalloop-ai',
      answer: buildEvalLoopAIAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     EVALLOOP JOBS
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'what is evalloop jobs',
      'what is eval loop jobs',
      'tell me about evalloop jobs',
      'tell me about eval loop jobs',
      'what does evalloop jobs do',
      'evalloop jobs',
      'eval loop jobs'
    ])
  ) {
    return {
      route: 'evalloop-jobs',
      answer: buildEvalLoopJobsAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     LOCATION
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'where is alphex',
      'where is alphex ai',
      'where are you based',
      'where is your company based',
      'alphex location',
      'alphex ai location',
      'where is alphex located',
      'which city is alphex in'
    ])
  ) {
    return {
      route: 'location',
      answer: buildLocationAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     INDUSTRIES
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'what industries do you serve',
      'which industries do you serve',
      'industries',
      'who do you work with',
      'who is alphex for',
      'who is alphex ai for',
      'what businesses can use alphex',
      'what businesses do you help'
    ])
  ) {
    return {
      route: 'industries',
      answer: buildIndustriesAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     PROCESS
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'how do you work',
      'how does alphex work',
      'what is your process',
      'alphex process',
      'project process',
      'how do projects work',
      'how do you build ai systems'
    ])
  ) {
    return {
      route: 'process',
      answer: buildProcessAnswer(knowledge)
    };
  }

  /* -------------------------------------------------------
     HUMAN HANDOFF / CHATBOTS
     ------------------------------------------------------- */

  if (
    matchesAny(text, [
      'do your chatbots have human handoff',
      'human handoff',
      'can a human take over',
      'can humans take over',
      'do you support human handoff',
      'chatbot handoff'
    ])
  ) {
    return {
      route: 'human-handoff',
      answer: buildHumanHandoffAnswer(knowledge)
    };
  }

  return null;
}


/* =========================================================
   DETERMINISTIC ANSWER BUILDERS
   ========================================================= */

function buildPricingAnswer(knowledge) {
  const pricing =
    knowledge?.pricing ||
    {};

  const plans =
    Array.isArray(pricing.plans)
      ? pricing.plans
      : [];

  if (plans.length === 0) {
    return (
      'Alphex AI currently presents starting prices for its main chatbot offerings, ' +
      'but I don’t have the detailed pricing structure available right now. ' +
      'For a project-specific quote, please contact Alphex AI.'
    );
  }

  const lines = [
    '**Alphex AI pricing:**',
    ''
  ];

  for (const plan of plans) {
    const name =
      plan.name ||
      plan.title ||
      'Plan';

    const description =
      plan.description ||
      '';

    const price =
      plan.price ||
      plan.amount ||
      '';

    lines.push(
      `**${name}** — ${price}${description ? ` — ${description}` : ''}`
    );
  }

  if (pricing.boundary) {
    lines.push('');
    lines.push(pricing.boundary);
  }

  return lines.join('\n');
}


function buildNegotiationAnswer(knowledge) {
  const pricing =
    knowledge?.pricing ||
    {};

  const boundary =
    pricing.boundary ||
    'Final pricing depends on project scope and requirements.';

  return [
    'The prices shown by Alphex AI are **starting prices**, so the final project price can depend on the scope and requirements.',
    '',
    boundary,
    '',
    'If you tell me what you want to build, I can help you understand which pricing tier is the closest fit.'
  ].join('\n');
}


function buildCompanyOverviewAnswer(knowledge) {
  const company =
    knowledge?.company ||
    {};

  const name =
    company.name ||
    'Alphex AI';

  const description =
    company.description ||
    company.positioning ||
    '';

  const model =
    company.business_model ||
    '';

  return [
    `**${name}** is ${description}`,
    model ? `\nIts primary business model is ${model}.` : ''
  ]
    .filter(Boolean)
    .join('\n');
}


function buildSolutionsAnswer(knowledge) {
  const solutions =
    knowledge?.solutions ||
    {};

  const items =
    extractStringArray(solutions);

  if (items.length === 0) {
    return 'Alphex AI builds client-focused AI solutions tailored to business requirements.';
  }

  return [
    '**Alphex AI builds:**',
    '',
    ...items.map(item => `- ${item}`)
  ].join('\n');
}


function buildProductsAnswer(knowledge) {
  const products =
    knowledge?.products ||
    {};

  const entries = Object.entries(products)
    .filter(([key, value]) => {
      return (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !/boundary/i.test(key)
      );
    });

  if (entries.length === 0) {
    return 'Alphex AI currently builds products including EvalLoop AI and EvalLoop Jobs.';
  }

  const lines = [
    '**Alphex AI products:**',
    ''
  ];

  for (const [, product] of entries) {
    const name =
      product.name ||
      product.title ||
      '';

    const description =
      product.description ||
      product.positioning ||
      '';

    if (name) {
      lines.push(
        `**${name}**${description ? ` — ${description}` : ''}`
      );
    }
  }

  return lines.join('\n');
}


function buildEvalLoopAIAnswer(knowledge) {
  const products =
    knowledge?.products ||
    {};

  const product =
    findObjectByName(
      products,
      [
        'EvalLoop AI',
        'EL·AI',
        'EL-AI'
      ]
    );

  if (!product) {
    return (
      '**EvalLoop AI** is Alphex AI’s AI evaluation and quality platform, ' +
      'designed to evaluate AI responses, models, multimodal outputs, safety, grounding, and overall AI quality.'
    );
  }

  const name =
    product.name ||
    'EvalLoop AI';

  const description =
    product.description ||
    product.positioning ||
    '';

  const tags =
    extractStringArray(
      product.tags ||
      product.capabilities ||
      []
    );

  return [
    `**${name}** is ${description}`,
    tags.length
      ? `\nKey areas include ${joinNatural(tags)}.`
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}


function buildEvalLoopJobsAnswer(knowledge) {
  const products =
    knowledge?.products ||
    {};

  const product =
    findObjectByName(
      products,
      [
        'EvalLoop Jobs',
        'EL·J',
        'EL-J'
      ]
    );

  if (!product) {
    return (
      '**EvalLoop Jobs** is an independent AI opportunity discovery platform for ' +
      'AI evaluation, LLM, data annotation, AI training, GenAI, prompt engineering, and related opportunities.'
    );
  }

  const name =
    product.name ||
    'EvalLoop Jobs';

  const description =
    product.description ||
    product.positioning ||
    '';

  return [
    `**${name}** is ${description}`,
    '',
    'It is an independent curated directory, not an employer. Applications are made through the original hiring company, platform, provider, or contributor network.'
  ].join('\n');
}


function buildLocationAnswer(knowledge) {
  const company =
    knowledge?.company ||
    {};

  const location =
    company.location ||
    company.base ||
    company.headquarters ||
    'Hyderabad, India';

  return `Alphex AI is based in **${location}**.`;
}


function buildIndustriesAnswer(knowledge) {
  const industries =
    knowledge?.industries ||
    knowledge?.example_industries ||
    [];

  const items =
    extractStringArray(industries);

  if (items.length === 0) {
    return (
      'Alphex AI can build AI systems for different business contexts, ' +
      'with solutions tailored to the client and industry requirements.'
    );
  }

  return [
    '**Example industries where Alphex AI can help:**',
    '',
    ...items.map(item => `- ${item}`),
    '',
    'These are example applications, not claims of existing customers or certified deployments.'
  ].join('\n');
}


function buildProcessAnswer(knowledge) {
  const process =
    knowledge?.process ||
    knowledge?.delivery_process ||
    knowledge?.delivery ||
    {};

  const items =
    extractStringArray(process);

  if (items.length === 0) {
    return [
      '**Alphex AI process:**',
      '',
      '1. Discover',
      '2. Build + test',
      '3. Launch + improve'
    ].join('\n');
  }

  return [
    '**Alphex AI process:**',
    '',
    ...items.map((item, index) =>
      `${index + 1}. ${item}`
    )
  ].join('\n');
}


function buildHumanHandoffAnswer(knowledge) {
  const trust =
    knowledge?.trust_security ||
    knowledge?.quality ||
    {};

  return [
    'Yes. Alphex AI’s chatbot solutions can include **human handoff** when the workflow requires it.',
    '',
    'The broader approach is to keep people in control, with boundaries, escalation, oversight, and observable AI behavior.'
  ].join('\n');
}


/* =========================================================
   SYSTEM PROMPT
   ========================================================= */

function buildSystemPrompt({
  knowledgeText,
  chatbotRules,
  currentProfile,
  page
}) {
  const profileText =
    currentProfile
      ? JSON.stringify(
          sanitizeProfile(currentProfile),
          null,
          2
        )
      : 'No authenticated user profile available.';

  return `
You are Alphex Minibot, the conversational AI assistant for Alphex AI.

Your job is to be naturally conversational while remaining strictly grounded in verified Alphex AI knowledge.

IMPORTANT KNOWLEDGE RULES:

1. Alphex-specific facts must come from the supplied Alphex knowledge.
2. Never invent Alphex customers, employees, partnerships, certifications, statistics, offices, integrations, guarantees, timelines, contracts, discounts, or capabilities.
3. If an Alphex-specific fact is not present in the knowledge, say that you do not have that information.
4. Do not turn general industry examples into claims that Alphex already has those customers or deployments.
5. Public pricing is starting pricing only.
6. Do not invent final quotes, discounts, SLAs, delivery dates, contract terms, or hidden fees.
7. General AI questions may be answered naturally using your general knowledge.
8. Alphex knowledge should constrain Alphex facts, but it should NOT constrain your conversational ability.
9. Understand greetings, typos, slang, short questions, follow-ups, pronouns, incomplete sentences, and casual conversation.
10. Use conversation context when resolving references such as "it", "they", "that", or "the first product".
11. Do not repeatedly introduce yourself.
12. Do not repeatedly say "How can I help?"
13. Do not say "I don't have pricing" when pricing is present in the supplied knowledge.
14. Do not tell the user to check the website for information that is already available in the supplied knowledge.
15. Be concise when the question is simple and detailed when the question requires detail.
16. Do not use unnecessary corporate jargon.
17. Do not say "As an AI" unless genuinely necessary.

CONVERSATION STYLE:

- Friendly
- Intelligent
- Direct
- Professional
- Natural
- Helpful
- Human-like without pretending to be human

ALPHEX CHATBOT RULES:

${chatbotRules}

VERIFIED ALPHEX KNOWLEDGE:

${knowledgeText}

CURRENT USER PROFILE:

${profileText}

CURRENT PAGE:

${page || 'Unknown'}

Remember:
For Alphex-specific questions, facts must remain grounded.
For general questions, answer naturally.
For mixed questions, answer both parts.
`;
}


/* =========================================================
   PROVIDER POOL
   ========================================================= */

async function generateWithProviderPool(messages) {
  const startedAt = Date.now();

  const attempts = [];

  /* -------------------------------------------------------
     Groq models
     ------------------------------------------------------- */

  if (GROQ_API_KEY) {
    for (const model of GROQ_MODELS) {
      const elapsed =
        Date.now() - startedAt;

      if (
        elapsed >= TOTAL_PROVIDER_BUDGET_MS
      ) {
        break;
      }

      try {
        const remaining =
          TOTAL_PROVIDER_BUDGET_MS - elapsed;

        const timeoutMs =
          Math.min(
            GROQ_TIMEOUT_MS,
            Math.max(500, remaining)
          );

        const result =
          await callGroq({
            apiKey: GROQ_API_KEY,
            model,
            messages,
            timeoutMs
          });

        if (result?.answer) {
          console.info(
            '[Alphex Chatbot] Groq success:',
            {
              model,
              elapsed: Date.now() - startedAt
            }
          );

          return {
            provider: 'groq',
            model,
            answer: result.answer
          };
        }
      } catch (error) {
        attempts.push({
          provider: 'groq',
          model,
          error: safeError(error)
        });

        console.warn(
          '[Alphex Chatbot] Groq failed:',
          safeError(error)
        );
      }
    }
  }

  /* -------------------------------------------------------
     Gemini models
     ------------------------------------------------------- */

  if (GEMINI_API_KEY) {
    for (const model of GEMINI_MODELS) {
      const elapsed =
        Date.now() - startedAt;

      if (
        elapsed >= TOTAL_PROVIDER_BUDGET_MS
      ) {
        break;
      }

      try {
        const remaining =
          TOTAL_PROVIDER_BUDGET_MS - elapsed;

        const timeoutMs =
          Math.min(
            GEMINI_TIMEOUT_MS,
            Math.max(500, remaining)
          );

        const result =
          await callGemini({
            apiKey: GEMINI_API_KEY,
            model,
            messages,
            timeoutMs
          });

        if (result?.answer) {
          console.info(
            '[Alphex Chatbot] Gemini success:',
            {
              model,
              elapsed: Date.now() - startedAt
            }
          );

          return {
            provider: 'gemini',
            model,
            answer: result.answer
          };
        }
      } catch (error) {
        attempts.push({
          provider: 'gemini',
          model,
          error: safeError(error)
        });

        console.warn(
          '[Alphex Chatbot] Gemini fallback failed:',
          safeError(error)
        );
      }
    }
  }

  console.error(
    '[Alphex Chatbot] Provider pool exhausted:',
    {
      elapsed: Date.now() - startedAt,
      attempts
    }
  );

  return null;
}


/* =========================================================
   GROQ
   ========================================================= */

async function callGroq({
  apiKey,
  model,
  messages,
  timeoutMs
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: TEMPERATURE,
            max_tokens: MAX_OUTPUT_TOKENS
          }),
          signal: controller.signal
        }
      );

    const raw =
      await response.text();

    let data = null;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        `Groq HTTP ${response.status}: ${
          raw.slice(0, 1000)
        }`
      );
    }

    const answer =
      data?.choices?.[0]?.message?.content;

    if (
      typeof answer !== 'string' ||
      !answer.trim()
    ) {
      throw new Error(
        'Groq returned an empty response.'
      );
    }

    return {
      answer: answer.trim()
    };

  } catch (error) {
    if (
      error?.name === 'AbortError'
    ) {
      throw new Error(
        `Groq timeout after ${timeoutMs}ms`
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   GEMINI
   ========================================================= */

async function callGemini({
  apiKey,
  model,
  messages,
  timeoutMs
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents =
      convertMessagesToGemini(messages);

    const systemInstruction =
      extractSystemInstruction(messages);

    const body = {
      contents,
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_OUTPUT_TOKENS
      }
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [
          {
            text: systemInstruction
          }
        ]
      };
    }

    const response =
      await fetch(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );

    const raw =
      await response.text();

    let data = null;

    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        `Gemini HTTP ${response.status}: ${
          raw.slice(0, 1000)
        }`
      );
    }

    const answer =
      extractGeminiText(data);

    if (
      typeof answer !== 'string' ||
      !answer.trim()
    ) {
      throw new Error(
        'Gemini returned an empty response.'
      );
    }

    return {
      answer: answer.trim()
    };

  } catch (error) {
    if (
      error?.name === 'AbortError'
    ) {
      throw new Error(
        `Gemini timeout after ${timeoutMs}ms`
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   GEMINI MESSAGE CONVERSION
   ========================================================= */

function convertMessagesToGemini(messages) {
  return messages
    .filter(
      message =>
        message.role !== 'system'
    )
    .map(message => ({
      role:
        message.role === 'assistant'
          ? 'model'
          : 'user',
      parts: [
        {
          text: String(
            message.content || ''
          )
        }
      ]
    }));
}


function extractSystemInstruction(messages) {
  const systemMessage =
    messages.find(
      message =>
        message.role === 'system'
    );

  return systemMessage?.content || '';
}


function extractGeminiText(data) {
  const parts =
    data?.candidates?.[0]?.content?.parts;

  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .map(part => part?.text || '')
    .join('')
    .trim();
}


/* =========================================================
   SUPABASE
   ========================================================= */

function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_URL &&
    SUPABASE_SERVICE_ROLE_KEY
  );
}


async function getSupabaseUser(accessToken) {
  const response =
    await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`,
          apikey:
            SUPABASE_SERVICE_ROLE_KEY
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Supabase user lookup failed: HTTP ${response.status}`
    );
  }

  return response.json();
}


async function getSupabaseProfile(userId) {
  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`,
      {
        headers: {
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:
            SUPABASE_SERVICE_ROLE_KEY
        }
      }
    );

  if (!response.ok) {
    return null;
  }

  const data =
    await response.json();

  return Array.isArray(data)
    ? data[0] || null
    : null;
}


async function loadConversationHistory(
  conversationId,
  userId
) {
  const url =
    `${SUPABASE_URL}/rest/v1/conversation_messages` +
    `?conversation_id=eq.${encodeURIComponent(conversationId)}` +
    `&user_id=eq.${encodeURIComponent(userId)}` +
    `&select=role,content,created_at` +
    `&order=created_at.desc` +
    `&limit=${MAX_HISTORY_MESSAGES}`;

  const response =
    await fetch(
      url,
      {
        headers: {
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:
            SUPABASE_SERVICE_ROLE_KEY
        }
      }
    );

  const raw =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Supabase history HTTP ${response.status}: ${raw.slice(0, 500)}`
    );
  }

  const data =
    JSON.parse(raw);

  return Array.isArray(data)
    ? data.reverse()
    : [];
}


async function saveConversationMessages({
  conversationId,
  userId,
  userMessage,
  assistantMessage
}) {
  const rows = [
    {
      conversation_id:
        conversationId,
      user_id:
        userId,
      role:
        'user',
      content:
        userMessage
    },
    {
      conversation_id:
        conversationId,
      user_id:
        userId,
      role:
        'assistant',
      content:
        assistantMessage
    }
  ];

  const response =
    await fetch(
      `${SUPABASE_URL}/rest/v1/conversation_messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json',
          Authorization:
            `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:
            SUPABASE_SERVICE_ROLE_KEY,
          Prefer:
            'return=minimal'
        },
        body:
          JSON.stringify(rows)
      }
    );

  if (!response.ok) {
    const raw =
      await response.text();

    throw new Error(
      `Supabase message save HTTP ${response.status}: ${raw.slice(0, 500)}`
    );
  }
}


/* =========================================================
   HISTORY / PROFILE HELPERS
   ========================================================= */

function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map(item => {
      const role =
        item?.role === 'assistant'
          ? 'assistant'
          : item?.role === 'system'
            ? 'system'
            : 'user';

      const content =
        String(
          item?.content || ''
        ).trim();

      return {
        role,
        content:
          content.length > 1800
            ? content.slice(0, 1800) +
              '…'
            : content
      };
    })
    .filter(
      item =>
        item.content.length > 0
    );
}


function sanitizeProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return null;
  }

  const safe = {};

  const allowedKeys = [
    'name',
    'full_name',
    'display_name',
    'company',
    'role'
  ];

  for (const key of allowedKeys) {
    if (
      typeof profile[key] === 'string'
    ) {
      safe[key] =
        profile[key].slice(0, 300);
    }
  }

  return safe;
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function parseModelList(value) {
  if (
    typeof value !== 'string' ||
    !value.trim()
  ) {
    return [];
  }

  return value
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
}


function normalizeMessage(message) {
  if (
    typeof message !== 'string'
  ) {
    return '';
  }

  return message
    .replace(/\u0000/g, '')
    .trim();
}


function normalizeForIntent(message) {
  return message
    .toLowerCase()
    .replace(/[?!.,;:()[\]{}'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function matchesAny(text, patterns) {
  return patterns.some(pattern => {
    const normalizedPattern =
      normalizeForIntent(pattern);

    return (
      text === normalizedPattern ||
      text.includes(normalizedPattern)
    );
  });
}


function extractStringArray(value) {
  if (Array.isArray(value)) {
    return value
      .filter(
        item =>
          typeof item === 'string'
      )
      .map(
        item => item.trim()
      )
      .filter(Boolean);
  }

  if (
    typeof value === 'object' &&
    value !== null
  ) {
    const values = [];

    for (const item of Object.values(value)) {
      if (typeof item === 'string') {
        values.push(
          item.trim()
        );
      } else if (Array.isArray(item)) {
        values.push(
          ...extractStringArray(item)
        );
      }
    }

    return values.filter(Boolean);
  }

  return [];
}


function findObjectByName(
  collection,
  names
) {
  if (
    !collection ||
    typeof collection !== 'object'
  ) {
    return null;
  }

  const normalizedNames =
    names.map(
      name =>
        normalizeForIntent(name)
    );

  for (const value of Object.values(collection)) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    ) {
      continue;
    }

    const candidate =
      normalizeForIntent(
        value.name ||
        value.title ||
        ''
      );

    if (
      normalizedNames.includes(
        candidate
      )
    ) {
      return value;
    }
  }

  return null;
}


function joinNatural(items) {
  if (items.length === 0) {
    return '';
  }

  if (items.length === 1) {
    return items[0];
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }

  return (
    items.slice(0, -1).join(', ') +
    `, and ${items[items.length - 1]}`
  );
}


function extractBearerToken(authorization) {
  if (
    !authorization ||
    !authorization.startsWith('Bearer ')
  ) {
    return null;
  }

  return authorization
    .slice(7)
    .trim() || null;
}


function cleanAssistantResponse(text) {
  if (
    typeof text !== 'string'
  ) {
    return '';
  }

  return text
    .trim()
    .replace(
      /^```(?:markdown|md|text)?\s*/i,
      ''
    )
    .replace(
      /\s*```$/i,
      ''
    )
    .trim();
}


function safeError(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (
    typeof error === 'string'
  ) {
    return error.slice(0, 1000);
  }

  return (
    error.message ||
    String(error)
  ).slice(0, 1000);
}


function setCorsHeaders(res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  res.setHeader(
    'Cache-Control',
    'no-store'
  );
}
