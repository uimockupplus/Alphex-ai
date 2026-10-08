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
 * Architecture:
 *   User message
 *        ↓
 *   Deterministic Alphex knowledge router
 *        ↓
 *   Verified Alphex answer?
 *        ├── YES → return immediately
 *        │
 *        └── NO
 *             ↓
 *        Groq model pool
 *             ↓
 *        Gemini model pool
 *             ↓
 *        conversational/general AI answer
 *
 * Important:
 *   - Alphex facts come from ./alphex-knowledge.js
 *   - High-confidence business questions are handled
 *     deterministically before calling an LLM.
 *   - LLMs handle general AI and conversational questions.
 *   - Provider failures are hidden from the user.
 *   - Supabase persistence failures never break a successful answer.
 */

/* =========================================================
   KNOWLEDGE IMPORT
   ========================================================= */

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

/*
 * Keep the total backend provider time bounded.
 * Deterministic answers do not use this budget.
 */
const TOTAL_PROVIDER_BUDGET_MS = 7800;

const GROQ_TIMEOUT_MS = 2200;
const GEMINI_TIMEOUT_MS = 2200;

const MAX_HISTORY_MESSAGES = 8;
const MAX_MEMORY_ITEMS = 6;

const MAX_MESSAGE_LENGTH = 4000;

const MAX_OUTPUT_TOKENS = 650;

const TEMPERATURE = 0.55;


/* =========================================================
   ENVIRONMENT
   ========================================================= */

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


/* =========================================================
   MODEL POOLS
   ========================================================= */

const configuredGroqModels =
  parseModelList(
    process.env.GROQ_MODELS
  );

const configuredGeminiModels =
  parseModelList(
    process.env.GEMINI_MODELS
  );

const GROQ_MODELS =
  configuredGroqModels.length > 0
    ? configuredGroqModels
    : process.env.GROQ_MODEL
      ? uniqueModels([
          process.env.GROQ_MODEL,
          ...DEFAULT_GROQ_MODELS
        ])
      : DEFAULT_GROQ_MODELS;

const GEMINI_MODELS =
  configuredGeminiModels.length > 0
    ? configuredGeminiModels
    : process.env.GEMINI_MODEL
      ? uniqueModels([
          process.env.GEMINI_MODEL,
          ...DEFAULT_GEMINI_MODELS
        ])
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

    const message =
      normalizeMessage(body.message);

    if (!message) {
      return res.status(400).json({
        error: 'Message is required.'
      });
    }

    if (
      message.length >
      MAX_MESSAGE_LENGTH
    ) {
      return res.status(400).json({
        error:
          `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`
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

    const accessToken =
      extractBearerToken(
        authorization
      );

    const knowledge =
      getAlphexKnowledge();


    /* =====================================================
       AUTHENTICATION / USER CONTEXT
       ===================================================== */

    let currentUser = null;
    let currentProfile = null;

    if (
      accessToken &&
      isSupabaseConfigured()
    ) {
      try {
        currentUser =
          await getSupabaseUser(
            accessToken
          );

        if (currentUser?.id) {
          currentProfile =
            await getSupabaseProfile(
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


    /* =====================================================
       LOAD CONVERSATION HISTORY
       ===================================================== */

    let history = [];

    if (
      conversationId &&
      currentUser?.id &&
      isSupabaseConfigured()
    ) {
      try {
        history =
          await loadConversationHistory(
            conversationId,
            currentUser.id
          );
      } catch (error) {
        /*
         * This is intentionally non-fatal.
         *
         * If conversation_messages does not exist yet,
         * the chatbot must still work.
         */
        console.warn(
          '[Alphex Chatbot] History lookup failed:',
          safeError(error)
        );
      }
    }


    /* =====================================================
       DETERMINISTIC ALPHEX KNOWLEDGE ROUTING
       ===================================================== */

    /*
     * IMPORTANT:
     *
     * This happens BEFORE Groq/Gemini.
     *
     * Therefore questions such as:
     *
     *   "what are the pricing"
     *   "how much does it cost"
     *   "what are your plans"
     *   "is there any negotiation"
     *
     * do not depend on an LLM remembering the knowledge.
     */

    const deterministicAnswer =
      getDeterministicKnowledgeAnswer(
        message,
        knowledge
      );

    if (deterministicAnswer) {
      const responseText =
        deterministicAnswer.answer;

      /*
       * Persistence is optional.
       * Never allow persistence failure to break
       * a deterministic answer.
       */
      if (
        conversationId &&
        currentUser?.id &&
        isSupabaseConfigured()
      ) {
        try {
          await saveConversationMessages({
            conversationId,
            userId:
              currentUser.id,
            userMessage:
              message,
            assistantMessage:
              responseText
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
        provider:
          'alphex-knowledge',
        model:
          deterministicAnswer.route,
        deterministic:
          true,
        conversation_id:
          conversationId || null,
        elapsed_ms:
          Date.now() -
          requestStartedAt
      });
    }


    /* =====================================================
       BUILD LLM PROMPT
       ===================================================== */

    const systemPrompt =
      buildSystemPrompt({
        knowledgeText:
          getAlphexKnowledgeText(),
        chatbotRules:
          getAlphexChatbotRules(),
        currentProfile,
        page
      });

    const compactHistory =
      normalizeHistory(
        history
      );

    const messages = [
      {
        role: 'system',
        content:
          systemPrompt
      },
      ...compactHistory,
      {
        role: 'user',
        content:
          message
      }
    ];


    /* =====================================================
       MULTI-PROVIDER AI GENERATION
       ===================================================== */

    const aiResult =
      await generateWithProviderPool(
        messages
      );

    if (!aiResult?.answer) {
      console.error(
        '[Alphex Chatbot] All AI providers failed.',
        {
          elapsed:
            Date.now() -
            requestStartedAt,

          groqConfigured:
            Boolean(
              GROQ_API_KEY
            ),

          geminiConfigured:
            Boolean(
              GEMINI_API_KEY
            ),

          supabaseConfigured:
            isSupabaseConfigured()
        }
      );

      return res.status(503).json({
        error:
          'The AI service is temporarily unavailable.'
      });
    }


    /* =====================================================
       CLEAN AI RESPONSE
       ===================================================== */

    const responseText =
      cleanAssistantResponse(
        aiResult.answer
      );

    if (!responseText) {
      return res.status(503).json({
        error:
          'The AI service is temporarily unavailable.'
      });
    }


    /* =====================================================
       PERSIST SUCCESSFUL CONVERSATION
       ===================================================== */

    if (
      conversationId &&
      currentUser?.id &&
      isSupabaseConfigured()
    ) {
      try {
        await saveConversationMessages({
          conversationId,
          userId:
            currentUser.id,
          userMessage:
            message,
          assistantMessage:
            responseText
        });
      } catch (error) {
        console.warn(
          '[Alphex Chatbot] Message persistence failed:',
          safeError(error)
        );
      }
    }


    /* =====================================================
       FINAL RESPONSE
       ===================================================== */

    return res.status(200).json({
      success: true,
      answer:
        responseText,
      provider:
        aiResult.provider,
      model:
        aiResult.model,
      deterministic:
        false,
      conversation_id:
        conversationId || null,
      elapsed_ms:
        Date.now() -
        requestStartedAt
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

function getDeterministicKnowledgeAnswer(
  message,
  knowledge
) {
  const text =
    normalizeForIntent(
      message
    );


  /* =====================================================
     PRICING
     ===================================================== */

  /*
   * Keep pricing BEFORE generic product/service routes.
   *
   * Examples:
   *   what are the pricing
   *   what is the pricing
   *   pricing
   *   prices
   *   how much
   *   how much does it cost
   *   what does it cost
   *   what are your plans
   *   what do you charge
   *   setup price
   */

  if (
    isPricingIntent(text)
  ) {
    return {
      route:
        'pricing',
      answer:
        buildPricingAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     NEGOTIATION / DISCOUNTS
     ===================================================== */

  if (
    isNegotiationIntent(text)
  ) {
    return {
      route:
        'pricing-boundary',
      answer:
        buildNegotiationAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     COMPANY OVERVIEW
     ===================================================== */

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
      route:
        'company-overview',
      answer:
        buildCompanyOverviewAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     SOLUTIONS / CAPABILITIES
     ===================================================== */

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
      route:
        'solutions',
      answer:
        buildSolutionsAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     PRODUCTS
     ===================================================== */

  if (
    matchesAny(text, [
      'what products do you have',
      'what are your products',
      'alphex products',
      'list your products',
      'show me your products',
      'what product does alphex have',
      'what products does alphex ai have'
    ])
  ) {
    return {
      route:
        'products',
      answer:
        buildProductsAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     EVALLOOP AI
     ===================================================== */

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
      route:
        'evalloop-ai',
      answer:
        buildEvalLoopAIAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     EVALLOOP JOBS
     ===================================================== */

  if (
    matchesAny(text, [
      'what is evalloop jobs',
      'what is eval loop jobs',
      'tell me about evalloop jobs',
      'tell me about eval loop jobs',
      'what does evalloop jobs do',
      'what does eval loop jobs do',
      'evalloop jobs',
      'eval loop jobs'
    ])
  ) {
    return {
      route:
        'evalloop-jobs',
      answer:
        buildEvalLoopJobsAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     LOCATION
     ===================================================== */

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
      route:
        'location',
      answer:
        buildLocationAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     INDUSTRIES
     ===================================================== */

  if (
    matchesAny(text, [
      'what industries do you serve',
      'which industries do you serve',
      'what industries',
      'industries',
      'who do you work with',
      'who is alphex for',
      'who is alphex ai for',
      'what businesses can use alphex',
      'what businesses do you help'
    ])
  ) {
    return {
      route:
        'industries',
      answer:
        buildIndustriesAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     PROCESS
     ===================================================== */

  if (
    matchesAny(text, [
      'how do you work',
      'how does alphex work',
      'what is your process',
      'alphex process',
      'project process',
      'how do projects work',
      'how do you build ai systems',
      'how do you build ai'
    ])
  ) {
    return {
      route:
        'process',
      answer:
        buildProcessAnswer(
          knowledge
        )
    };
  }


  /* =====================================================
     HUMAN HANDOFF
     ===================================================== */

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
      route:
        'human-handoff',
      answer:
        buildHumanHandoffAnswer(
          knowledge
        )
    };
  }


  return null;
}


/* =========================================================
   PRICING INTENT
   ========================================================= */

function isPricingIntent(text) {
  if (!text) {
    return false;
  }

  /*
   * Direct pricing words.
   */
  if (
    containsAnyWord(text, [
      'pricing',
      'price',
      'prices',
      'cost',
      'costs',
      'charges',
      'charge'
    ])
  ) {
    return true;
  }

  /*
   * Common natural-language pricing questions.
   */
  if (
    matchesAny(text, [
      'how much',
      'how much does it cost',
      'how much does it',
      'how much is it',
      'how much is',
      'what do you charge',
      'what are your charges',
      'what are your plans',
      'what plans do you have',
      'pricing plans',
      'plan price',
      'setup price',
      'setup cost',
      'what is the fee',
      'what are the fees'
    ])
  ) {
    return true;
  }

  return false;
}


/* =========================================================
   NEGOTIATION INTENT
   ========================================================= */

function isNegotiationIntent(text) {
  if (!text) {
    return false;
  }

  if (
    containsAnyWord(text, [
      'negotiation',
      'negotiate',
      'negotiable',
      'discount',
      'discounts'
    ])
  ) {
    return true;
  }

  return matchesAny(text, [
    'can i negotiate',
    'can you negotiate',
    'is it negotiable',
    'is the price negotiable',
    'can you lower the price',
    'can you reduce the price',
    'can you reduce pricing',
    'can you give a discount',
    'do you offer discounts',
    'is there any discount',
    'is there any negotiation',
    'flexible pricing',
    'flexible price',
    'lower price',
    'cheaper'
  ]);
}


/* =========================================================
   DETERMINISTIC ANSWER BUILDERS
   ========================================================= */

function buildPricingAnswer(knowledge) {
  const pricing =
    knowledge?.pricing ||
    {};

  const plans =
    Array.isArray(
      pricing.plans
    )
      ? pricing.plans
      : [];

  if (
    plans.length === 0
  ) {
    return [
      '**Alphex AI pricing:**',
      '',
      'I don’t have the current public pricing structure available right now.',
      '',
      'For a project-specific quote, pricing should be scoped with Alphex AI.'
    ].join('\n');
  }

  const lines = [
    '**Alphex AI pricing:**',
    ''
  ];

  for (const plan of plans) {
    const name =
      plan?.name ||
      'Plan';

    const label =
      plan?.label
        ? ` (${plan.label})`
        : '';

    const description =
      plan?.description ||
      '';

    const price =
      plan?.price ||
      'Custom scope';

    lines.push(
      `**${name}${label}** — ${price}`
    );

    if (description) {
      lines.push(
        `  ${description}`
      );
    }

    lines.push('');
  }

  /*
   * IMPORTANT:
   *
   * The knowledge file calls this property
   * "pricing_boundary", not "boundary".
   */
  const boundary =
    pricing.pricing_boundary ||
    pricing.boundary ||
    '';

  if (boundary) {
    lines.push(
      boundary
    );
  }

  return lines
    .join('\n')
    .trim();
}


function buildNegotiationAnswer(
  knowledge
) {
  const pricing =
    knowledge?.pricing ||
    {};

  const boundary =
    pricing.pricing_boundary ||
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


function buildCompanyOverviewAnswer(
  knowledge
) {
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

  return [
    `**${name}** is ${description}`,
    '',
    'Its primary focus is building AI solutions around client requirements, workflows, knowledge, tools, and desired outcomes.'
  ].join('\n');
}


function buildSolutionsAnswer(
  knowledge
) {
  const solutions =
    knowledge?.solutions ||
    {};

  const entries =
    Object.values(
      solutions
    ).filter(
      value =>
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );

  if (
    entries.length === 0
  ) {
    return [
      '**Alphex AI builds:**',
      '',
      '- Conversational chatbots',
      '- Knowledge systems',
      '- RAG solutions',
      '- AI agents',
      '- Custom AI workflows'
    ].join('\n');
  }

  const lines = [
    '**Alphex AI builds:**',
    ''
  ];

  for (const solution of entries) {
    const name =
      solution.name ||
      '';

    const description =
      solution.description ||
      '';

    if (name) {
      lines.push(
        `**${name}**${description ? ` — ${description}` : ''}`
      );
    }
  }

  return lines.join('\n');
}


function buildProductsAnswer(
  knowledge
) {
  const products =
    knowledge?.products ||
    {};

  const entries =
    Object.values(
      products
    ).filter(
      value =>
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );

  if (
    entries.length === 0
  ) {
    return [
      '**Alphex AI products:**',
      '',
      '**EvalLoop AI** — AI evaluation and quality platform.',
      '**EvalLoop Jobs** — AI opportunity discovery platform.'
    ].join('\n');
  }

  const lines = [
    '**Alphex AI products:**',
    ''
  ];

  for (const product of entries) {
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


function buildEvalLoopAIAnswer(
  knowledge
) {
  const product =
    knowledge?.products?.evalLoopAI;

  if (!product) {
    return [
      '**EvalLoop AI** is Alphex AI’s AI evaluation and quality platform.',
      '',
      'It focuses on evaluating AI responses, models, multimodal outputs, safety, grounding, and overall AI quality.'
    ].join('\n');
  }

  const name =
    product.name ||
    'EvalLoop AI';

  const description =
    product.description ||
    '';

  const focus =
    Array.isArray(
      product.focus
    )
      ? product.focus
      : [];

  const lines = [
    `**${name}** is ${description}`
  ];

  if (
    focus.length > 0
  ) {
    lines.push(
      '',
      `Key areas include ${joinNatural(focus)}.`
    );
  }

  return lines.join('\n');
}


function buildEvalLoopJobsAnswer(
  knowledge
) {
  const product =
    knowledge?.products?.evalLoopJobs;

  if (!product) {
    return [
      '**EvalLoop Jobs** is an independent AI opportunity discovery platform.',
      '',
      'It covers AI evaluation, LLM, data annotation, AI training, GenAI, prompt engineering, and related opportunities.',
      '',
      'It is not the employer or hiring company for listed opportunities.'
    ].join('\n');
  }

  const name =
    product.name ||
    'EvalLoop Jobs';

  const description =
    product.description ||
    '';

  return [
    `**${name}** is ${description}`,
    '',
    product.important_disclaimer ||
      'It is an independent curated opportunity discovery platform, not an employer.',
    '',
    product.application_process ||
      'Applications are made through the original hiring company, hiring platform, project provider, or contributor network.'
  ].join('\n');
}


function buildLocationAnswer(
  knowledge
) {
  const location =
    knowledge?.company?.location ||
    'Hyderabad, India';

  return `Alphex AI is based in **${location}**.`;
}


function buildIndustriesAnswer(
  knowledge
) {
  const industries =
    Array.isArray(
      knowledge?.industries
    )
      ? knowledge.industries
      : [];

  if (
    industries.length === 0
  ) {
    return [
      'Alphex AI can build AI systems for different business contexts, with solutions tailored to client and industry requirements.'
    ].join('\n');
  }

  const lines = [
    '**Example industries where Alphex AI can help:**',
    ''
  ];

  for (const industry of industries) {
    const name =
      industry?.name ||
      '';

    const positioning =
      industry?.positioning ||
      '';

    if (name) {
      lines.push(
        `- **${name}**${positioning ? ` — ${positioning}` : ''}`
      );
    }
  }

  lines.push(
    '',
    knowledge.industry_boundary ||
      'These are example industry applications, not claims of existing customers or certified deployments.'
  );

  return lines.join('\n');
}


function buildProcessAnswer(
  knowledge
) {
  const stages =
    Array.isArray(
      knowledge?.process?.stages
    )
      ? knowledge.process.stages
      : [];

  if (
    stages.length === 0
  ) {
    return [
      '**Alphex AI process:**',
      '',
      '1. Discover',
      '2. Build + test',
      '3. Launch + improve'
    ].join('\n');
  }

  const lines = [
    '**Alphex AI process:**',
    ''
  ];

  for (
    let index = 0;
    index < stages.length;
    index++
  ) {
    const stage =
      stages[index];

    const number =
      stage?.number ||
      String(index + 1);

    const name =
      stage?.name ||
      '';

    const description =
      stage?.description ||
      '';

    lines.push(
      `${number}. **${name}**${description ? ` — ${description}` : ''}`
    );
  }

  return lines.join('\n');
}


function buildHumanHandoffAnswer(
  knowledge
) {
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
          sanitizeProfile(
            currentProfile
          ),
          null,
          2
        )
      : 'No authenticated user profile available.';

  return `
You are Alphex Minibot, the conversational AI assistant for Alphex AI.

Be naturally conversational like a modern AI assistant while remaining strictly accurate about Alphex AI.

KNOWLEDGE RULES:

1. Alphex-specific facts must come from the supplied verified knowledge.
2. Never invent Alphex customers, employees, partnerships, certifications, statistics, offices, integrations, guarantees, timelines, contracts, discounts, or capabilities.
3. If an Alphex-specific fact is not present, say that the information is not currently available.
4. Never turn example industries into claims about existing customers or deployments.
5. Public pricing is starting pricing only.
6. Never invent final quotes, discounts, SLAs, delivery dates, contracts, or hidden fees.
7. General AI and general knowledge questions may be answered naturally.
8. Do not artificially connect unrelated questions to Alphex AI.
9. Understand greetings, typos, slang, incomplete sentences, short questions, and follow-ups.
10. Use conversation history to resolve references such as "it", "they", "that", "your company", or "the product".
11. Do not repeatedly introduce yourself.
12. Do not repeatedly say "How can I help?"
13. Do not claim that you lack pricing if pricing is present in the supplied knowledge.
14. Be concise for simple questions and detailed when useful.
15. Avoid unnecessary corporate jargon.
16. Do not say "As an AI" unless genuinely necessary.
17. Do not fabricate an answer merely because the user expects an immediate answer.

CONVERSATIONAL STYLE:

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

FINAL RULE:

For Alphex-specific questions, stay grounded in verified knowledge.
For general questions, answer naturally.
For mixed questions, answer both parts when appropriate.
`;
}


/* =========================================================
   PROVIDER POOL
   ========================================================= */

async function generateWithProviderPool(
  messages
) {
  const startedAt =
    Date.now();

  const attempts = [];


  /* =====================================================
     GROQ
     ===================================================== */

  if (GROQ_API_KEY) {
    for (
      const model of GROQ_MODELS
    ) {
      const elapsed =
        Date.now() -
        startedAt;

      if (
        elapsed >=
        TOTAL_PROVIDER_BUDGET_MS
      ) {
        break;
      }

      try {
        const remaining =
          TOTAL_PROVIDER_BUDGET_MS -
          elapsed;

        const timeoutMs =
          Math.min(
            GROQ_TIMEOUT_MS,
            Math.max(
              500,
              remaining
            )
          );

        const result =
          await callGroq({
            apiKey:
              GROQ_API_KEY,
            model,
            messages,
            timeoutMs
          });

        if (
          result?.answer
        ) {
          console.info(
            '[Alphex Chatbot] Groq success:',
            {
              model,
              elapsed:
                Date.now() -
                startedAt
            }
          );

          return {
            provider:
              'groq',
            model,
            answer:
              result.answer
          };
        }
      } catch (error) {
        attempts.push({
          provider:
            'groq',
          model,
          error:
            safeError(error)
        });

        console.warn(
          '[Alphex Chatbot] Groq failed:',
          safeError(error)
        );
      }
    }
  }


  /* =====================================================
     GEMINI
     ===================================================== */

  if (GEMINI_API_KEY) {
    for (
      const model of GEMINI_MODELS
    ) {
      const elapsed =
        Date.now() -
        startedAt;

      if (
        elapsed >=
        TOTAL_PROVIDER_BUDGET_MS
      ) {
        break;
      }

      try {
        const remaining =
          TOTAL_PROVIDER_BUDGET_MS -
          elapsed;

        const timeoutMs =
          Math.min(
            GEMINI_TIMEOUT_MS,
            Math.max(
              500,
              remaining
            )
          );

        const result =
          await callGemini({
            apiKey:
              GEMINI_API_KEY,
            model,
            messages,
            timeoutMs
          });

        if (
          result?.answer
        ) {
          console.info(
            '[Alphex Chatbot] Gemini success:',
            {
              model,
              elapsed:
                Date.now() -
                startedAt
            }
          );

          return {
            provider:
              'gemini',
            model,
            answer:
              result.answer
          };
        }
      } catch (error) {
        attempts.push({
          provider:
            'gemini',
          model,
          error:
            safeError(error)
        });

        console.warn(
          '[Alphex Chatbot] Gemini fallback failed:',
          safeError(error)
        );
      }
    }
  }


  /* =====================================================
     ALL FAILED
     ===================================================== */

  console.error(
    '[Alphex Chatbot] Provider pool exhausted:',
    {
      elapsed:
        Date.now() -
        startedAt,
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
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${apiKey}`
          },

          body:
            JSON.stringify({
              model,
              messages,
              temperature:
                TEMPERATURE,
              max_tokens:
                MAX_OUTPUT_TOKENS
            }),

          signal:
            controller.signal
        }
      );

    const raw =
      await response.text();

    let data = null;

    try {
      data =
        JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        `Groq HTTP ${response.status}: ${raw.slice(0, 1000)}`
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
      answer:
        answer.trim()
    };

  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Groq timeout after ${timeoutMs}ms`
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
  apiKey,
  model,
  messages,
  timeoutMs
}) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents =
      convertMessagesToGemini(
        messages
      );

    const systemInstruction =
      extractSystemInstruction(
        messages
      );

    const body = {
      contents,
      generationConfig: {
        temperature:
          TEMPERATURE,
        maxOutputTokens:
          MAX_OUTPUT_TOKENS
      }
    };

    if (
      systemInstruction
    ) {
      body.systemInstruction = {
        parts: [
          {
            text:
              systemInstruction
          }
        ]
      };
    }

    const response =
      await fetch(
        url,
        {
          method:
            'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify(body),

          signal:
            controller.signal
        }
      );

    const raw =
      await response.text();

    let data = null;

    try {
      data =
        JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(
        `Gemini HTTP ${response.status}: ${raw.slice(0, 1000)}`
      );
    }

    const answer =
      extractGeminiText(
        data
      );

    if (
      typeof answer !== 'string' ||
      !answer.trim()
    ) {
      throw new Error(
        'Gemini returned an empty response.'
      );
    }

    return {
      answer:
        answer.trim()
    };

  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        `Gemini timeout after ${timeoutMs}ms`
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
  return messages
    .filter(
      message =>
        message.role !==
        'system'
    )
    .map(
      message => ({
        role:
          message.role ===
          'assistant'
            ? 'model'
            : 'user',

        parts: [
          {
            text:
              String(
                message.content ||
                ''
              )
          }
        ]
      })
    );
}


function extractSystemInstruction(
  messages
) {
  const systemMessage =
    messages.find(
      message =>
        message.role ===
        'system'
    );

  return (
    systemMessage?.content ||
    ''
  );
}


function extractGeminiText(
  data
) {
  const parts =
    data?.candidates?.[0]
      ?.content?.parts;

  if (
    !Array.isArray(parts)
  ) {
    return '';
  }

  return parts
    .map(
      part =>
        part?.text || ''
    )
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


async function getSupabaseUser(
  accessToken
) {
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


async function getSupabaseProfile(
  userId
) {
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
        method:
          'POST',

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
   HISTORY / PROFILE
   ========================================================= */

function normalizeHistory(
  history
) {
  if (
    !Array.isArray(history)
  ) {
    return [];
  }

  return history
    .slice(
      -MAX_HISTORY_MESSAGES
    )
    .map(item => {
      const role =
        item?.role ===
        'assistant'
          ? 'assistant'
          : item?.role ===
              'system'
            ? 'system'
            : 'user';

      const content =
        String(
          item?.content ||
          ''
        ).trim();

      return {
        role,
        content:
          content.length > 1800
            ? content.slice(
                0,
                1800
              ) + '…'
            : content
      };
    })
    .filter(
      item =>
        item.content.length >
        0
    );
}


function sanitizeProfile(
  profile
) {
  if (
    !profile ||
    typeof profile !==
      'object'
  ) {
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

  for (
    const key of allowedKeys
  ) {
    if (
      typeof profile[key] ===
      'string'
    ) {
      safe[key] =
        profile[key].slice(
          0,
          300
        );
    }
  }

  return safe;
}


/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function parseModelList(
  value
) {
  if (
    typeof value !==
      'string' ||
    !value.trim()
  ) {
    return [];
  }

  return uniqueModels(
    value
      .split(',')
      .map(
        model =>
          model.trim()
      )
      .filter(Boolean)
  );
}


function uniqueModels(
  models
) {
  return [
    ...new Set(
      models.filter(
        model =>
          typeof model ===
            'string' &&
          model.trim()
      )
    )
  ];
}


function normalizeMessage(
  message
) {
  if (
    typeof message !==
    'string'
  ) {
    return '';
  }

  return message
    .replace(
      /\u0000/g,
      ''
    )
    .trim();
}


function normalizeForIntent(
  message
) {
  return String(
    message || ''
  )
    .toLowerCase()
    .replace(
      /[?!.,;:()[\]{}'"`]/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}


function matchesAny(
  text,
  patterns
) {
  return patterns.some(
    pattern => {
      const normalizedPattern =
        normalizeForIntent(
          pattern
        );

      return (
        text ===
          normalizedPattern ||
        text.includes(
          normalizedPattern
        )
      );
    }
  );
}


function containsAnyWord(
  text,
  words
) {
  return words.some(
    word => {
      const normalized =
        normalizeForIntent(
          word
        );

      if (!normalized) {
        return false;
      }

      /*
       * For multi-word expressions,
       * substring matching is appropriate.
       */
      if (
        normalized.includes(' ')
      ) {
        return text.includes(
          normalized
        );
      }

      /*
       * Word-boundary matching prevents
       * accidental matches such as:
       *
       * "prices" → "price"
       */
      const pattern =
        new RegExp(
          `(^|\\s)${escapeRegExp(normalized)}($|\\s)`,
          'i'
        );

      return pattern.test(
        text
      );
    }
  );
}


function escapeRegExp(
  value
) {
  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
}


function joinNatural(
  items
) {
  if (
    items.length === 0
  ) {
    return '';
  }

  if (
    items.length === 1
  ) {
    return items[0];
  }

  if (
    items.length === 2
  ) {
    return `${items[0]} and ${items[1]}`;
  }

  return (
    items
      .slice(0, -1)
      .join(', ') +
    `, and ${items[items.length - 1]}`
  );
}


function extractBearerToken(
  authorization
) {
  if (
    !authorization ||
    !authorization.startsWith(
      'Bearer '
    )
  ) {
    return null;
  }

  return authorization
    .slice(7)
    .trim() || null;
}


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


function safeError(
  error
) {
  if (!error) {
    return 'Unknown error';
  }

  if (
    typeof error ===
    'string'
  ) {
    return error.slice(
      0,
      1000
    );
  }

  return (
    error.message ||
    String(error)
  ).slice(
    0,
    1000
  );
}


function setCorsHeaders(
  res
) {
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
