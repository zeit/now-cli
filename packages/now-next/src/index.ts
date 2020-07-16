import buildUtils from './build-utils';
import url from 'url';
const {
  createLambda,
  debug,
  download,
  getLambdaOptionsFromFunction,
  getNodeVersion,
  getSpawnOptions,
  glob,
  runNpmInstall,
  runPackageJsonScript,
  execCommand,
  getNodeBinPath,
} = buildUtils;

import {
  BuildOptions,
  Config,
  FileBlob,
  FileFsRef,
  Files,
  Lambda,
  NowBuildError,
  PackageJson,
  PrepareCacheOptions,
  Prerender,
} from '@vercel/build-utils';
import { Handler, Route } from '@vercel/routing-utils';
import {
  convertHeaders,
  convertRedirects,
  convertRewrites,
} from '@vercel/routing-utils/dist/superstatic';
import nodeFileTrace, { NodeFileTraceReasons } from '@zeit/node-file-trace';
import { ChildProcess, fork } from 'child_process';
import escapeStringRegexp from 'escape-string-regexp';
import {
  lstat,
  pathExists,
  readFile,
  unlink as unlinkFile,
  writeFile,
} from 'fs-extra';
import os from 'os';
import path from 'path';
import resolveFrom from 'resolve-from';
import semver from 'semver';
import createServerlessConfig from './create-serverless-config';
import nextLegacyVersions from './legacy-versions';
import {
  createLambdaFromPseudoLayers,
  createPseudoLayer,
  EnvConfig,
  excludeFiles,
  ExperimentalTraceVersion,
  getDynamicRoutes,
  getExportIntent,
  getExportStatus,
  getNextConfig,
  getPathsInside,
  getPrerenderManifest,
  getRoutes,
  getRoutesManifest,
  getSourceFilePathFromPage,
  isDynamicRoute,
  normalizePackageJson,
  normalizePage,
  PseudoLayer,
  stringMap,
  syncEnvVars,
  validateEntrypoint,
} from './utils';
import findUp from 'find-up';
import { Sema } from 'async-sema';

interface BuildParamsMeta {
  isDev: boolean | undefined;
  env?: EnvConfig;
  buildEnv?: EnvConfig;
}

interface BuildParamsType extends BuildOptions {
  files: Files;
  entrypoint: string;
  workPath: string;
  meta: BuildParamsMeta;
}

export const version = 2;
const htmlContentType = 'text/html; charset=utf-8';
const nowDevChildProcesses = new Set<ChildProcess>();

['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.once(signal as NodeJS.Signals, () => {
    for (const child of nowDevChildProcesses) {
      debug(
        `Got ${signal}, killing dev server child process (pid=${child.pid})`
      );
      process.kill(child.pid, signal);
    }
    process.exit(0);
  });
});

const MAX_AGE_ONE_YEAR = 31536000;

/**
 * Read package.json from files
 */
async function readPackageJson(
  entryPath: string
): Promise<{
  scripts?: { [key: string]: string };
  dependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
}> {
  const packagePath = path.join(entryPath, 'package.json');

  try {
    return JSON.parse(await readFile(packagePath, 'utf8'));
  } catch (err) {
    debug('package.json not found in entry');
    return {};
  }
}

/**
 * Write package.json
 */
async function writePackageJson(workPath: string, packageJson: PackageJson) {
  await writeFile(
    path.join(workPath, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
}

/**
 * Write .npmrc with npm auth token
 */
async function writeNpmRc(workPath: string, token: string) {
  await writeFile(
    path.join(workPath, '.npmrc'),
    `//registry.npmjs.org/:_authToken=${token}`
  );
}

/**
 * Get the installed Next version.
 */
function getRealNextVersion(entryPath: string): string | false {
  try {
    // First try to resolve the `next` dependency and get the real version from its
    // package.json. This allows the builder to be used with frameworks like Blitz that
    // bundle Next but where Next isn't in the project root's package.json
    const nextVersion: string = require(resolveFrom(
      entryPath,
      'next/package.json'
    )).version;
    debug(`Detected Next.js version: ${nextVersion}`);
    return nextVersion;
  } catch (_ignored) {
    debug(
      `Could not identify real Next.js version, ensure it is defined as a project dependency.`
    );
    return false;
  }
}

/**
 * Get the package.json Next version.
 */
async function getNextVersionRange(entryPath: string): Promise<string | false> {
  let nextVersion: string | false = false;
  const pkg = await readPackageJson(entryPath);
  if (pkg.dependencies && pkg.dependencies.next) {
    nextVersion = pkg.dependencies.next;
  } else if (pkg.devDependencies && pkg.devDependencies.next) {
    nextVersion = pkg.devDependencies.next;
  }
  return nextVersion;
}

function isLegacyNext(nextVersion: string) {
  // If version is using the dist-tag instead of a version range
  if (nextVersion === 'canary' || nextVersion === 'latest') {
    return false;
  }

  // If the version is an exact match with the legacy versions
  if (nextLegacyVersions.indexOf(nextVersion) !== -1) {
    return true;
  }

  const maxSatisfying = semver.maxSatisfying(nextLegacyVersions, nextVersion);
  // When the version can't be matched with legacy versions, so it must be a newer version
  if (maxSatisfying === null) {
    return false;
  }

  return true;
}

const name = '[@vercel/next]';
const urls: stringMap = {};

function startDevServer(entryPath: string, runtimeEnv: EnvConfig) {
  // `env` is omitted since that makes it default to `process.env`
  const forked = fork(path.join(__dirname, 'dev-server.js'), [], {
    cwd: entryPath,
    execArgv: [],
  });

  const getUrl = () =>
    new Promise<string>((resolve, reject) => {
      forked.once('message', resolve);
      forked.once('error', reject);
    });

  forked.send({ dir: entryPath, runtimeEnv });

  return { forked, getUrl };
}

export const build = async ({
  files,
  workPath,
  entrypoint,
  config = {} as Config,
  meta = {} as BuildParamsMeta,
}: BuildParamsType): Promise<{
  routes: Route[];
  output: Files;
  watch?: string[];
  childProcesses: ChildProcess[];
}> => {
  validateEntrypoint(entrypoint);

  // Limit for max size each lambda can be, 50 MB if no custom limit
  const lambdaCompressedByteLimit = config.maxLambdaSize || 50 * 1000 * 1000;

  let entryDirectory = path.dirname(entrypoint);
  const entryPath = path.join(workPath, entryDirectory);
  const outputDirectory = config.outputDirectory || '.next';
  const dotNextStatic = path.join(entryPath, outputDirectory, 'static');

  await download(files, workPath, meta);

  const pkg = await readPackageJson(entryPath);
  const nextVersionRange = await getNextVersionRange(entryPath);
  const nodeVersion = await getNodeVersion(entryPath, undefined, config, meta);
  const spawnOpts = getSpawnOptions(meta, nodeVersion);

  const nowJsonPath = await findUp(['now.json', 'vercel.json'], {
    cwd: path.join(workPath, path.dirname(entrypoint)),
  });

  let hasLegacyRoutes = false;
  const hasFunctionsConfig = !!config.functions;

  if (nowJsonPath) {
    const nowJsonData = JSON.parse(await readFile(nowJsonPath, 'utf8'));

    if (Array.isArray(nowJsonData.routes) && nowJsonData.routes.length > 0) {
      hasLegacyRoutes = true;
      console.warn(
        `WARNING: your application is being opted out of @vercel/next's optimized lambdas mode due to legacy routes in ${path.basename(
          nowJsonPath
        )}. http://err.sh/vercel/vercel/next-legacy-routes-optimized-lambdas`
      );
    }
  }

  if (hasFunctionsConfig) {
    console.warn(
      `WARNING: Your application is being opted out of "@vercel/next" optimized lambdas mode due to \`functions\` config.\nMore info: http://err.sh/vercel/vercel/next-functions-config-optimized-lambdas`
    );
  }

  // default to true but still allow opting out with the config
  const isSharedLambdas =
    !hasLegacyRoutes &&
    !hasFunctionsConfig &&
    typeof config.sharedLambdas === 'undefined'
      ? true
      : !!config.sharedLambdas;

  if (meta.isDev) {
    let childProcess: ChildProcess | undefined;

    // If this is the initial build, we want to start the server
    if (!urls[entrypoint]) {
      if (!process.env.NODE_ENV) {
        process.env.NODE_ENV = 'development';
      }

      // The runtime env vars consist of the base `process.env` vars, but with the
      // build env vars removed, and the runtime env vars mixed in afterwards
      const runtimeEnv: EnvConfig = Object.assign({}, process.env);
      syncEnvVars(runtimeEnv, meta.buildEnv || {}, meta.env || {});

      const { forked, getUrl } = startDevServer(entryPath, runtimeEnv);
      urls[entrypoint] = await getUrl();
      childProcess = forked;
      nowDevChildProcesses.add(forked);
      debug(
        `${name} Development server for ${entrypoint} running at ${urls[entrypoint]}`
      );
    }

    const pathsInside = getPathsInside(entryDirectory, files);

    return {
      output: {},
      routes: await getRoutes(
        entryPath,
        entryDirectory,
        pathsInside,
        files,
        urls[entrypoint]
      ),
      watch: pathsInside,
      childProcesses: childProcess ? [childProcess] : [],
    };
  }

  if (await pathExists(dotNextStatic)) {
    console.warn('WARNING: You should not upload the `.next` directory.');
  }

  const isLegacy = nextVersionRange && isLegacyNext(nextVersionRange);
  let shouldRunScript = 'now-build';

  debug(`MODE: ${isLegacy ? 'legacy' : 'serverless'}`);

  if (isLegacy) {
    try {
      await unlinkFile(path.join(entryPath, 'yarn.lock'));
    } catch (err) {
      debug('no yarn.lock removed');
    }

    try {
      await unlinkFile(path.join(entryPath, 'package-lock.json'));
    } catch (err) {
      debug('no package-lock.json removed');
    }

    console.warn(
      "WARNING: your application is being deployed in @vercel/next's legacy mode. http://err.sh/vercel/vercel/now-next-legacy-mode"
    );

    debug('Normalizing package.json');
    const packageJson = normalizePackageJson(pkg);
    debug('Normalized package.json result: ', packageJson);
    await writePackageJson(entryPath, packageJson);
  } else if (pkg.scripts && pkg.scripts['now-build']) {
    debug('Found user `now-build` script');
    shouldRunScript = 'now-build';
  } else if (pkg.scripts && pkg.scripts['build']) {
    debug('Found user `build` script');
    shouldRunScript = 'build';
  } else if (!pkg.scripts || !pkg.scripts['now-build']) {
    debug(
      'Your application is being built using `next build`. ' +
        'If you need to define a different build step, please create a `now-build` script in your `package.json` ' +
        '(e.g. `{ "scripts": { "now-build": "npm run prepare && next build" } }`).'
    );
    pkg.scripts = {
      'now-build': 'next build',
      ...(pkg.scripts || {}),
    };
    shouldRunScript = 'now-build';
    await writePackageJson(entryPath, pkg);
  }

  if (process.env.NPM_AUTH_TOKEN) {
    debug('Found NPM_AUTH_TOKEN in environment, creating .npmrc');
    await writeNpmRc(entryPath, process.env.NPM_AUTH_TOKEN);
  }

  console.log('Installing dependencies...');
  await runNpmInstall(entryPath, ['--prefer-offline'], spawnOpts, meta);

  // Refetch Next version now that dependencies are installed.
  // This will now resolve the actual installed Next version,
  // even if Next isn't in the project package.json
  const nextVersion = getRealNextVersion(entryPath);
  if (!nextVersion) {
    throw new NowBuildError({
      code: 'NEXT_NO_VERSION',
      message:
        'No Next.js version could be detected in your project. Make sure `"next"` is installed in "dependencies" or "devDependencies"',
    });
  }

  if (!isLegacy) {
    await createServerlessConfig(workPath, entryPath, nextVersion);
  }

  debug('Running user script...');
  const memoryToConsume = Math.floor(os.totalmem() / 1024 ** 2) - 128;
  const env: { [key: string]: string | undefined } = { ...spawnOpts.env };
  env.NODE_OPTIONS = `--max_old_space_size=${memoryToConsume}`;

  if (config.buildCommand) {
    // Add `node_modules/.bin` to PATH
    const nodeBinPath = await getNodeBinPath({ cwd: entryPath });
    env.PATH = `${nodeBinPath}${path.delimiter}${env.PATH}`;

    debug(
      `Added "${nodeBinPath}" to PATH env because a build command was used.`
    );

    console.log(`Running "${config.buildCommand}"`);
    await execCommand(config.buildCommand, {
      ...spawnOpts,
      cwd: entryPath,
      env,
    });
  } else {
    await runPackageJsonScript(entryPath, shouldRunScript, {
      ...spawnOpts,
      env,
    });
  }

  const appMountPrefixNoTrailingSlash = path.posix
    .join('/', entryDirectory)
    .replace(/\/+$/, '');

  const routesManifest = await getRoutesManifest(
    entryPath,
    outputDirectory,
    nextVersion
  );
  const prerenderManifest = await getPrerenderManifest(entryPath);
  const headers: Route[] = [];
  const rewrites: Route[] = [];
  const redirects: Route[] = [];
  const dataRoutes: Route[] = [];
  let dynamicRoutes: Route[] = [];
  // whether they have enabled pages/404.js as the custom 404 page
  let hasPages404 = false;

  if (routesManifest) {
    switch (routesManifest.version) {
      case 1:
      case 2:
      case 3: {
        redirects.push(...convertRedirects(routesManifest.redirects));
        rewrites.push(...convertRewrites(routesManifest.rewrites));

        if (routesManifest.headers) {
          headers.push(...convertHeaders(routesManifest.headers));
        }

        if (routesManifest.dataRoutes) {
          // Load the /_next/data routes for both dynamic SSG and SSP pages.
          // These must be combined and sorted to prevent conflicts
          for (const dataRoute of routesManifest.dataRoutes) {
            const ssgDataRoute =
              prerenderManifest.fallbackRoutes[dataRoute.page] ||
              prerenderManifest.legacyBlockingRoutes[dataRoute.page];

            // we don't need to add routes for non-lazy SSG routes since
            // they have outputs which would override the routes anyways
            if (
              prerenderManifest.staticRoutes[dataRoute.page] ||
              prerenderManifest.omittedRoutes.includes(dataRoute.page)
            ) {
              continue;
            }

            dataRoutes.push({
              src: (
                dataRoute.namedDataRouteRegex || dataRoute.dataRouteRegex
              ).replace(/^\^/, `^${appMountPrefixNoTrailingSlash}`),
              dest: path.join(
                '/',
                entryDirectory,
                // make sure to route SSG data route to the data prerender
                // output, we don't do this for SSP routes since they don't
                // have a separate data output
                `${(ssgDataRoute && ssgDataRoute.dataRoute) || dataRoute.page}${
                  dataRoute.routeKeys
                    ? `?${Object.keys(dataRoute.routeKeys)
                        .map((key) => `${dataRoute.routeKeys![key]}=$${key}`)
                        .join('&')}`
                    : ''
                }`
              ),
              check: true,
            });
          }
        }

        if (routesManifest.pages404) {
          hasPages404 = true;
        }

        if (routesManifest.basePath && routesManifest.basePath !== '/') {
          const nextBasePath = routesManifest.basePath;

          if (!nextBasePath.startsWith('/')) {
            throw new NowBuildError({
              code: 'NEXT_BASEPATH_STARTING_SLASH',
              message:
                'basePath must start with `/`. Please upgrade your `@vercel/next` builder and try again. Contact support if this continues to happen.',
            });
          }
          if (nextBasePath.endsWith('/')) {
            throw new NowBuildError({
              code: 'NEXT_BASEPATH_TRAILING_SLASH',
              message:
                'basePath must not end with `/`. Please upgrade your `@vercel/next` builder and try again. Contact support if this continues to happen.',
            });
          }

          entryDirectory = path.join(entryDirectory, nextBasePath);
        }
        break;
      }
      default: {
        // update MIN_ROUTES_MANIFEST_VERSION in ./utils.ts
        throw new NowBuildError({
          code: 'NEXT_VERSION_OUTDATED',
          message:
            'This version of `@vercel/next` does not support the version of Next.js you are trying to deploy.\n' +
            'Please upgrade your `@vercel/next` builder and try again. Contact support if this continues to happen.',
        });
      }
    }
  }

  const userExport = await getExportStatus(entryPath);

  if (userExport) {
    const exportIntent = await getExportIntent(entryPath);
    const { trailingSlash = false } = exportIntent || {};

    const resultingExport = await getExportStatus(entryPath);
    if (!resultingExport) {
      throw new NowBuildError({
        code: 'NEXT_EXPORT_FAILED',
        message:
          'Exporting Next.js app failed. Please check your build logs and contact us if this continues.',
      });
    }

    if (resultingExport.success !== true) {
      throw new NowBuildError({
        code: 'NEXT_EXPORT_FAILED',
        message: 'Export of Next.js app failed. Please check your build logs.',
      });
    }

    const outDirectory = resultingExport.outDirectory;

    debug(`next export should use trailing slash: ${trailingSlash}`);

    // This handles pages, `public/`, and `static/`.
    const filesAfterBuild = await glob('**', outDirectory);

    const output: Files = { ...filesAfterBuild };

    // Strip `.html` extensions from build output
    Object.entries(output)
      .filter(([name]) => name.endsWith('.html'))
      .forEach(([name, value]) => {
        const cleanName = name.slice(0, -5);
        delete output[name];
        output[cleanName] = value;
        if (value.type === 'FileBlob' || value.type === 'FileFsRef') {
          value.contentType = value.contentType || 'text/html; charset=utf-8';
        }
      });

    return {
      output,
      routes: [
        // TODO: low priority: handle trailingSlash

        // User headers
        ...headers,

        // User redirects
        ...redirects,

        // Make sure to 404 for the /404 path itself
        {
          src: path.join('/', entryDirectory, '404'),
          status: 404,
          continue: true,
        },

        // Next.js pages, `static/` folder, reserved assets, and `public/`
        // folder
        { handle: 'filesystem' },

        // These need to come before handle: miss or else they are grouped
        // with that routing section
        ...rewrites,

        // We need to make sure to 404 for /_next after handle: miss since
        // handle: miss is called before rewrites and to prevent rewriting
        // /_next
        { handle: 'miss' },
        {
          src: path.join(
            '/',
            entryDirectory,
            '_next/static/(?:[^/]+/pages|pages|chunks|runtime|css|media)/.+'
          ),
          status: 404,
          check: true,
          dest: '$0',
        },

        // Dynamic routes
        // TODO: do we want to do this?: ...dynamicRoutes,
        // (if so make sure to add any dynamic routes after handle: 'rewrite' )

        // routes to call after a file has been matched
        { handle: 'hit' },
        // Before we handle static files we need to set proper caching headers
        {
          // This ensures we only match known emitted-by-Next.js files and not
          // user-emitted files which may be missing a hash in their filename.
          src: path.join(
            '/',
            entryDirectory,
            '_next/static/(?:[^/]+/pages|pages|chunks|runtime|css|media)/.+'
          ),
          // Next.js assets contain a hash or entropy in their filenames, so they
          // are guaranteed to be unique and cacheable indefinitely.
          headers: {
            'cache-control': `public,max-age=${MAX_AGE_ONE_YEAR},immutable`,
          },
          continue: true,
        },

        // error handling
        ...(output[path.join('./', entryDirectory, '404')]
          ? [
              { handle: 'error' } as Handler,

              {
                status: 404,
                src: path.join(entryDirectory, '.*'),
                dest: path.join('/', entryDirectory, '404'),
              },
            ]
          : []),
      ],
      watch: [],
      childProcesses: [],
    };
  }

  if (isLegacy) {
    debug('Running npm install --production...');
    await runNpmInstall(
      entryPath,
      ['--prefer-offline', '--production'],
      spawnOpts,
      meta
    );
  }

  if (process.env.NPM_AUTH_TOKEN) {
    await unlinkFile(path.join(entryPath, '.npmrc'));
  }

  const pageLambdaRoutes: Route[] = [];
  const dynamicPageLambdaRoutes: Route[] = [];
  const dynamicPageLambdaRoutesMap: { [page: string]: Route } = {};
  const pageLambdaMap: { [page: string]: string } = {};

  const lambdas: { [key: string]: Lambda } = {};
  const prerenders: { [key: string]: Prerender | FileFsRef } = {};
  const staticPages: { [key: string]: FileFsRef } = {};
  const dynamicPages: string[] = [];
  let static404Page: string | undefined;
  let buildId = '';
  let page404Path = '';
  let escapedBuildId = '';

  if (isLegacy || isSharedLambdas) {
    try {
      buildId = await readFile(
        path.join(entryPath, outputDirectory, 'BUILD_ID'),
        'utf8'
      );
      escapedBuildId = escapeStringRegexp(buildId);
    } catch (err) {
      console.error(
        'BUILD_ID not found in ".next". The "package.json" "build" script did not run "next build"'
      );
      throw new NowBuildError({
        code: 'NOW_NEXT_NO_BUILD_ID',
        message: 'Missing BUILD_ID',
      });
    }
  }

  if (isLegacy) {
    const filesAfterBuild = await glob('**', entryPath);

    debug('Preparing serverless function files...');

    const dotNextRootFiles = await glob(`${outputDirectory}/*`, entryPath);
    const dotNextServerRootFiles = await glob(
      `${outputDirectory}/server/*`,
      entryPath
    );
    const nodeModules = excludeFiles(
      await glob('node_modules/**', entryPath),
      (file) => file.startsWith('node_modules/.cache')
    );
    const launcherFiles = {
      'now__bridge.js': new FileFsRef({
        fsPath: path.join(__dirname, 'now__bridge.js'),
      }),
    };
    const nextFiles: { [key: string]: FileFsRef } = {
      ...nodeModules,
      ...dotNextRootFiles,
      ...dotNextServerRootFiles,
      ...launcherFiles,
    };
    if (filesAfterBuild['next.config.js']) {
      nextFiles['next.config.js'] = filesAfterBuild['next.config.js'];
    }
    const pagesDir = path.join(
      entryPath,
      outputDirectory,
      'server',
      'static',
      buildId,
      'pages'
    );
    const pages = await glob('**/*.js', pagesDir);
    const launcherPath = path.join(__dirname, 'legacy-launcher.js');
    const launcherData = await readFile(launcherPath, 'utf8');

    await Promise.all(
      Object.keys(pages).map(async (page) => {
        // These default pages don't have to be handled as they'd always 404
        if (['_app.js', '_error.js', '_document.js'].includes(page)) {
          return;
        }

        const pathname = page.replace(/\.js$/, '');
        const launcher = launcherData.replace(
          'PATHNAME_PLACEHOLDER',
          `/${pathname.replace(/(^|\/)index$/, '')}`
        );

        const pageFiles = {
          [`${outputDirectory}/server/static/${buildId}/pages/_document.js`]: filesAfterBuild[
            `${outputDirectory}/server/static/${buildId}/pages/_document.js`
          ],
          [`${outputDirectory}/server/static/${buildId}/pages/_app.js`]: filesAfterBuild[
            `${outputDirectory}/server/static/${buildId}/pages/_app.js`
          ],
          [`${outputDirectory}/server/static/${buildId}/pages/_error.js`]: filesAfterBuild[
            `${outputDirectory}/server/static/${buildId}/pages/_error.js`
          ],
          [`${outputDirectory}/server/static/${buildId}/pages/${page}`]: filesAfterBuild[
            `${outputDirectory}/server/static/${buildId}/pages/${page}`
          ],
        };

        const lambdaOptions = await getLambdaOptionsFromFunction({
          sourceFile: await getSourceFilePathFromPage({ workPath, page }),
          config,
        });

        debug(`Creating serverless function for page: "${page}"...`);
        lambdas[path.join(entryDirectory, pathname)] = await createLambda({
          files: {
            ...nextFiles,
            ...pageFiles,
            'now__launcher.js': new FileBlob({ data: launcher }),
          },
          handler: 'now__launcher.launcher',
          runtime: nodeVersion.runtime,
          ...lambdaOptions,
        });
        debug(`Created serverless function for page: "${page}"`);
      })
    );
  } else {
    debug('Preparing serverless function files...');
    const pagesDir = path.join(
      entryPath,
      outputDirectory,
      'serverless',
      'pages'
    );

    const pages = await glob('**/*.js', pagesDir);
    const staticPageFiles = await glob('**/*.html', pagesDir);

    Object.keys(staticPageFiles).forEach((page: string) => {
      const pathname = page.replace(/\.html$/, '');
      const routeName = normalizePage(pathname);

      // Prerendered routes emit a `.html` file but should not be treated as a
      // static page.
      // Lazily prerendered routes have a fallback `.html` file on newer
      // Next.js versions so we need to also not treat it as a static page here.
      if (
        prerenderManifest.staticRoutes[routeName] ||
        prerenderManifest.fallbackRoutes[routeName]
      ) {
        return;
      }

      const staticRoute = path.join(entryDirectory, pathname);

      staticPages[staticRoute] = staticPageFiles[page];
      staticPages[staticRoute].contentType = htmlContentType;

      if (isDynamicRoute(pathname)) {
        dynamicPages.push(routeName);
        return;
      }
    });

    // this can be either 404.html in latest versions
    // or _errors/404.html versions while this was experimental
    static404Page =
      staticPages[path.join(entryDirectory, '404')] && hasPages404
        ? path.join(entryDirectory, '404')
        : staticPages[path.join(entryDirectory, '_errors/404')]
        ? path.join(entryDirectory, '_errors/404')
        : undefined;

    // > 1 because _error is a lambda but isn't used if a static 404 is available
    const pageKeys = Object.keys(pages);
    const hasLambdas = !static404Page || pageKeys.length > 1;

    if (pageKeys.length === 0) {
      const nextConfig = await getNextConfig(workPath, entryPath);

      if (nextConfig != null) {
        console.info('Found next.config.js:');
        console.info(nextConfig);
        console.info();
      }

      throw new NowBuildError({
        code: 'NEXT_NO_SERVERLESS_PAGES',
        message: 'No serverless pages were built',
        link: 'https://err.sh/vercel/vercel/now-next-no-serverless-pages-built',
      });
    }

    // Assume tracing to be safe, bail if we know we don't need it.
    let requiresTracing = hasLambdas;
    try {
      if (nextVersion && semver.lt(nextVersion, ExperimentalTraceVersion)) {
        debug(
          'Next.js version is too old for us to trace the required dependencies.\n' +
            'Assuming Next.js has handled it!'
        );
        requiresTracing = false;
      }
    } catch (err) {
      console.log(
        'Failed to check Next.js version for tracing compatibility: ' + err
      );
    }

    let assets:
      | undefined
      | {
          [filePath: string]: FileFsRef;
        };

    let canUsePreviewMode = false;
    let pseudoLayerBytes = 0;
    let apiPseudoLayerBytes = 0;
    const pseudoLayers: PseudoLayer[] = [];
    const apiPseudoLayers: PseudoLayer[] = [];

    const isApiPage = (page: string) =>
      page.replace(/\\/g, '/').match(/serverless\/pages\/api/);

    const tracedFiles: {
      [filePath: string]: FileFsRef;
    } = {};
    const apiTracedFiles: {
      [filePath: string]: FileFsRef;
    } = {};

    if (requiresTracing) {
      const tracingLabel =
        'Traced Next.js serverless functions for external files in';
      console.time(tracingLabel);

      const apiPages: string[] = [];
      const nonApiPages: string[] = [];
      const allPagePaths = Object.keys(pages).map((page) => pages[page].fsPath);

      for (const page of allPagePaths) {
        if (isApiPage(page)) {
          apiPages.push(page);
          canUsePreviewMode = true;
        } else {
          nonApiPages.push(page);
        }
      }

      const {
        fileList: apiFileList,
        reasons: apiReasons,
      } = await nodeFileTrace(apiPages, { base: workPath });

      const {
        fileList,
        reasons: nonApiReasons,
      } = await nodeFileTrace(nonApiPages, { base: workPath });

      debug(`node-file-trace result for pages: ${fileList}`);

      const lstatSema = new Sema(25, {
        capacity: fileList.length + apiFileList.length,
      });
      const lstatResults: { [key: string]: ReturnType<typeof lstat> } = {};

      const collectTracedFiles = (
        reasons: NodeFileTraceReasons,
        files: { [filePath: string]: FileFsRef }
      ) => async (file: string) => {
        const reason = reasons[file];
        if (reason && reason.type === 'initial') {
          // Initial files are manually added to the lambda later
          return;
        }
        const filePath = path.join(workPath, file);

        if (!lstatResults[filePath]) {
          lstatResults[filePath] = lstatSema
            .acquire()
            .then(() => lstat(filePath))
            .finally(() => lstatSema.release());
        }
        const { mode } = await lstatResults[filePath];

        files[file] = new FileFsRef({
          fsPath: path.join(workPath, file),
          mode,
        });
      };

      await Promise.all(
        fileList.map(collectTracedFiles(nonApiReasons, tracedFiles))
      );
      await Promise.all(
        apiFileList.map(collectTracedFiles(apiReasons, apiTracedFiles))
      );
      console.timeEnd(tracingLabel);

      const zippingLabel = 'Compressed shared serverless function files';
      console.time(zippingLabel);

      let pseudoLayer;
      let apiPseudoLayer;
      ({ pseudoLayer, pseudoLayerBytes } = await createPseudoLayer(
        tracedFiles
      ));
      ({
        pseudoLayer: apiPseudoLayer,
        pseudoLayerBytes: apiPseudoLayerBytes,
      } = await createPseudoLayer(apiTracedFiles));

      pseudoLayers.push(pseudoLayer);
      apiPseudoLayers.push(apiPseudoLayer);

      console.timeEnd(zippingLabel);
    } else {
      // An optional assets folder that is placed alongside every page
      // entrypoint.
      // This is a legacy feature that was needed before we began tracing
      // lambdas.
      assets = await glob(
        'assets/**',
        path.join(entryPath, outputDirectory, 'serverless')
      );

      const assetKeys = Object.keys(assets);
      if (assetKeys.length > 0) {
        debug(
          'detected (legacy) assets to be bundled with serverless function:'
        );
        assetKeys.forEach((assetFile) => debug(`\t${assetFile}`));
        debug(
          '\nPlease upgrade to Next.js 9.1 to leverage modern asset handling.'
        );
      }
    }

    const launcherPath = path.join(__dirname, 'templated-launcher.js');
    const launcherData = await readFile(launcherPath, 'utf8');
    const allLambdasLabel = `All serverless functions created in`;

    if (hasLambdas) {
      console.time(allLambdasLabel);
    }

    type LambdaGroup = {
      pages: {
        [outputName: string]: {
          pageName: string;
          pageFileName: string;
          pageLayer: PseudoLayer;
        };
      };
      isApiLambda: boolean;
      lambdaIdentifier: string;
      lambdaCombinedBytes: number;
    };
    const apiLambdaGroups: Array<LambdaGroup> = [];
    const pageLambdaGroups: Array<LambdaGroup> = [];

    if (isSharedLambdas) {
      // Do initial check to make sure the traced files don't already
      // exceed the lambda size limit as we won't be able to continue
      // if they do
      if (
        pseudoLayerBytes >= lambdaCompressedByteLimit ||
        apiPseudoLayerBytes >= lambdaCompressedByteLimit
      ) {
        throw new Error(
          `Required lambda files exceed max lambda size of ${lambdaCompressedByteLimit} bytes`
        );
      }

      for (const page of pageKeys) {
        // These default pages don't have to be handled as they'd always 404
        if (['_app.js', '_document.js'].includes(page)) {
          continue;
        }

        // Don't add _error to lambda if we have a static 404 page or
        // pages404 is enabled and 404.js is present
        if (
          page === '_error.js' &&
          ((static404Page && staticPages[static404Page]) ||
            (hasPages404 && pages['404.js']))
        ) {
          continue;
        }

        const pageFileName = path.normalize(
          path.relative(workPath, pages[page].fsPath)
        );
        const pathname = page.replace(/\.js$/, '');
        const routeIsApi = isApiPage(pageFileName);
        const routeIsDynamic = isDynamicRoute(pathname);

        if (routeIsDynamic) {
          dynamicPages.push(normalizePage(pathname));
        }
        const outputName = path.join('/', entryDirectory, pathname);

        const lambdaGroups = routeIsApi ? apiLambdaGroups : pageLambdaGroups;
        let lambdaGroupIndex = lambdaGroups.length - 1;
        const lastLambdaGroup = lambdaGroups[lambdaGroupIndex];
        let currentLambdaGroup = lastLambdaGroup;

        if (
          !currentLambdaGroup ||
          currentLambdaGroup.lambdaCombinedBytes >= lambdaCompressedByteLimit
        ) {
          lambdaGroupIndex++;
          currentLambdaGroup = {
            pages: {},
            isApiLambda: !!routeIsApi,
            lambdaCombinedBytes: !requiresTracing
              ? 0
              : routeIsApi
              ? apiPseudoLayerBytes
              : pseudoLayerBytes,
            lambdaIdentifier: path.join(
              entryDirectory,
              `__NEXT_${routeIsApi ? 'API' : 'PAGE'}_LAMBDA_${lambdaGroupIndex}`
            ),
          };
        }

        const pageLambdaRoute: Route = {
          src: `^${escapeStringRegexp(outputName).replace(
            /\/index$/,
            '(/|/index|)'
          )}$`,
          dest: `${path.join('/', currentLambdaGroup.lambdaIdentifier)}`,
          headers: {
            'x-nextjs-page': outputName,
          },
          check: true,
        };

        // we only need to add the additional routes if shared lambdas
        // is enabled
        if (routeIsDynamic) {
          dynamicPageLambdaRoutes.push(pageLambdaRoute);
          dynamicPageLambdaRoutesMap[outputName] = pageLambdaRoute;
        } else {
          pageLambdaRoutes.push(pageLambdaRoute);
        }

        if (page === '_error.js' || (hasPages404 && page === '404.js')) {
          page404Path = path.join('/', entryDirectory, pathname);
        }

        // we create the page as it's own layer so we can track how much
        // it increased the lambda size on it's own and know when we
        // need to create a new lambda
        const {
          pseudoLayer: pageLayer,
          pseudoLayerBytes: pageLayerBytes,
        } = await createPseudoLayer({ [pageFileName]: pages[page] });

        currentLambdaGroup.pages[outputName] = {
          pageLayer,
          pageFileName,
          pageName: page,
        };

        currentLambdaGroup.lambdaCombinedBytes += pageLayerBytes;
        lambdaGroups[lambdaGroupIndex] = currentLambdaGroup;
      }
    } else {
      await Promise.all(
        pageKeys.map(async (page) => {
          // These default pages don't have to be handled as they'd always 404
          if (['_app.js', '_document.js'].includes(page)) {
            return;
          }

          // Don't create _error lambda if we have a static 404 page or
          // pages404 is enabled and 404.js is present
          if (
            page === '_error.js' &&
            ((static404Page && staticPages[static404Page]) ||
              (hasPages404 && pages['404.js']))
          ) {
            return;
          }

          const pathname = page.replace(/\.js$/, '');

          if (isDynamicRoute(pathname)) {
            dynamicPages.push(normalizePage(pathname));
          }

          const pageFileName = path.normalize(
            path.relative(workPath, pages[page].fsPath)
          );
          const launcher = launcherData.replace(
            /__LAUNCHER_PAGE_PATH__/g,
            JSON.stringify(requiresTracing ? `./${pageFileName}` : './page')
          );
          const launcherFiles: { [name: string]: FileFsRef | FileBlob } = {
            'now__bridge.js': new FileFsRef({
              fsPath: path.join(__dirname, 'now__bridge.js'),
            }),
            'now__launcher.js': new FileBlob({ data: launcher }),
          };

          const lambdaOptions = await getLambdaOptionsFromFunction({
            sourceFile: await getSourceFilePathFromPage({ workPath, page }),
            config,
          });

          const outputName = path.join(entryDirectory, pathname);

          if (requiresTracing) {
            lambdas[outputName] = await createLambdaFromPseudoLayers({
              files: {
                ...launcherFiles,
                [requiresTracing ? pageFileName : 'page.js']: pages[page],
              },
              layers: isApiPage(pageFileName) ? apiPseudoLayers : pseudoLayers,
              handler: 'now__launcher.launcher',
              runtime: nodeVersion.runtime,
              ...lambdaOptions,
            });
          } else {
            lambdas[outputName] = await createLambda({
              files: {
                ...launcherFiles,
                ...assets,
                ...tracedFiles,
                [requiresTracing ? pageFileName : 'page.js']: pages[page],
              },
              handler: 'now__launcher.launcher',
              runtime: nodeVersion.runtime,
              ...lambdaOptions,
            });
          }
        })
      );
    }

    dynamicRoutes = await getDynamicRoutes(
      entryPath,
      entryDirectory,
      dynamicPages,
      false,
      routesManifest,
      new Set(prerenderManifest.omittedRoutes)
    );

    if (isSharedLambdas) {
      const launcherPath = path.join(__dirname, 'templated-launcher-shared.js');
      const launcherData = await readFile(launcherPath, 'utf8');

      // we need to include the prerenderManifest.omittedRoutes here
      // for the page to be able to be matched in the lambda for preview mode
      const completeDynamicRoutes = await getDynamicRoutes(
        entryPath,
        entryDirectory,
        dynamicPages,
        false,
        routesManifest
      );

      await Promise.all(
        [...apiLambdaGroups, ...pageLambdaGroups].map(
          async function buildLambdaGroup(group: LambdaGroup) {
            const groupPageKeys = Object.keys(group.pages);

            const launcher = launcherData.replace(
              /\/\/ __LAUNCHER_PAGE_HANDLER__/g,
              `
              const url = require('url');
              page = function(req, res) {
                try {
                  const pages = {
                    ${groupPageKeys
                      .map(
                        (page) =>
                          `'${page}': require('./${path.join(
                            './',
                            group.pages[page].pageFileName
                          )}')`
                      )
                      .join(',\n')}
                    ${
                      '' /*
                      creates a mapping of the page and the page's module e.g.
                      '/about': require('./.next/serverless/pages/about.js')
                    */
                    }
                  }
                  let toRender = req.headers['x-nextjs-page']

                  if (!toRender) {
                    try {
                      const { pathname } = url.parse(req.url)
                      toRender = pathname
                    } catch (_) {
                      // handle failing to parse url
                      res.statusCode = 400
                      return res.end('Bad Request')
                    }
                  }

                  let currentPage = pages[toRender]

                  if (
                    toRender &&
                    !currentPage
                  ) {
                    if (toRender.includes('/_next/data')) {
                      toRender = toRender
                        .replace(new RegExp('/_next/data/${escapedBuildId}/'), '/')
                        .replace(/\\.json$/, '')

                      currentPage = pages[toRender]
                    }

                    if (!currentPage) {
                      // for prerendered dynamic routes (/blog/post-1) we need to
                      // find the match since it won't match the page directly
                      const dynamicRoutes = ${JSON.stringify(
                        completeDynamicRoutes.map((route) => ({
                          src: route.src,
                          dest: route.dest,
                        }))
                      )}

                      for (const route of dynamicRoutes) {
                        const matcher = new RegExp(route.src)

                        if (matcher.test(toRender)) {
                          toRender = url.parse(route.dest).pathname
                          currentPage = pages[toRender]
                          break
                        }
                      }
                    }
                  }

                  if (!currentPage) {
                    console.error(
                      "Failed to find matching page for", toRender, "in lambda"
                    )
                    res.statusCode = 500
                    return res.end('internal server error')
                  }
                  const method = currentPage.render || currentPage.default || currentPage
                  return method(req, res)
                } catch (err) {
                  console.error('Unhandled error during request:', err)
                  throw err
                }
              }
              `
            );
            const launcherFiles: { [name: string]: FileFsRef | FileBlob } = {
              'now__bridge.js': new FileFsRef({
                fsPath: path.join(__dirname, 'now__bridge.js'),
              }),
              'now__launcher.js': new FileBlob({ data: launcher }),
            };

            const pageLayers: PseudoLayer[] = [];

            for (const page of groupPageKeys) {
              const { pageLayer } = group.pages[page];
              pageLambdaMap[page] = group.lambdaIdentifier;
              pageLayers.push(pageLayer);
            }

            if (requiresTracing) {
              lambdas[
                group.lambdaIdentifier
              ] = await createLambdaFromPseudoLayers({
                files: {
                  ...launcherFiles,
                },
                layers: [
                  ...(group.isApiLambda ? apiPseudoLayers : pseudoLayers),
                  ...pageLayers,
                ],
                handler: 'now__launcher.launcher',
                runtime: nodeVersion.runtime,
              });
            } else {
              lambdas[
                group.lambdaIdentifier
              ] = await createLambdaFromPseudoLayers({
                files: {
                  ...launcherFiles,
                  ...assets,
                },
                layers: pageLayers,
                handler: 'now__launcher.launcher',
                runtime: nodeVersion.runtime,
              });
            }
          }
        )
      );
    }

    if (hasLambdas) {
      console.timeEnd(allLambdasLabel);
    }

    let prerenderGroup = 1;
    const onPrerenderRoute = (
      routeKey: string,
      { isBlocking, isFallback }: { isBlocking: boolean; isFallback: boolean }
    ) => {
      if (isBlocking && isFallback) {
        throw new NowBuildError({
          code: 'NEXT_ISBLOCKING_ISFALLBACK',
          message: 'invariant: isBlocking and isFallback cannot both be true',
        });
      }

      // Get the route file as it'd be mounted in the builder output
      const routeFileNoExt = routeKey === '/' ? '/index' : routeKey;

      const htmlFsRef = isBlocking
        ? // Blocking pages do not have an HTML fallback
          null
        : new FileFsRef({
            fsPath: path.join(
              pagesDir,
              isFallback
                ? // Fallback pages have a special file.
                  prerenderManifest.fallbackRoutes[routeKey].fallback
                : // Otherwise, the route itself should exist as a static HTML
                  // file.
                  `${routeFileNoExt}.html`
            ),
          });
      const jsonFsRef =
        // JSON data does not exist for fallback or blocking pages
        isFallback || isBlocking
          ? null
          : new FileFsRef({
              fsPath: path.join(pagesDir, `${routeFileNoExt}.json`),
            });

      let initialRevalidate: false | number;
      let srcRoute: string | null;
      let dataRoute: string;

      if (isFallback || isBlocking) {
        const pr = isFallback
          ? prerenderManifest.fallbackRoutes[routeKey]
          : prerenderManifest.legacyBlockingRoutes[routeKey];
        initialRevalidate = 1; // TODO: should Next.js provide this default?
        // @ts-ignore
        if (initialRevalidate === false) {
          // Lazy routes cannot be "snapshotted" in time.
          throw new NowBuildError({
            code: 'NEXT_ISLAZY_INITIALREVALIDATE',
            message: 'invariant isLazy: initialRevalidate !== false',
          });
        }
        srcRoute = null;
        dataRoute = pr.dataRoute;
      } else {
        const pr = prerenderManifest.staticRoutes[routeKey];
        ({ initialRevalidate, srcRoute, dataRoute } = pr);
      }

      const outputPathPage = path.posix.join(entryDirectory, routeFileNoExt);
      let lambda: undefined | Lambda;
      const outputPathData = path.posix.join(entryDirectory, dataRoute);

      if (isSharedLambdas) {
        const outputSrcPathPage = path.join(
          '/',
          srcRoute == null
            ? outputPathPage
            : path.join(entryDirectory, srcRoute === '/' ? '/index' : srcRoute)
        );

        const lambdaId = pageLambdaMap[outputSrcPathPage];
        lambda = lambdas[lambdaId];
      } else {
        const outputSrcPathPage =
          srcRoute == null
            ? outputPathPage
            : path.posix.join(
                entryDirectory,
                srcRoute === '/' ? '/index' : srcRoute
              );

        lambda = lambdas[outputSrcPathPage];
      }

      if (lambda == null) {
        throw new NowBuildError({
          code: 'NEXT_MISSING_LAMBDA',
          message: `Unable to find lambda for route: ${routeFileNoExt}`,
        });
      }

      if (initialRevalidate === false) {
        if (htmlFsRef == null || jsonFsRef == null) {
          throw new NowBuildError({
            code: 'NEXT_HTMLFSREF_JSONFSREF',
            message: 'invariant: htmlFsRef != null && jsonFsRef != null',
          });
        }

        if (!canUsePreviewMode) {
          htmlFsRef.contentType = htmlContentType;
          prerenders[outputPathPage] = htmlFsRef;
          prerenders[outputPathData] = jsonFsRef;
        }
      }

      if (prerenders[outputPathPage] == null) {
        prerenders[outputPathPage] = new Prerender({
          expiration: initialRevalidate,
          lambda,
          fallback: htmlFsRef,
          group: prerenderGroup,
          bypassToken: prerenderManifest.bypassToken,
        });
        prerenders[outputPathData] = new Prerender({
          expiration: initialRevalidate,
          lambda,
          fallback: jsonFsRef,
          group: prerenderGroup,
          bypassToken: prerenderManifest.bypassToken,
        });

        ++prerenderGroup;
      }
    };

    Object.keys(prerenderManifest.staticRoutes).forEach((route) =>
      onPrerenderRoute(route, { isBlocking: false, isFallback: false })
    );
    Object.keys(prerenderManifest.fallbackRoutes).forEach((route) =>
      onPrerenderRoute(route, { isBlocking: false, isFallback: true })
    );
    Object.keys(prerenderManifest.legacyBlockingRoutes).forEach((route) =>
      onPrerenderRoute(route, { isBlocking: true, isFallback: false })
    );

    // We still need to use lazyRoutes if the dataRoutes field
    // isn't available for backwards compatibility
    if (!(routesManifest && routesManifest.dataRoutes)) {
      // Dynamic pages for lazy routes should be handled by the lambda flow.
      [
        ...Object.entries(prerenderManifest.fallbackRoutes),
        ...Object.entries(prerenderManifest.legacyBlockingRoutes),
      ].forEach(([, { dataRouteRegex, dataRoute }]) => {
        dataRoutes.push({
          // Next.js provided data route regex
          src: dataRouteRegex.replace(
            /^\^/,
            `^${appMountPrefixNoTrailingSlash}`
          ),
          // Location of lambda in builder output
          dest: path.posix.join(entryDirectory, dataRoute),
          check: true,
        });
      });
    }
  }

  const nextStaticFiles = await glob(
    '**',
    path.join(entryPath, outputDirectory, 'static')
  );
  const staticFolderFiles = await glob('**', path.join(entryPath, 'static'));
  const publicFolderFiles = await glob('**', path.join(entryPath, 'public'));

  const staticFiles = Object.keys(nextStaticFiles).reduce(
    (mappedFiles, file) => ({
      ...mappedFiles,
      [path.join(entryDirectory, `_next/static/${file}`)]: nextStaticFiles[
        file
      ],
    }),
    {}
  );
  const staticDirectoryFiles = Object.keys(staticFolderFiles).reduce(
    (mappedFiles, file) => ({
      ...mappedFiles,
      [path.join(entryDirectory, 'static', file)]: staticFolderFiles[file],
    }),
    {}
  );
  const publicDirectoryFiles = Object.keys(publicFolderFiles).reduce(
    (mappedFiles, file) => ({
      ...mappedFiles,
      [path.join(
        entryDirectory,
        file.replace(/^public[/\\]+/, '')
      )]: publicFolderFiles[file],
    }),
    {}
  );

  if (!isSharedLambdas) {
    // We need to delete lambdas from output instead of omitting them from the
    // start since we rely on them for powering Preview Mode (read above in
    // onPrerenderRoute).
    prerenderManifest.omittedRoutes.forEach((routeKey) => {
      // Get the route file as it'd be mounted in the builder output
      const routeFileNoExt = path.posix.join(
        entryDirectory,
        routeKey === '/' ? '/index' : routeKey
      );
      if (typeof lambdas[routeFileNoExt] === undefined) {
        throw new NowBuildError({
          code: 'NEXT__UNKNOWN_ROUTE_KEY',
          message: `invariant: unknown lambda ${routeKey} (lookup: ${routeFileNoExt}) | please report this immediately`,
        });
      }
      delete lambdas[routeFileNoExt];
    });
  }
  const mergedDataRoutesLambdaRoutes = [];
  const mergedDynamicRoutesLambdaRoutes = [];

  if (isSharedLambdas) {
    // we need to define the page lambda route immediately after
    // the dynamic route in handle: 'rewrite' so that a matching
    // dynamic route doesn't catch it before the page lambda route
    // e.g. /teams/[team]/[inviteCode] -> page lambda
    // but we also have /[teamSlug]/[project]/[id] which could match it first

    for (let i = 0; i < dynamicRoutes.length; i++) {
      const route = dynamicRoutes[i];

      mergedDynamicRoutesLambdaRoutes.push(route);

      const { pathname } = url.parse(route.dest!);

      if (pathname && pageLambdaMap[pathname]) {
        mergedDynamicRoutesLambdaRoutes.push(
          dynamicPageLambdaRoutesMap[pathname]
        );
      }
    }

    for (let i = 0; i < dataRoutes.length; i++) {
      const route = dataRoutes[i];

      mergedDataRoutesLambdaRoutes.push(route);

      const { pathname } = url.parse(route.dest!);

      if (
        pathname &&
        pageLambdaMap[pathname] &&
        dynamicPageLambdaRoutesMap[pathname]
      ) {
        mergedDataRoutesLambdaRoutes.push(dynamicPageLambdaRoutesMap[pathname]);
      }
    }
  }

  return {
    output: {
      ...publicDirectoryFiles,
      ...lambdas,
      // Prerenders may override Lambdas -- this is an intentional behavior.
      ...prerenders,
      ...staticPages,
      ...staticFiles,
      ...staticDirectoryFiles,
    },
    /*
      Desired routes order
      - Runtime headers
      - User headers and redirects
      - Runtime redirects
      - Runtime routes
      - Check filesystem, if nothing found continue
      - User rewrites
      - Builder rewrites
    */
    routes: [
      // headers
      ...headers,

      // redirects
      ...redirects,

      // Make sure to 404 for the /404 path itself
      {
        src: path.join('/', entryDirectory, '404'),
        status: 404,
        continue: true,
      },

      // Next.js page lambdas, `static/` folder, reserved assets, and `public/`
      // folder
      { handle: 'filesystem' },

      // map pages to their lambda
      ...pageLambdaRoutes,

      // map /blog/[post] to correct lambda for iSSG
      ...dynamicPageLambdaRoutes,

      // These need to come before handle: miss or else they are grouped
      // with that routing section
      ...rewrites,

      // We need to make sure to 404 for /_next after handle: miss since
      // handle: miss is called before rewrites and to prevent rewriting /_next
      { handle: 'miss' },
      {
        src: path.join(
          '/',
          entryDirectory,
          '_next/static/(?:[^/]+/pages|pages|chunks|runtime|css|media)/.+'
        ),
        status: 404,
        check: true,
        dest: '$0',
      },

      // routes that are called after each rewrite or after routes
      // if there no rewrites
      { handle: 'rewrite' },

      // /_next/data routes for getServerProps/getStaticProps pages
      ...(isSharedLambdas ? mergedDataRoutesLambdaRoutes : dataRoutes),

      // re-check page routes to map them to the lambda
      ...pageLambdaRoutes,

      // Dynamic routes (must come after dataRoutes as dataRoutes are more
      // specific)
      ...(isSharedLambdas ? mergedDynamicRoutesLambdaRoutes : dynamicRoutes),

      // routes to call after a file has been matched
      { handle: 'hit' },
      // Before we handle static files we need to set proper caching headers
      {
        // This ensures we only match known emitted-by-Next.js files and not
        // user-emitted files which may be missing a hash in their filename.
        src: path.join(
          '/',
          entryDirectory,
          '_next/static/(?:[^/]+/pages|pages|chunks|runtime|css|media)/.+'
        ),
        // Next.js assets contain a hash or entropy in their filenames, so they
        // are guaranteed to be unique and cacheable indefinitely.
        headers: {
          'cache-control': `public,max-age=${MAX_AGE_ONE_YEAR},immutable`,
        },
        continue: true,
      },

      // error handling
      ...(isLegacy
        ? []
        : [
            // Custom Next.js 404 page
            { handle: 'error' } as Handler,

            isSharedLambdas
              ? {
                  src: path.join('/', entryDirectory, '.*'),
                  // if static 404 is not present but we have pages/404.js
                  // it is a lambda due to _app getInitialProps
                  dest: path.join(
                    '/',
                    (static404Page
                      ? static404Page
                      : pageLambdaMap[page404Path]) as string
                  ),

                  status: 404,
                  headers: {
                    'x-nextjs-page': page404Path,
                  },
                }
              : {
                  src: path.join('/', entryDirectory, '.*'),
                  // if static 404 is not present but we have pages/404.js
                  // it is a lambda due to _app getInitialProps
                  dest: static404Page
                    ? path.join('/', static404Page)
                    : path.join(
                        '/',
                        entryDirectory,
                        hasPages404 &&
                          lambdas[path.join('./', entryDirectory, '404')]
                          ? '404'
                          : '_error'
                      ),
                  status: 404,
                },
          ]),
    ],
    watch: [],
    childProcesses: [],
  };
};

export const prepareCache = async ({
  workPath,
  entrypoint,
  config = {},
}: PrepareCacheOptions): Promise<Files> => {
  debug('Preparing cache...');
  const entryDirectory = path.dirname(entrypoint);
  const entryPath = path.join(workPath, entryDirectory);
  const outputDirectory = config.outputDirectory || '.next';

  const nextVersionRange = await getNextVersionRange(entryPath);
  const isLegacy = nextVersionRange && isLegacyNext(nextVersionRange);

  if (isLegacy) {
    // skip caching legacy mode (swapping deps between all and production can get bug-prone)
    return {};
  }

  debug('Producing cache file manifest...');
  const cacheEntrypoint = path.relative(workPath, entryPath);
  const cache = {
    ...(await glob(path.join(cacheEntrypoint, 'node_modules/**'), workPath)),
    ...(await glob(
      path.join(cacheEntrypoint, outputDirectory, 'cache/**'),
      workPath
    )),
  };
  debug('Cache file manifest produced');
  return cache;
};
