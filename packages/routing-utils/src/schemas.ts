export const hasSchema = {
  description: 'An array of requirements that are needed to match',
  type: 'array',
  maxItems: 16,
  items: {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'value'],
        properties: {
          type: {
            description: 'The type of request element to check',
            type: 'string',
            enum: ['host'],
          },
          value: {
            description:
              'A regular expression used to match the value. Named groups can be used in the destination',
            type: 'string',
            maxLength: 4096,
          },
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'key'],
        properties: {
          type: {
            description: 'The type of request element to check',
            type: 'string',
            enum: ['header', 'cookie', 'query'],
          },
          key: {
            description:
              'The name of the element contained in the particular type',
            type: 'string',
            maxLength: 4096,
          },
          value: {
            description:
              'A regular expression used to match the value. Named groups can be used in the destination',
            type: 'string',
            maxLength: 4096,
          },
        },
      },
    ],
  },
} as const;

/**
 * An ajv schema for the routes array
 */
export const routesSchema = {
  type: 'array',
  maxItems: 1024,
  deprecated: true,
  description:
    'A list of routes objects used to rewrite paths to point towards other internal or external paths',
  example: [{ dest: 'https://docs.example.com', src: '/docs' }],
  items: {
    anyOf: [
      {
        type: 'object',
        required: ['src'],
        additionalProperties: false,
        properties: {
          src: {
            type: 'string',
            maxLength: 4096,
          },
          dest: {
            type: 'string',
            maxLength: 4096,
          },
          headers: {
            type: 'object',
            additionalProperties: false,
            minProperties: 1,
            maxProperties: 100,
            patternProperties: {
              '^.{1,256}$': {
                type: 'string',
                maxLength: 4096,
              },
            },
          },
          methods: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'string',
              maxLength: 32,
            },
          },
          important: {
            type: 'boolean',
          },
          user: {
            type: 'boolean',
          },
          continue: {
            type: 'boolean',
          },
          override: {
            type: 'boolean',
          },
          check: {
            type: 'boolean',
          },
          status: {
            type: 'integer',
            minimum: 100,
            maximum: 999,
          },
          locale: {
            type: 'object',
            additionalProperties: false,
            minProperties: 1,
            properties: {
              redirect: {
                type: 'object',
                additionalProperties: false,
                minProperties: 1,
                maxProperties: 100,
                patternProperties: {
                  '^.{1,256}$': {
                    type: 'string',
                    maxLength: 4096,
                  },
                },
              },
              value: {
                type: 'string',
                maxLength: 4096,
              },
              path: {
                type: 'string',
                maxLength: 4096,
              },
              cookie: {
                type: 'string',
                maxLength: 4096,
              },
              default: {
                type: 'string',
                maxLength: 4096,
              },
            },
          },
          has: hasSchema,
        },
      },
      {
        type: 'object',
        required: ['handle'],
        additionalProperties: false,
        properties: {
          handle: {
            type: 'string',
            maxLength: 32,
            enum: ['error', 'filesystem', 'hit', 'miss', 'resource', 'rewrite'],
          },
        },
      },
    ],
  },
} as const;

export const rewritesSchema = {
  type: 'array',
  maxItems: 1024,
  description: 'A list of rewrite definitions.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'destination'],
    properties: {
      source: {
        description:
          'A pattern that matches each incoming pathname (excluding querystring).',
        type: 'string',
        maxLength: 4096,
      },
      destination: {
        description:
          'An absolute pathname to an existing resource or an external URL.',
        type: 'string',
        maxLength: 4096,
      },
      has: hasSchema,
    },
  },
} as const;

export const redirectsSchema = {
  title: 'Redirects',
  type: 'array',
  maxItems: 1024,
  description: 'A list of redirect definitions.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'destination'],
    properties: {
      source: {
        description:
          'A pattern that matches each incoming pathname (excluding querystring).',
        type: 'string',
        maxLength: 4096,
      },
      destination: {
        description:
          'A location destination defined as an absolute pathname or external URL.',
        type: 'string',
        maxLength: 4096,
      },
      permanent: {
        description:
          'A boolean to toggle between permanent and temporary redirect. When `true`, the status code is `308`. When `false` the status code is `307`.',
        type: 'boolean',
      },
      statusCode: {
        private: true,
        type: 'integer',
        minimum: 100,
        maximum: 999,
      },
      has: hasSchema,
    },
  },
} as const;

export const headersSchema = {
  type: 'array',
  maxItems: 1024,
  description: 'A list of header definitions.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['source', 'headers'],
    properties: {
      source: {
        description:
          'A pattern that matches each incoming pathname (excluding querystring)',
        type: 'string',
        maxLength: 4096,
      },
      headers: {
        description:
          'An array of key/value pairs representing each response header.',
        type: 'array',
        maxItems: 1024,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'value'],
          properties: {
            key: {
              type: 'string',
              maxLength: 4096,
            },
            value: {
              type: 'string',
              maxLength: 4096,
            },
          },
        },
      },
      has: hasSchema,
    },
  },
} as const;

export const cleanUrlsSchema = {
  description:
    'When set to `true`, all HTML files and Serverless Functions will have their extension removed. When visiting a path that ends with the extension, a 308 response will redirect the client to the extensionless path.',
  type: 'boolean',
} as const;

export const trailingSlashSchema = {
  description:
    'When `false`, visiting a path that ends with a forward slash will respond with a `308` status code and redirect to the path without the trailing slash.',
  type: 'boolean',
} as const;
