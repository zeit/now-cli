import chalk from 'chalk';
import { URLSearchParams } from 'url';

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
      '--run': Boolean,
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

  const link = await getLinkedProject(output, client, cwd);

  if (link.status === 'not_linked') {
    console.log('not linked!');
    return 1;
  }

  if (link.status === 'error') {
    return link.exitCode;
  }

  const { project, org } = link;
  client.currentTeam = org.type === 'team' ? org.id : undefined;

  // Fetch all the project's "READY" deployments with the pagination API
  output.spinner('Retrieving deployments…');
  let next: number | undefined;
  const deployments: Deployment[] = [];
  do {
    const query = new URLSearchParams();
    query.set('projectId', project.id);
    query.set('target', 'production');
    //query.set('limit', '100');
    query.set('limit', '5');
    query.set('state', 'READY');
    if (next) {
      query.set('until', String(next));
    }

    const res = await client.fetch<{
      deployments: Deployment[];
      pagination: PaginationOptions;
    }>(`/v6/deployments?${query}`);
    deployments.push(...res.deployments);
    console.log(res.pagination);
    next = res.pagination.next;
  } while (next);
  output.stopSpinner();

  console.log(deployments, deployments.length);

  return 0;
}
