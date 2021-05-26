const { deepStrictEqual } = require('assert');
const { mergeRoutes } = require('../dist/merge');

test('mergeRoutes simple', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1' },
    { src: '/user2', dest: '/u2' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1' },
        { src: '/node2', dest: '/n2' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1' },
        { src: '/python2', dest: '/py2' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { dest: '/u1', src: '/user1' },
    { dest: '/u2', src: '/user2' },
    { dest: '/n1', src: '/node1' },
    { dest: '/n2', src: '/node2' },
    { dest: '/py1', src: '/python1' },
    { dest: '/py2', src: '/python2' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes handle filesystem user routes', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1' },
    { handle: 'filesystem' },
    { src: '/user2', dest: '/u2' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1' },
        { src: '/node2', dest: '/n2' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1' },
        { src: '/python2', dest: '/py2' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { dest: '/u1', src: '/user1' },
    { dest: '/n1', src: '/node1' },
    { dest: '/n2', src: '/node2' },
    { dest: '/py1', src: '/python1' },
    { dest: '/py2', src: '/python2' },
    { handle: 'filesystem' },
    { dest: '/u2', src: '/user2' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes handle filesystem build routes', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1' },
    { src: '/user2', dest: '/u2' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1' },
        { handle: 'filesystem' },
        { src: '/node2', dest: '/n2' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1' },
        { handle: 'filesystem' },
        { src: '/python2', dest: '/py2' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { dest: '/u1', src: '/user1' },
    { dest: '/u2', src: '/user2' },
    { dest: '/n1', src: '/node1' },
    { dest: '/py1', src: '/python1' },
    { handle: 'filesystem' },
    { dest: '/n2', src: '/node2' },
    { dest: '/py2', src: '/python2' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes handle filesystem both user and builds', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1' },
    { handle: 'filesystem' },
    { src: '/user2', dest: '/u2' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1' },
        { handle: 'filesystem' },
        { src: '/node2', dest: '/n2' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1' },
        { handle: 'filesystem' },
        { src: '/python2', dest: '/py2' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { dest: '/u1', src: '/user1' },
    { dest: '/n1', src: '/node1' },
    { dest: '/py1', src: '/python1' },
    { handle: 'filesystem' },
    { dest: '/u2', src: '/user2' },
    { dest: '/n2', src: '/node2' },
    { dest: '/py2', src: '/python2' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes continue true', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1' },
    { src: '/user2', dest: '/u2', continue: true },
    { src: '/user3', dest: '/u3' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1' },
        { src: '/node3', dest: '/n2', continue: true },
        { src: '/node3', dest: '/n3' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1' },
        { src: '/python2', dest: '/py2', continue: true },
        { src: '/python3', dest: '/py3' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { continue: true, dest: '/n2', src: '/node3' },
    { continue: true, dest: '/py2', src: '/python2' },
    { dest: '/u1', src: '/user1' },
    { continue: true, dest: '/u2', src: '/user2' },
    { dest: '/u3', src: '/user3' },
    { dest: '/n1', src: '/node1' },
    { dest: '/n3', src: '/node3' },
    { dest: '/py1', src: '/python1' },
    { dest: '/py3', src: '/python3' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes check true', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1' },
    { src: '/user2', dest: '/u2' },
    { src: '/user3', dest: '/u3' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1' },
        { src: '/node3', dest: '/n2', check: true },
        { src: '/node3', dest: '/n3' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1' },
        { src: '/python2', dest: '/py2', check: true },
        { src: '/python3', dest: '/py3' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { dest: '/u1', src: '/user1' },
    { dest: '/u2', src: '/user2' },
    { dest: '/u3', src: '/user3' },
    { check: true, dest: '/n2', src: '/node3' },
    { check: true, dest: '/py2', src: '/python2' },
    { dest: '/n1', src: '/node1' },
    { dest: '/n3', src: '/node3' },
    { dest: '/py1', src: '/python1' },
    { dest: '/py3', src: '/python3' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes check true, continue true, handle filesystem middle', () => {
  const userRoutes = [
    { src: '/user1', dest: '/u1', continue: true },
    { src: '/user2', dest: '/u2' },
    { handle: 'filesystem' },
    { src: '/user3', dest: '/u3' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { src: '/node1', dest: '/n1', continue: true },
        { src: '/node3', dest: '/n2', check: true },
        { handle: 'filesystem' },
        { src: '/node3', dest: '/n3' },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { src: '/python1', dest: '/py1', check: true },
        { src: '/python2', dest: '/py2', continue: true },
        { handle: 'filesystem' },
        { src: '/python3', dest: '/py3' },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { continue: true, dest: '/n1', src: '/node1' },
    { continue: true, dest: '/py2', src: '/python2' },
    { continue: true, dest: '/u1', src: '/user1' },
    { dest: '/u2', src: '/user2' },
    { check: true, dest: '/n2', src: '/node3' },
    { check: true, dest: '/py1', src: '/python1' },
    { handle: 'filesystem' },
    { dest: '/u3', src: '/user3' },
    { dest: '/n3', src: '/node3' },
    { dest: '/py3', src: '/python3' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes check true, continue true, handle filesystem top', () => {
  const userRoutes = [{ handle: 'filesystem' }, { src: '/user1', dest: '/u1' }];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { handle: 'filesystem' },
        { src: '/node1', dest: '/n1' },
        { src: '/node2', dest: '/n2', continue: true },
        { src: '/node3', dest: '/n3', check: true },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { handle: 'filesystem' },
        { src: '/python1', dest: '/py1' },
        { src: '/python2', dest: '/py2', check: true },
        { src: '/python3', dest: '/py3', continue: true },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { handle: 'filesystem' },
    { continue: true, dest: '/n2', src: '/node2' },
    { continue: true, dest: '/py3', src: '/python3' },
    { dest: '/u1', src: '/user1' },
    { check: true, dest: '/n3', src: '/node3' },
    { check: true, dest: '/py2', src: '/python2' },
    { dest: '/n1', src: '/node1' },
    { dest: '/py1', src: '/python1' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes multiple handle values', () => {
  const userRoutes = [
    { handle: 'filesystem' },
    { src: '/user1', dest: '/u1' },
    { handle: 'miss' },
    { src: '/user2', dest: '/u2' },
    { handle: 'hit' },
    { src: '/user3', dest: '/u3' },
  ];
  const builds = [
    {
      use: '@vercel/node',
      entrypoint: 'api/home.js',
      routes: [
        { handle: 'filesystem' },
        { src: '/node1', dest: '/n1' },
        { handle: 'hit' },
        { src: '/node2', dest: '/n2', continue: true },
        { handle: 'miss' },
        { src: '/node3', dest: '/n3', check: true },
      ],
    },
    {
      use: '@vercel/python',
      entrypoint: 'api/users.py',
      routes: [
        { handle: 'filesystem' },
        { src: '/python1', dest: '/py1' },
        { handle: 'hit' },
        { src: '/python2', dest: '/py2', check: true },
        { handle: 'miss' },
        { src: '/python3', dest: '/py3', continue: true },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { handle: 'filesystem' },
    { dest: '/u1', src: '/user1' },
    { dest: '/n1', src: '/node1' },
    { dest: '/py1', src: '/python1' },
    { handle: 'miss' },
    { continue: true, dest: '/py3', src: '/python3' },
    { dest: '/u2', src: '/user2' },
    { check: true, dest: '/n3', src: '/node3' },
    { handle: 'hit' },
    { continue: true, dest: '/n2', src: '/node2' },
    { dest: '/u3', src: '/user3' },
    { check: true, dest: '/py2', src: '/python2' },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes ensure `handle: error` comes last', () => {
  const userRoutes = [];
  const builds = [
    {
      use: '@vercel/static-build',
      entrypoint: 'packge.json',
      routes: [
        {
          src: '^/home$',
          status: 301,
          headers: {
            Location: '/',
          },
        },
      ],
    },
    {
      use: '@vercel/zero-config-routes',
      entrypoint: '/',
      routes: [
        {
          handle: 'error',
        },
        {
          status: 404,
          src: '^/(?!.*api).*$',
          dest: '404.html',
        },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    {
      status: 301,
      src: '^/home$',
      headers: {
        Location: '/',
      },
    },
    {
      handle: 'error',
    },
    {
      status: 404,
      src: '^/(?!.*api).*$',
      dest: '404.html',
    },
  ];
  deepStrictEqual(actual, expected);
});

test('mergeRoutes ensure beforeFiles comes after redirects', () => {
  const userRoutes = [];
  const builds = [
    {
      use: '@vercel/next',
      entrypoint: 'package.json',
      routes: [
        {
          src: '^/home$',
          status: 301,
          headers: {
            Location: '/',
          },
        },
        {
          src: '^/hello$',
          dest: '/somewhere',
          continue: true,
          override: true,
        },
        {
          handle: 'filesystem',
        },
        {
          src: '^/404$',
          dest: '/404',
          status: 404,
          check: true,
        },
      ],
    },
  ];
  const actual = mergeRoutes({ userRoutes, builds });
  const expected = [
    { src: '^/home$', status: 301, headers: { Location: '/' } },
    {
      src: '^/hello$',
      dest: '/somewhere',
      continue: true,
      override: true,
    },
    { handle: 'filesystem' },
    { src: '^/404$', dest: '/404', status: 404, check: true },
  ];
  deepStrictEqual(actual, expected);
});
