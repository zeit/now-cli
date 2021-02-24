import chalk from 'chalk';
import logo from '../../util/output/logo';
import { getPkgName } from '../../util/pkg-name.ts';

export const help = () => `
  ${chalk.bold(`${logo} ${getPkgName()}`)} [options] <command | path>

  ${chalk.dim('Commands:')}

    ${chalk.dim('Basic')}

      deploy               [path]      Performs a deployment ${chalk.bold(
        '(default)'
      )}
      dev                              Start a local development server
      env                              Manages the Environment Variables for your current Project
      help                 [cmd]       Displays complete help for [cmd]
      ls | list            [app]       Lists deployments
      init                 [example]   Initialize an example project
      inspect              [id]        Displays information related to a deployment
      login                [email]     Logs into your account or creates a new one
      logout                           Logs out of your account
      switch               [scope]     Switches between teams and your personal account

    ${chalk.dim('Advanced')}

      bisect                           Use binary search to find the deployment that introduced a bug
      certs                [cmd]       Manages your SSL certificates
      dns                  [name]      Manages your DNS records
      domains              [name]      Manages your domain names
      logs                 [url]       Displays the logs for a deployment
      rm | remove          [id]        Removes a deployment
      secrets              [name]      Manages your global Secrets, for use in Environment Variables
      teams                            Manages your teams
      whoami                           Shows the username of the currently logged in user

  ${chalk.dim('Options:')}

    -h, --help                     Output usage information
    -v, --version                  Output the version number
    -V, --platform-version         Set the platform version to deploy to
    -A ${chalk.bold.underline('FILE')}, --local-config=${chalk.bold.underline(
  'FILE'
)}   Path to the local ${'`vercel.json`'} file
    -Q ${chalk.bold.underline('DIR')}, --global-config=${chalk.bold.underline(
  'DIR'
)}    Path to the global ${'`.vercel`'} directory
    -d, --debug                    Debug mode [off]
    -f, --force                    Force a new deployment even if nothing has changed
    --with-cache                   Retain build cache when using "--force"
    -t ${chalk.underline('TOKEN')}, --token=${chalk.underline(
  'TOKEN'
)}        Login token
    -p, --public                   Deployment is public (${chalk.dim(
      '`/_src`'
    )} is exposed)
    -e, --env                      Include an env var during run time (e.g.: ${chalk.dim(
      '`-e KEY=value`'
    )}). Can appear many times.
    -b, --build-env                Similar to ${chalk.dim(
      '`--env`'
    )} but for build time only.
    -m, --meta                     Add metadata for the deployment (e.g.: ${chalk.dim(
      '`-m KEY=value`'
    )}). Can appear many times.
    -C, --no-clipboard             Do not attempt to copy URL to clipboard
    -S, --scope                    Set a custom scope
    --regions                      Set default regions to enable the deployment on
    --prod                         Create a production deployment
    -c, --confirm                  Confirm default options and skip questions

  ${chalk.dim('Examples:')}

  ${chalk.gray('–')} Deploy the current directory

    ${chalk.cyan(`$ ${getPkgName()}`)}

  ${chalk.gray('–')} Deploy a custom path

    ${chalk.cyan(`$ ${getPkgName()} /usr/src/project`)}

  ${chalk.gray('–')} Deploy with Environment Variables

    ${chalk.cyan(
      `$ ${getPkgName()} -e NODE_ENV=production -e SECRET=@mysql-secret`
    )}

  ${chalk.gray('–')} Show the usage information for the sub command ${chalk.dim(
  '`list`'
)}

    ${chalk.cyan(`$ ${getPkgName()} help list`)}

`;

export const args = {
  '--force': Boolean,
  '--with-cache': Boolean,
  '--public': Boolean,
  '--no-clipboard': Boolean,
  '--env': [String],
  '--build-env': [String],
  '--meta': [String],
  // This is not an array in favor of matching
  // the config property name.
  '--regions': String,
  '--prod': Boolean,
  '--confirm': Boolean,
  '-f': '--force',
  '-p': '--public',
  '-e': '--env',
  '-b': '--build-env',
  '-C': '--no-clipboard',
  '-m': '--meta',
  '-c': '--confirm',

  // deprecated
  '--name': String,
  '-n': '--name',
  '--target': String,
};
