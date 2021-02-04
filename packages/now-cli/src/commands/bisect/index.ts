import chalk, { Chalk } from 'chalk';
import execa from 'execa';
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
import getInspectUrl from '../../util/deployment/get-inspect-url';
import { getOrgById } from '../../util/projects/link';
import {
  Org,
  Deployment,
  NowContext,
  PaginationOptions,
  Project,
} from '../../types';
import getProjectByIdOrName from '../../util/projects/get-project-by-id-or-name';

interface DeploymentResolve {
  url: string;
  target: string;
  createdAt: number;
  projectId: string;
  ownerId: string;
}

interface Deployments {
  deployments: Deployment[];
  pagination: PaginationOptions;
}

const pkgName = getPkgName();

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} ${pkgName} bisect`)} [options]

  ${chalk.dim('Options:')}

    -h, --help                 Output usage information
    -d, --debug                Debug mode [off]
    -b, --bad                  Known bad URL
    -g, --good                 Known good URL
    -p, --path                 Subpath of the deployment URL to test
    -r, --run                  Test script to run for each deployment

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Bisect the current project interactively

      ${chalk.cyan(`$ ${pkgName} bisect`)}

  ${chalk.gray('–')} Bisect with a known bad deployment

      ${chalk.cyan(`$ ${pkgName} bisect --bad example-310pce9i0.vercel.app`)}

  ${chalk.gray('–')} Bisect specifying a deployment that was working 3 days ago

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
  const run = argv['--run'] || '';

  let orgPromise: Promise<Org | null> | null = null;
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
      message: `Specify a URL where the bug occurs:`,
    });
    bad = answer.bad;
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
    orgPromise = badDeploymentPromise.then(d => getOrgById(client, d.ownerId));
  }

  if (!good) {
    const answer = await inquirer.prompt({
      type: 'input',
      name: 'good',
      message: `Specify a URL where the bug does not occur:`,
    });
    good = answer.good;
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
      message: `Specify the URL subpath where the bug occurs:`,
    });
    subpath = answer.subpath;
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

    const res = await client.fetch<Deployments>(`/v6/deployments?${query}`, {
      accountId: badDeployment.ownerId,
    });

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
    // Add a blank space before the next step
    output.print('\n');
    const middleIndex = Math.floor(deployments.length / 2);
    const deployment = deployments[middleIndex];
    //console.log(deployments.map(d => d.url));
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
    const testUrl = `https://${deployment.url}${subpath}`;
    output.log(`${chalk.bold('Deployment URL:')} ${link(testUrl)}`);

    const created = new Date(deployment.created);
    output.log(`${chalk.bold('Created At:')} ${created}`);

    const commit = getCommit(deployment);
    if (commit) {
      const shortSha = commit.sha.substring(0, 7);
      const firstLine = commit.message.split('\n')[0];
      output.log(`${chalk.bold('Commit:')} [${shortSha}] ${firstLine}`);
    }

    let action: string;
    if (run) {
      const proc = await execa(run, [testUrl], {
        stdio: 'inherit',
        reject: false,
        env: {
          ...process.env,
          HOST: deployment.url,
          URL: testUrl,
        },
      });
      if (proc instanceof Error && typeof proc.exitCode !== 'number') {
        // Script does not exist or is not executable, so exit
        output.prettyError(proc);
        return 1;
      }
      const { exitCode } = proc;
      let color: Chalk;
      if (exitCode === 0) {
        color = chalk.green;
        action = 'good';
      } else if (exitCode === 125) {
        action = 'skip';
        color = chalk.grey;
      } else {
        action = 'bad';
        color = chalk.red;
      }
      output.log(
        `Run script returned exit code ${chalk.bold(String(exitCode))}: ${color(
          action
        )}`
      );
    } else {
      const answer = await inquirer.prompt({
        type: 'expand',
        name: 'action',
        message: 'Select an action:',
        choices: [
          { key: 'g', name: 'Good', value: 'good' },
          { key: 'b', name: 'Bad', value: 'bad' },
          { key: 's', name: 'Skip', value: 'skip' },
        ],
      });
      action = answer.action;
    }

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
    const firstLine = commit.message.split('\n')[0];
    output.log(`${chalk.bold('Commit:')} [${shortSha}] ${firstLine}`);
  }

  const org = await orgPromise;
  if (org) {
    const inspectUrl = getInspectUrl(lastBad.url, org.slug);
    output.log(`${chalk.bold('Inspect:')} ${link(inspectUrl)}`);
  }

  return 0;
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
