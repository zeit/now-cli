import { intersects, validRange } from 'semver';
import boxen from 'boxen';
import { NodeVersion } from '../types';
import { NowBuildError } from '../errors';
import debug from '../debug';

const allOptions = [
  { major: 14, range: '14.x', runtime: 'nodejs14.x' },
  { major: 12, range: '12.x', runtime: 'nodejs12.x' },
  {
    major: 10,
    range: '10.x',
    runtime: 'nodejs10.x',
    discontinueDate: new Date('2021-03-30'),
  },
  {
    major: 8,
    range: '8.10.x',
    runtime: 'nodejs8.10',
    discontinueDate: new Date('2020-01-06'),
  },
] as const;

const pleaseSet =
  'Please change your Project Settings or set "engines": { "node": "' +
  getLatestNodeVersion().range +
  '" } in your `package.json` file to use Node.js ' +
  getLatestNodeVersion().major +
  '.';
const upstreamProvider =
  'This change is the result of a decision made by an upstream infrastructure provider (AWS).' +
  '\nRead more: https://docs.aws.amazon.com/lambda/latest/dg/runtime-support-policy.html';

export function getLatestNodeVersion() {
  return allOptions[0];
}

export function getDiscontinuedNodeVersions(): NodeVersion[] {
  return allOptions.filter(isDiscontinued);
}

export async function getSupportedNodeVersion(
  engineRange?: string,
  isAuto?: boolean
): Promise<NodeVersion> {
  let selection: NodeVersion = getLatestNodeVersion();

  if (engineRange) {
    const found =
      validRange(engineRange) &&
      allOptions.some(o => {
        // the array is already in order so return the first
        // match which will be the newest version of node
        selection = o;
        return intersects(o.range, engineRange);
      });
    if (!found) {
      const intro =
        isAuto || !engineRange
          ? 'This project is using an invalid version of Node.js and must be changed.'
          : 'Found `engines` in `package.json` with an invalid Node.js version range: "' +
            engineRange +
            '".';
      throw new NowBuildError({
        code: 'BUILD_UTILS_NODE_VERSION_INVALID',
        link:
          'https://vercel.com/docs/runtimes#official-runtimes/node-js/node-js-version',
        message: intro + '\n' + pleaseSet,
      });
    }
  }

  if (isDiscontinued(selection)) {
    const intro =
      isAuto || !engineRange
        ? 'This project is using a discontinued version of Node.js (' +
          selection.range +
          ') and must be upgraded.'
        : 'Found `engines` in `package.json` with a discontinued Node.js version range: "' +
          engineRange +
          '".';
    throw new NowBuildError({
      code: 'BUILD_UTILS_NODE_VERSION_DISCONTINUED',
      link:
        'https://vercel.com/docs/runtimes#official-runtimes/node-js/node-js-version',
      message: intro + '\n' + pleaseSet + '\n' + upstreamProvider,
    });
  }

  debug(
    isAuto || !engineRange
      ? 'Using default Node.js range: "' + selection.range + '".'
      : 'Found `engines` in `package.json`, selecting range: "' +
          selection.range +
          '".'
  );

  if (selection.discontinueDate) {
    const d = selection.discontinueDate.toISOString().split('T')[0];
    console.warn(
      boxen(
        'NOTICE' +
          '\n' +
          `\nNode.js version ${selection.range} has reached end-of-life.` +
          `\nAs a result, deployments created on or after ${d} will fail to build.` +
          '\n' +
          pleaseSet +
          '\n' +
          upstreamProvider,
        { padding: 1 }
      )
    );
  }

  return selection;
}

function isDiscontinued({ discontinueDate }: NodeVersion): boolean {
  const today = Date.now();
  return discontinueDate !== undefined && discontinueDate.getTime() <= today;
}
