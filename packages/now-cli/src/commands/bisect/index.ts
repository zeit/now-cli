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
      'Can not bisect because this project does not have any deployments'
    );
    return 1;
  }

  console.log({ good, bad, subpath });

  while (deployments.length > 1) {
    // Add a blank space before the next step
    output.print('\n');
    console.log(deployments.map(d => d.url));
    const middleIndex = Math.floor(deployments.length / 2);
    const middleDeployment = deployments[middleIndex];
    //console.log(middleDeployment);
    const created = new Date(middleDeployment.created);
    const steps = Math.round(Math.pow(deployments.length, 0.5));
    output.log(
      `Bisecting: ${
        deployments.length
      } deployments left to test after this (roughly ${plural(
        'step',
        steps,
        true
      )})`
    );
    output.log(`${chalk.bold('Created At:')} ${created}`);
    const commit = getCommit(middleDeployment);
    if (commit) {
      output.log(
        `${chalk.bold('Commit:')} ${commit.message} [${commit.sha.substring(
          0,
          7
        )}]`
      );
    }
    output.log(
      `${chalk.bold('Deployment URL:')} ${link(
        `https://${middleDeployment.url}${subpath}`
      )}`
    );

    let action = '';
    while (!action) {
      output.log(
        `Please inspect the URL, then enter one of: ${chalk.bold(
          'good'
        )}, ${chalk.bold('bad')}, or ${chalk.bold('skip')}`
      );
      const answer = await inquirer.prompt({
        type: 'input',
        name: 'action',
        message: `Action:`,
      });
      if (answer.action === 'good' || answer.action === 'g') {
        action = 'good';
      } else if (answer.action === 'bad' || answer.action === 'b') {
        action = 'bad';
      } else if (answer.action === 'skip' || answer.action === 's') {
        action = 'skip';
      } else {
        output.error(`Invalid action: ${chalk.bold(answer.action)}`);
      }
    }

    if (action === 'good') {
      deployments = deployments.slice(0, middleIndex + 1);
    } else if (action === 'bad') {
      deployments = deployments.slice(middleIndex + 1);
    } else if (action === 'skip') {
      deployments.splice(middleIndex, 1);
    }
  }

  console.log('final', deployments.length, deployments[0]);

  return 0;
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
