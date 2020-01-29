import path from 'path';
import 'dotenv/config';

import DevServer from '../../util/dev/server';
import parseListen from '../../util/dev/parse-listen';
import { Output } from '../../util/output';
import { NowContext } from '../../types';
import Client from '../../util/client';
import { getLinkedProject } from '../../util/projects/link';
import { getFrameworks } from '../../util/get-frameworks';
import { isSettingValue } from '../../util/is-setting-value';

type Options = {
  '--debug'?: boolean;
  '--listen'?: string;
};

export default async function dev(
  ctx: NowContext,
  opts: Options,
  args: string[],
  output: Output
) {
  const [dir = '.'] = args;
  const cwd = path.resolve(dir);
  const listen = parseListen(opts['--listen'] || process.env.PORT || '3000');
  const debug = opts['--debug'] || false;

  const client = new Client({
    apiUrl: ctx.apiUrl,
    token: ctx.authConfig.token,
    currentTeam: ctx.config.currentTeam,
    debug,
  });

  // retrieve dev command
  const [[, project], frameworks] = await Promise.all([
    getLinkedProject(output, client, cwd),
    getFrameworks(),
  ]);

  let devCommand: undefined | string;
  if (project) {
    if (project.devCommand) {
      devCommand = project.devCommand;
    } else if (project.framework) {
      const framework = frameworks.find(f => f.slug === project.framework);

      if (framework) {
        const defaults = framework.settings.devCommand;

        if (isSettingValue(defaults)) {
          devCommand = defaults.value;
        }
      }
    }
  }

  const devServer = new DevServer(cwd, { output, debug, devCommand });

  process.once('SIGINT', () => devServer.stop());

  await devServer.start(...listen);
}
