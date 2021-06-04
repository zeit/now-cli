import chalk from 'chalk';
import table from 'text-table';
import ms from 'ms';
import strlen from '../util/strlen';
import getArgs from '../util/get-args';
import { handleError, error } from '../util/error';
import exit from '../util/exit';
import logo from '../util/output/logo';
import getScope from '../util/get-scope';
import getCommandFlags from '../util/get-command-flags';
import wait from '../util/output/wait';
import { getPkgName, getCommandName } from '../util/pkg-name.ts';

const e = encodeURIComponent;

const help = () => {
  console.log(`
  ${chalk.bold(`${logo} ${getPkgName()} projects`)} [options] <command>

  ${chalk.dim('Commands:')}

    ls                               Show all projects in the selected team/user
    add      [name]                  Add a new project
    rm       [name]                  Remove a project

  ${chalk.dim('Options:')}

    -h, --help                     Output usage information
    -t ${chalk.bold.underline('TOKEN')}, --token=${chalk.bold.underline(
    'TOKEN'
  )}        Login token
    -S, --scope                    Set a custom scope
    -N, --next                     Show next page of results

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Add a new project

    ${chalk.cyan(`$ ${getPkgName()} projects add my-project`)}

  ${chalk.gray('–')} Paginate projects, where ${chalk.dim(
    '`1584722256178`'
  )} is the time in milliseconds since the UNIX epoch.

    ${chalk.cyan(`$ ${getPkgName()} projects ls --next 1584722256178`)}
`);
};

// Options
let argv;
let subcommand;

const main = async client => {
  try {
    argv = getArgs(client.argv.slice(2), {
      '--next': Number,
      '-N': '--next',
    });
  } catch (error) {
    handleError(error);
    return exit(1);
  }

  argv._ = argv._.slice(1);

  subcommand = argv._[0] || 'list';

  if (argv['--help']) {
    help();
    return exit(2);
  }

  const { output } = client;

  let contextName = null;

  try {
    ({ contextName } = await getScope(client));
  } catch (err) {
    if (err.code === 'NOT_AUTHORIZED' || err.code === 'TEAM_DELETED') {
      output.error(err.message);
      return 1;
    }

    throw err;
  }

  try {
    await run({ client, contextName });
  } catch (err) {
    handleError(err);
    exit(1);
  }
};

export default async client => {
  try {
    await main(client);
  } catch (err) {
    handleError(err);
    process.exit(1);
  }
};

async function run({ client, contextName }) {
  const args = argv._.slice(1);
  const start = Date.now();

  if (subcommand === 'ls' || subcommand === 'list') {
    if (args.length !== 0) {
      console.error(
        error(
          `Invalid number of arguments. Usage: ${chalk.cyan(
            `${getCommandName('projects ls')}`
          )}`
        )
      );
      return exit(2);
    }

    const stopSpinner = wait(`Fetching projects in ${chalk.bold(contextName)}`);

    let projectsUrl = '/v4/projects/?limit=20';

    const next = argv['--next'];
    if (next) {
      projectsUrl += `&until=${next}`;
    }

    const { projects: list, pagination } = await client.fetch(projectsUrl, {
      method: 'GET',
    });

    stopSpinner();

    const elapsed = ms(new Date() - start);

    console.log(
      `> ${
        list.length > 0 ? 'Projects' : 'No projects'
      } found under ${chalk.bold(contextName)} ${chalk.gray(`[${elapsed}]`)}`
    );

    if (list.length > 0) {
      const cur = Date.now();
      const header = [['', 'name', 'updated'].map(s => chalk.dim(s))];

      const out = table(
        header.concat(
          list.map(secret => [
            '',
            chalk.bold(secret.name),
            chalk.gray(`${ms(cur - new Date(secret.updatedAt))} ago`),
          ])
        ),
        {
          align: ['l', 'l', 'l'],
          hsep: ' '.repeat(2),
          stringLength: strlen,
        }
      );

      if (out) {
        console.log(`\n${out}\n`);
      }

      if (pagination && pagination.count === 20) {
        const flags = getCommandFlags(argv, ['_', '--next', '-N', '-d', '-y']);
        const nextCmd = `projects ls${flags} --next ${pagination.next}`;
        console.log(`To display the next page run ${getCommandName(nextCmd)}`);
      }
    }
    return;
  }

  if (subcommand === 'rm' || subcommand === 'remove') {
    if (args.length !== 1) {
      console.error(
        error(
          `Invalid number of arguments. Usage: ${chalk.cyan(
            `${getCommandName('project rm <name>')}`
          )}`
        )
      );
      return exit(1);
    }

    const name = args[0];

    const yes = await readConfirmation(name);
    if (!yes) {
      console.error(error('User abort'));
      return exit(0);
    }

    try {
      await client.fetch(`/v2/projects/${e(name)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      if (err.status === 404) {
        console.error(error('No such project exists'));
        return exit(1);
      }
    }
    const elapsed = ms(new Date() - start);
    console.log(
      `${chalk.cyan('> Success!')} Project ${chalk.bold(
        name
      )} removed ${chalk.gray(`[${elapsed}]`)}`
    );
    return;
  }

  if (subcommand === 'add') {
    if (args.length !== 1) {
      console.error(
        error(
          `Invalid number of arguments. Usage: ${chalk.cyan(
            `${getCommandName('projects add <name>')}`
          )}`
        )
      );

      if (args.length > 1) {
        const example = chalk.cyan(
          `${getCommandName(`projects add "${args.join(' ')}"`)}`
        );
        console.log(
          `> If your project name  has spaces, make sure to wrap it in quotes. Example: \n  ${example} `
        );
      }

      return exit(1);
    }

    const [name] = args;
    try {
      await client.fetch('/projects', {
        method: 'POST',
        body: { name },
      });
    } catch (error) {
      if (error.status === 409) {
        // project already exists, so we can
        // show a success message
      } else {
        throw error;
      }
    }
    const elapsed = ms(new Date() - start);

    console.log(
      `${chalk.cyan('> Success!')} Project ${chalk.bold(
        name.toLowerCase()
      )} added (${chalk.bold(contextName)}) ${chalk.gray(`[${elapsed}]`)}`
    );
    return;
  }

  console.error(error('Please specify a valid subcommand: ls | add | rm'));
  help();
  exit(2);
}

process.on('uncaughtException', err => {
  handleError(err);
  exit(1);
});

function readConfirmation(projectName) {
  return new Promise(resolve => {
    process.stdout.write(
      `The project: ${chalk.bold(projectName)} will be removed permanently.\n` +
        `It will also delete everything under the project including deployments.\n`
    );

    process.stdout.write(
      `${chalk.bold.red('> Are you sure?')} ${chalk.gray('[y/N] ')}`
    );

    process.stdin
      .on('data', d => {
        process.stdin.pause();
        resolve(d.toString().trim().toLowerCase() === 'y');
      })
      .resume();
  });
}
