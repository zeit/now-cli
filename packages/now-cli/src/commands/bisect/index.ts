import chalk from 'chalk';
import plural from 'pluralize';
import inquirer from 'inquirer';
import { URLSearchParams, parse } from 'url';

import sleep from '../../util/sleep';
import link from '../../util/output/link';
import logo from '../../util/output/logo';
import handleError from '../../util/handle-error';
import getArgs from '../../util/get-args';
import Client from '../../util/client';
import { getPkgName } from '../../util/pkg-name';
import { ProjectNotFound } from '../../util/errors-ts';
import {
  Deployment,
  NowContext,
  PaginationOptions,
  Project,
} from '../../types';
import getProjectByIdOrName from '../../util/projects/get-project-by-id-or-name';

const pkgName = getPkgName();

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} ${pkgName} bisect`)} [options]

  ${chalk.dim('Options:')}

    -h, --help                 Output usage information
    -d, --debug                Debug mode [off]
    -p, --path                 Subpath of the deployment URL to test
    -g, --good                 Known good deployment URL
    -b, --bad                  Known bad deployment URL
    -r, --run                  Test script to run for each deployment

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Bisect the current project interactively

      ${chalk.cyan(`$ ${pkgName} bisect`)}

  ${chalk.gray('–')} Bisect with a known bad deployment

      ${chalk.cyan(`$ ${pkgName} bisect --bad example-310pce9i0.vercel.app`)}

  ${chalk.gray(
    '–'
  )} Bisect specifying that the deployment was working 3 days ago

      ${chalk.cyan(`$ ${pkgName} bisect --good 3d`)}

  ${chalk.gray('–')} Automated bisect with a run script

      ${chalk.cyan(`$ ${pkgName} bisect --run ./test.sh`)}
  `);
};

export default async function main(ctx: NowContext): Promise<number> {
  let argv;
  const {
    apiUrl,
    authConfig: { token },
    output,
    config: { currentTeam },
  } = ctx;

  try {
    argv = getArgs(ctx.argv.slice(2), {
      '--good': String,
      '-g': '--good',
      '--bad': String,
      '-b': '--bad',
      '--path': String,
      '-p': '--path',
      '--run': String,
      '-r': '--run',
    });
  } catch (err) {
    handleError(err);
    return 1;
  }

  if (argv['--help']) {
    help();
    return 2;
  }

  let bad = argv['--bad'] || '';
  let good = argv['--good'] || '';
  let subpath = argv['--path'] || '';
  //const run = argv['--run'] || '';

  let badDeploymentPromise: Promise<DeploymentResolve> | null = null;
  let goodDeploymentPromise: Promise<DeploymentResolve> | null = null;
  let projectPromise: Promise<Project | ProjectNotFound> | null = null;

  const client = new Client({
    apiUrl,
    token,
    currentTeam,
    debug: output.isDebugEnabled(),
    output,
  });

  if (!bad) {
    const answer = await inquirer.prompt({
      type: 'input',
      name: 'bad',
      message: `What's the deployment URL where the bug occurs\n  Leave blank for the latest deployment:`,
    });
    bad = answer.bad;
    output.print('\n');
  }

  if (bad) {
    if (!bad.startsWith('https://')) {
      bad = `https://${bad}`;
    }
    const parsed = parse(bad);
    if (!parsed.hostname) {
      output.error('Invalid input: no hostname provided');
      return 1;
    }
    bad = parsed.hostname;
    if (typeof parsed.path === 'string' && parsed.path !== '/') {
      if (subpath && subpath !== parsed.path) {
        output.note(
          `Ignoring subpath ${chalk.bold(
            parsed.path
          )} in favor of \`--path\` argument ${chalk.bold(subpath)}`
        );
      } else {
        subpath = parsed.path;
      }
    }

    badDeploymentPromise = getDeployment(client, bad);
    projectPromise = badDeploymentPromise.then(d =>
      getProjectByIdOrName(client, d.projectId, d.ownerId)
    );
  }

  if (!good) {
    const answer = await inquirer.prompt({
      type: 'input',
      name: 'good',
      message: `What's a deployment URL where the bug does not occur\n  Leave blank for the oldest deployment:`,
    });
    good = answer.good;
    output.print('\n');
  }

  if (good) {
    if (!good.startsWith('https://')) {
      good = `https://${good}`;
    }
    const parsed = parse(good);
    if (!parsed.hostname) {
      output.error('Invalid input: no hostname provided');
      return 1;
    }
    good = parsed.hostname;
    if (
      typeof parsed.path === 'string' &&
      parsed.path !== '/' &&
      subpath &&
      subpath !== parsed.path
    ) {
      output.note(
        `Ignoring subpath ${chalk.bold(
          parsed.path
        )} which does not match ${chalk.bold(subpath)}`
      );
    }

    goodDeploymentPromise = getDeployment(client, good);
  }

  if (!subpath) {
    const answer = await inquirer.prompt({
      type: 'input',
      name: 'subpath',
      message: `What's the URL path where the bug occurs:`,
    });
    subpath = answer.subpath;

    output.print('\n');
  }

  //console.log({ good, bad, subpath });

  output.spinner('Retrieving project…');
  const [badDeployment, goodDeployment, project] = await Promise.all([
    badDeploymentPromise,
    goodDeploymentPromise,
    projectPromise,
  ]);
  //console.log({ goodDeployment, badDeployment, project });

  if (badDeployment) {
    bad = badDeployment.url;
  } else {
    output.error(`Failed to retrieve ${chalk.bold('bad')} Deployment: ${bad}`);
    return 1;
  }

  if (goodDeployment) {
    good = goodDeployment.url;
  } else {
    output.error(
      `Failed to retrieve ${chalk.bold('good')} Deployment: ${good}`
    );
    return 1;
  }

  if (!project) {
    output.error(`Failed to retrieve Project: ${badDeployment.projectId}`);
    return 1;
  }

  if (project instanceof ProjectNotFound) {
    output.prettyError(project);
    return 1;
  }

  if (badDeployment.projectId !== goodDeployment.projectId) {
    output.error(`Good and Bad deployments must be from the same Project`);
    return 1;
  }

  if (badDeployment.createdAt < goodDeployment.createdAt) {
    output.error(`Good deployment must be older than the Bad deployment`);
    return 1;
  }

  output.log(`Bisecting project ${chalk.bold(`"${project.name}"`)}`);

  // Fetch all the project's "READY" deployments with the pagination API
  output.spinner('Retrieving deployments…');
  let deployments: Deployment[] = [];
  let next: number | undefined = badDeployment.createdAt + 1;
  do {
    const query = new URLSearchParams();
    query.set('projectId', project.id);
    query.set('target', 'production');
    query.set('limit', '100');
    query.set('state', 'READY');
    if (next) {
      query.set('until', String(next));
    }

    const res = await client.fetch<{
      deployments: Deployment[];
      pagination: PaginationOptions;
    }>(`/v6/deployments?${query}`);

    next = res.pagination.next;

    let newDeployments = res.deployments;

    // If we have the "good" deployment in this chunk, then we're done
    for (let i = 0; i < newDeployments.length; i++) {
      if (newDeployments[i].url === good) {
        newDeployments = newDeployments.slice(0, i + 1);
        next = undefined;
        break;
      }
    }

    deployments = deployments.concat(newDeployments);

    if (next) {
      // Small sleep to avoid rate limiting
      await sleep(100);
    }
  } while (next);

  if (!deployments.length) {
    output.error(
      'Cannot bisect because this project does not have any deployments'
    );
    return 1;
  }

  // The first deployment is the one that was marked
  // as "bad", so that one does not need to be tested
  let lastBad = deployments.shift()!;

  while (deployments.length > 0) {
    //console.log(deployments.map(d => d.url));
    // Add a blank space before the next step
    output.print('\n');
    const middleIndex = Math.floor(deployments.length / 2);
    const deployment = deployments[middleIndex];
    //console.log(deployment);
    const rem = plural('deployment', deployments.length, true);
    const steps = Math.round(Math.pow(deployments.length, 0.5));
    const pSteps = plural('step', steps, true);
    output.log(
      chalk.magenta(
        `${chalk.bold(
          'Bisecting:'
        )} ${rem} left to test after this (roughly ${pSteps})`
      ),
      chalk.magenta
    );
    output.log(
      `${chalk.bold('Deployment URL:')} ${link(
        `https://${deployment.url}${subpath}`
      )}`
    );

    const created = new Date(deployment.created);
    output.log(`${chalk.bold('Created At:')} ${created}`);

    const commit = getCommit(deployment);
    if (commit) {
      const shortSha = commit.sha.substring(0, 7);
      output.log(`${chalk.bold('Commit:')} [${shortSha}] ${commit.message}`);
    }

    const { action } = await inquirer.prompt({
      type: 'expand',
      name: 'action',
      message: 'Select an action:',
      choices: [
        { key: 'g', name: 'Good', value: 'good' },
        { key: 'b', name: 'Bad', value: 'bad' },
        { key: 's', name: 'Skip', value: 'skip' },
      ],
    });

    if (action === 'good') {
      deployments = deployments.slice(0, middleIndex);
    } else if (action === 'bad') {
      lastBad = deployment;
      deployments = deployments.slice(middleIndex + 1);
    } else if (action === 'skip') {
      deployments.splice(middleIndex, 1);
    }
  }

  output.print('\n');
  output.success(
    `The first bad deployment is: ${link(`https://${lastBad.url}`)}`
  );

  const created = new Date(lastBad.created);
  output.log(`${chalk.bold('Created At:')} ${created}`);

  const commit = getCommit(lastBad);
  if (commit) {
    const shortSha = commit.sha.substring(0, 7);
    output.log(`${chalk.bold('Commit:')} [${shortSha}] ${commit.message}`);
  }

  const inspectUrl = `https://vercel.com/$OWNER/$PROJECT/asdfas`;
  output.log(`${chalk.bold('Inspect:')} ${inspectUrl}`);

  return 0;
}

interface DeploymentResolve {
  url: string;
  target: string;
  createdAt: number;
  projectId: string;
  ownerId: string;
}

function getDeployment(
  client: Client,
  hostname: string
): Promise<DeploymentResolve> {
  const query = new URLSearchParams();
  query.set('url', hostname);
  query.set('resolve', '1');
  query.set('noState', '1');
  return client.fetch<DeploymentResolve>(`/v10/deployments/get?${query}`);
}

function getCommit(deployment: Deployment) {
  const sha =
    deployment.meta?.githubCommitSha ||
    deployment.meta?.gitlabCommitSha ||
    deployment.meta?.bitbucketCommitSha;
  if (!sha) return null;
  const message =
    deployment.meta?.githubCommitMessage ||
    deployment.meta?.gitlabCommitMessage ||
    deployment.meta?.bitbucketCommitMessage;
  return { sha, message };
}
