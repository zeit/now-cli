import chalk from 'chalk';
import inquirer from 'inquirer';
import { URLSearchParams } from 'url';

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
    -g, --good                 Known good deployment or date
    -b, --bad                  Known bad deployment or date
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
  console.log(argv);

  const cwd = process.cwd();

  const client = new Client({
    apiUrl,
    token,
    currentTeam,
    debug: output.isDebugEnabled(),
    output,
  });

  const linkedProject = await getLinkedProject(output, client, cwd);

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

  // TODO: Prompt for starting good/bad deployments/dates

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
  output.stopSpinner();

  if (!deployments.length) {
    output.error(
      'Can not bisect because this project does not have any deployments'
    );
    return 1;
  }

  while (deployments.length > 0) {
    const middleIndex = Math.floor(deployments.length / 2);
    const middleDeployment = deployments[middleIndex];
    output.log(
      `Bisecting: ${deployments.length} deployments left to test after this (roughly n steps)`
    );
    output.log(`Deployment URL: ${link(`https://${middleDeployment.url}`)}`);

    let action = '';
    while (!action) {
      output.log(
        `Please inspect the deployment and enter one of: ${chalk.bold(
          'good'
        )}, ${chalk.bold('bad')}, or ${chalk.bold('skip')}`
      );
      const answers = await inquirer.prompt({
        type: 'input',
        name: 'action',
        message: `Action:`,
      });
      if (answers.action === 'good' || answers.action === 'g') {
        action = 'good';
      } else if (answers.action === 'bad' || answers.action === 'b') {
        action = 'bad';
      } else if (answers.action === 'skip' || answers.action === 's') {
        action = 'skip';
      } else {
        output.warn(`Invalid action: ${chalk.bold(answers.action)}`);
      }
    }

    if (action === 'good') {
      deployments = deployments.slice(0, middleIndex);
    } else if (action === 'bad') {
      deployments = deployments.slice(middleIndex);
    } else if (action === 'skip') {
      deployments.splice(middleIndex, 1);
    }
  }

  return 0;
}
