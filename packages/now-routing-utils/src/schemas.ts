/**
 * An ajv schema for the routes array
 */
export const routesSchema = {
  type: 'array',
  maxItems: 1024,
  items: {
    type: 'object',
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
      methods: {
        type: 'array',
        maxItems: 10,
        items: {
          type: 'string',
          maxLength: 32,
        },
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
      handle: {
        type: 'string',
        maxLength: 32,
      },
      continue: {
        type: 'boolean',
      },
      status: {
        type: 'integer',
        minimum: 100,
        maximum: 999,
      },
    },
  },
};

export const rewritesSchema = {
  type: 'array',
  maxItems: 1024,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: {
        type: 'string',
        maxLength: 4096,
      },
      destination: {
        type: 'string',
        maxLength: 4096,
      },
    },
  },
};

export const redirectsSchema = {
  type: 'array',
  maxItems: 1024,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: {
        type: 'string',
        maxLength: 4096,
      },
      destination: {
        type: 'string',
        maxLength: 4096,
      },
    },
  },
};

export const cleanUrlsSchema = {
  type: 'boolean',
};

export const trailingSlashSchema = {
  type: 'boolean',
};
