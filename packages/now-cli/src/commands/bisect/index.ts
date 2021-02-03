import chalk from 'chalk';
import plural from 'pluralize';
import inquirer from 'inquirer';
import { URLSearchParams, parse } from 'url';

import link from '../../util/output/link';
import logo from '../../util/output/logo';
import handleError from '../../util/handle-error';
import getArgs from '../../util/get-args';
import Client from '../../util/client';
import { getLinkedProject } from '../../util/projects/link';
import { getPkgName } from '../../util/pkg-name';
import { Deployment, NowContext, PaginationOptions } from '../../types';

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

      ${chalk.cyan(`$ ${getPkgName()} bisect`)}

  ${chalk.gray('–')} Bisect with a known bad deployment

      ${chalk.cyan(
        `$ ${getPkgName()} bisect --bad example-310pce9i0.vercel.app`
      )}

  ${chalk.gray(
    '–'
  )} Bisect specifying that the deployment was working 3 days ago

      ${chalk.cyan(`$ ${getPkgName()} bisect --good 3d`)}

  ${chalk.gray('–')} Automated bisect with a run script

      ${chalk.cyan(`$ ${getPkgName()} bisect --run ./test.sh`)}
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

  const client = new Client({
    apiUrl,
    token,
    currentTeam,
    debug: output.isDebugEnabled(),
    output,
  });

  const linkedProject = await getLinkedProject(output, client);

  if (linkedProject.status === 'not_linked') {
    console.log('not linked!');
    return 1;
  }

  if (linkedProject.status === 'error') {
    return linkedProject.exitCode;
  }

  const { project, org } = linkedProject;
  client.currentTeam = org.type === 'team' ? org.id : undefined;

  output.log(`Bisecting project ${chalk.bold(`"${project.name}"`)}`);

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

  // Fetch all the project's "READY" deployments with the pagination API
  output.spinner('Retrieving deployments…');
  let next: number | undefined;
  let deployments: Deployment[] = [];
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
    deployments = deployments.concat(res.deployments);
    next = res.pagination.next;
  } while (next);

  if (!deployments.length) {
    output.error(
      'Cannot bisect because this project does not have any deployments'
    );
    return 1;
  }

  //console.log({ good, bad, subpath });

  let lastBad: Deployment | null = null;

  while (deployments.length > 0) {
    // Add a blank space before the next step
    //console.log(deployments.map(d => d.url));
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
  if (lastBad) {
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
  } else {
    output.error(
      `No deployments were marked as ${chalk.bold(
        'bad'
      )}. Please check your initial good and bad values`
    );
    return 1;
  }
}

/*
async function getDeployment(client: Client, hostname: string): Deployment {
}
*/

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
