/* =========================================================
   ALPHEX AI — VERIFIED KNOWLEDGE BASE
   ---------------------------------------------------------
   This file is the source of truth supplied to the LLM
   when answering questions about Alphex AI.

   IMPORTANT:
   - Keep company claims factual.
   - Do not add fictional products or capabilities.
   - Update this file whenever the public website changes.
   - This file contains no API keys or secrets.
   ========================================================= */

const ALPHEX_KNOWLEDGE = {

  /* =======================================================
     COMPANY
     ======================================================= */

  company: {
    name: 'Alphex AI',

    description:
      'Alphex AI builds products for a better AI ecosystem, with a focus on AI evaluation, quality systems, and better opportunities across the AI ecosystem.',

    positioning:
      'Alphex AI builds evaluation products, quality systems, and better opportunities for the AI ecosystem.',

    website:
      'Alphex AI official website',

    primary_focus: [
      'AI evaluation',
      'AI quality systems',
      'AI products',
      'AI ecosystem infrastructure',
      'Opportunities across AI evaluation and related work'
    ],

    philosophy: [
      'Reliable by design',
      'Practical AI systems',
      'Clear and useful AI products',
      'Quality-focused AI development',
      'Human-centered AI workflows'
    ]
  },


  /* =======================================================
     WHAT ALPHEX AI DOES
     ======================================================= */

  capabilities: [

    {
      name: 'AI Evaluation',
      description:
        'Alphex AI develops evaluation-focused products and workflows designed to help teams assess the quality, reliability, safety, and behavior of AI systems.'
    },

    {
      name: 'AI Quality Systems',
      description:
        'Alphex AI focuses on systems and workflows that help organizations understand and improve the quality of AI outputs.'
    },

    {
      name: 'AI Products',
      description:
        'Alphex AI builds practical products for organizations and individuals working with AI systems.'
    },

    {
      name: 'AI Ecosystem Opportunities',
      description:
        'Alphex AI also works on products that improve access to opportunities in AI evaluation, annotation, data, and related AI work.'
    }
  ],


  /* =======================================================
     PRODUCTS
     ======================================================= */

  products: [

    {
      name: 'EvalLoop AI',

      status: 'Product',

      description:
        'EvalLoop AI is an AI evaluation product focused on helping users evaluate AI responses and models through structured evaluation workflows.',

      core_workflow:
        'Dataset → Run → Evaluators → Results',

      evaluation_focus: [
        'Factuality',
        'Instruction Following',
        'Relevance',
        'Completeness',
        'Safety',
        'Fluency'
      ],

      supported_evaluation_concepts: [
        'AI response evaluation',
        'Model comparison',
        'Prompt and response evaluation',
        'Safety evaluation',
        'Conversation evaluation',
        'Memory and context evaluation',
        'RAG-style evaluation',
        'Multimodal evaluation',
        'Image authenticity evaluation',
        'Bounding-box evaluation'
      ],

      conversation_evaluation: [
        'Turn accuracy',
        'Coherence',
        'Context retention',
        'Instruction following',
        'Toxicity'
      ],

      positioning:
        'EvalLoop AI is intended to make AI evaluation more structured, understandable, and accessible without requiring every user to build evaluation infrastructure from scratch.'
    },


    {
      name: 'EvalLoop Jobs',

      status: 'Product',

      description:
        'EvalLoop Jobs is an independent curated discovery platform for AI-related opportunities.',

      opportunity_areas: [
        'AI annotation',
        'AI evaluation',
        'LLM evaluation',
        'Generative AI',
        'Agentic AI',
        'Data annotation',
        'Data collection',
        'Language work',
        'Multimodal work',
        'AI expert work'
      ],

      important_disclaimer:
        'EvalLoop Jobs is an independent curated directory and discovery platform. It is not the employer or hiring company for the opportunities listed on the platform.',

      application_process:
        'Applications are made through the original hiring company, hiring platform, project provider, or contributor network associated with each opportunity.',

      role_of_alphex:
        'Alphex AI provides the discovery platform and does not represent itself as the employer for listed opportunities.'
    }
  ],


  /* =======================================================
     EVALUATION CONCEPT
     ======================================================= */

  evaluation: {

    description:
      'AI evaluation is the structured process of measuring how well an AI system performs against defined criteria.',

    important_dimensions: [
      {
        name: 'Factuality',
        description:
          'Whether an AI response is factually correct and avoids unsupported claims.'
      },

      {
        name: 'Instruction Following',
        description:
          'Whether the AI follows the instructions provided by the user or evaluation task.'
      },

      {
        name: 'Relevance',
        description:
          'Whether the response directly addresses the task or question.'
      },

      {
        name: 'Completeness',
        description:
          'Whether the response covers the important parts of the requested task.'
      },

      {
        name: 'Safety',
        description:
          'Whether the response follows applicable safety requirements and avoids harmful behavior.'
      },

      {
        name: 'Fluency',
        description:
          'Whether the response is clear, readable, and linguistically coherent.'
      }
    ]
  },


  /* =======================================================
     SERVICES / BUSINESS SOLUTIONS
     ======================================================= */

  services: {

    description:
      'Alphex AI develops AI products and quality-focused systems for organizations working with artificial intelligence.',

    areas: [
      'AI evaluation',
      'AI quality workflows',
      'AI product development',
      'Evaluation infrastructure',
      'AI system quality assessment',
      'AI ecosystem products'
    ],

    business_support:
      'When a visitor has a genuine business requirement, the assistant should help them understand the relevant Alphex AI capability and guide them toward contacting the Alphex AI team rather than inventing a solution or commitment.'
  },


  /* =======================================================
     PROCESS
     ======================================================= */

  process: {

    description:
      'Alphex AI follows a product and quality-oriented approach to building AI systems.',

    principles: [
      'Understand the problem',
      'Define measurable requirements',
      'Build practical AI workflows',
      'Evaluate quality',
      'Iterate based on results',
      'Keep systems understandable and useful'
    ]
  },


  /* =======================================================
     COMPANY CHATBOT
     ======================================================= */

  chatbot: {

    identity:
      'The Alphex AI Assistant is the conversational AI assistant for the Alphex AI website.',

    responsibilities: [
      'Explain Alphex AI',
      'Explain Alphex AI products',
      'Explain available capabilities',
      'Answer questions about evaluation',
      'Help visitors understand relevant products',
      'Answer general AI questions',
      'Help users navigate the website',
      'Help qualified visitors understand how to engage with Alphex AI'
    ],

    behavior: [
      'Be concise when the question is simple.',
      'Be detailed when the user asks for an explanation.',
      'Use verified Alphex AI information when discussing Alphex AI.',
      'Never claim that an unavailable feature exists.',
      'Never invent pricing.',
      'Never invent customer names or partnerships.',
      'Never invent previous conversations.',
      'Never claim to remember information that was not retrieved from stored memory.',
      'Clearly distinguish current products from future ideas.',
      'If information is unavailable, say so honestly.',
      'For general questions outside Alphex AI, provide a useful LLM-style answer.',
      'When a question involves both Alphex AI and a general AI concept, explain both where appropriate.'
    ]
  },


  /* =======================================================
     GENERAL AI QUESTIONS
     ======================================================= */

  general_ai: {

    enabled: true,

    description:
      'The assistant may answer general questions outside Alphex AI using the connected language model.',

    rules: [
      'General AI answers should not be presented as official Alphex AI statements.',
      'Do not connect unrelated topics to Alphex AI unless there is a genuine connection.',
      'If current information is required, the backend should use an appropriate current-information source when available.',
      'Do not fabricate facts simply because the user expects an immediate answer.'
    ]
  },


  /* =======================================================
     TRUST & ACCURACY
     ======================================================= */

  accuracy_rules: [

    'Alphex AI information must come from this verified knowledge base or other explicitly supplied official company context.',

    'The assistant must never manufacture Alphex AI products, services, customers, partnerships, pricing, statistics, employees, certifications, or capabilities.',

    'If a feature is described as future, planned, research, experimental, or coming soon, do not describe it as a currently available production feature.',

    'If the assistant does not know the answer to an Alphex AI-specific question, it should say that the information is not currently available rather than guessing.',

    'The assistant should not make legal, financial, security, or other high-stakes commitments on behalf of Alphex AI.',

    'The assistant should not promise delivery dates, contracts, pricing, SLAs, or custom development commitments unless those details are explicitly supplied by the backend or official knowledge base.'
  ],


  /* =======================================================
     CONTACT / LEAD HANDOFF
     ======================================================= */

  contact: {

    purpose:
      'Visitors with genuine business interest should be guided toward the official Alphex AI contact channel.',

    lead_signals: [
      'Request for business collaboration',
      'Enterprise evaluation requirement',
      'Custom AI evaluation requirement',
      'AI quality-system requirement',
      'Product partnership discussion',
      'Implementation discussion',
      'Commercial enquiry'
    ],

    behavior:
      'The assistant should understand the visitor requirement, summarize it clearly, and guide the visitor to the official Alphex AI contact channel when appropriate.'
  },


  /* =======================================================
     WEBSITE AREAS
     ======================================================= */

  website_sections: [

    {
      name: 'Capabilities',
      description:
        'Explains the capabilities and areas in which Alphex AI works.'
    },

    {
      name: 'Products',
      description:
        'Contains Alphex AI product offerings and product information.'
    },

    {
      name: 'Process',
      description:
        'Explains the general approach Alphex AI uses to work on AI products and quality systems.'
    },

    {
      name: 'Pricing',
      description:
        'Contains the current publicly presented pricing information.'
    },

    {
      name: 'FAQ',
      description:
        'Contains frequently asked questions about Alphex AI and its offerings.'
    },

    {
      name: 'Documentation',
      description:
        'Contains product and technical documentation where available.'
    },

    {
      name: 'About',
      description:
        'Provides information about Alphex AI and its positioning.'
    },

    {
      name: 'Contact',
      description:
        'Provides the official route for contacting Alphex AI.'
    }
  ],


  /* =======================================================
     CURRENT PRODUCT BOUNDARIES
     ======================================================= */

  boundaries: [

    'Do not describe internal prototypes as publicly available products.',

    'Do not claim that every planned evaluation type is already production-ready.',

    'Do not claim that Alphex AI has customers unless the information is explicitly added to the knowledge base.',

    'Do not claim partnerships unless they are explicitly added to the knowledge base.',

    'Do not invent enterprise pricing.',

    'Do not invent API availability.',

    'Do not invent integrations.',

    'Do not invent performance benchmarks.',

    'Do not invent security certifications.',

    'Do not invent team size or employee information.'
  ],


  /* =======================================================
     RESPONSE STYLE
     ======================================================= */

  response_style: {

    tone: [
      'Professional',
      'Clear',
      'Confident',
      'Helpful',
      'Technically informed',
      'Human'
    ],

    avoid: [
      'Corporate buzzword overload',
      'Unnecessary repetition',
      'Fake enthusiasm',
      'Unsupported claims',
      'Long answers to simple questions'
    ],

    preferred_behavior:
      'Answer directly first, then provide useful context when needed.'
  }
};


/* =========================================================
   KNOWLEDGE HELPERS
   ========================================================= */

/**
 * Returns the complete knowledge object.
 */
function getAlphexKnowledge() {
  return ALPHEX_KNOWLEDGE;
}


/**
 * Converts the knowledge object into text suitable
 * for inclusion in a Groq system/context prompt.
 */
function getAlphexKnowledgeText() {

  return JSON.stringify(
    ALPHEX_KNOWLEDGE,
    null,
    2
  );
}


/**
 * Returns a smaller product-focused knowledge object.
 */
function getAlphexProductKnowledge() {

  return {
    company: ALPHEX_KNOWLEDGE.company,
    products: ALPHEX_KNOWLEDGE.products,
    capabilities: ALPHEX_KNOWLEDGE.capabilities,
    evaluation: ALPHEX_KNOWLEDGE.evaluation,
    services: ALPHEX_KNOWLEDGE.services,
    accuracy_rules: ALPHEX_KNOWLEDGE.accuracy_rules
  };
}


/**
 * Returns rules specifically intended for the
 * Alphex AI chatbot system prompt.
 */
function getAlphexChatbotRules() {

  return [
    ...ALPHEX_KNOWLEDGE.chatbot.behavior,
    ...ALPHEX_KNOWLEDGE.accuracy_rules,
    ...ALPHEX_KNOWLEDGE.boundaries
  ];
};


/* =========================================================
   EXPORT
   ========================================================= */

if (typeof module !== 'undefined' && module.exports) {

  module.exports = {
    ALPHEX_KNOWLEDGE,
    getAlphexKnowledge,
    getAlphexKnowledgeText,
    getAlphexProductKnowledge,
    getAlphexChatbotRules
  };

}
