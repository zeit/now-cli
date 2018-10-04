// @flow
import chalk from 'chalk'
import ms from 'ms'
import table from 'text-table'
const plural = require('pluralize')

import { CLIContext, Output } from '../../util/types'
import deleteCertById from '../../util/certs/delete-cert-by-id'
import getCertById from '../../util/certs/get-cert-by-id'
import getCerts from '../../util/certs/get-certs'
import getContextName from '../../util/get-context-name'
import Now from '../../util'
import stamp from '../../util/output/stamp'
import type { CLICertsOptions } from '../../util/types'

async function rm(ctx: CLIContext, opts: CLICertsOptions, args: string[], output: Output): Promise<number> {
  const {authConfig: { token }, config} = ctx
  const { currentTeam } = config;
  const { apiUrl } = ctx;
  const rmStamp = stamp()
  const debug = opts['--debug']
  const contextName = await getContextName({ apiUrl, token, debug, currentTeam })

  // $FlowFixMe
  const now = new Now({ apiUrl, token, debug, currentTeam })

  if (args.length !== 1) {
    output.error(
      `Invalid number of arguments. Usage: ${chalk.cyan(
        '`now certs rm <id or cn>`'
      )}`
    );
    now.close();
    return 1;
  }

  const idOrCn = args[0]
  const certs = await getCertsToDelete(output, now, idOrCn)
  if (certs.length === 0) {
    output.error(`No certificates found by id or cn "${idOrCn}" under ${chalk.bold(contextName)}`)
    now.close();
    return 1;
  }

  const yes = await readConfirmation(output, 'The following certificates will be removed permanently', certs)
  if (!yes) {
    now.close();
    return 0;
  }

  await Promise.all(certs.map(cert => deleteCertById(output, now, cert.uid)))
  output.success(`${chalk.bold(plural('Certificate', certs.length, true))} removed ${rmStamp()}`)
  return 0
}

async function getCertsToDelete(output: Output, now: Now, idOrCn: string) {
  const cert = await getCertById(output, now, idOrCn)
  return !cert
    ? await getCerts(output, now, [idOrCn])
    : [cert]
}

function readConfirmation(output, msg, certs) {
  return new Promise(resolve => {
    output.log(msg)
    output.print(table([...certs.map(formatCertRow)], {
      align: ['l', 'r', 'l'],
      hsep: ' '.repeat(6)
    }).replace(/^(.*)/gm, '  $1') + '\n')
    output.print(`${chalk.bold.red('> Are you sure?')} ${chalk.gray('[y/N] ')}`)
    process.stdin.on('data', d => {
      process.stdin.pause()
      resolve(d.toString().trim().toLowerCase() === 'y')
    }).resume()
  })
}

function formatCertRow(cert) {
  return [
    cert.uid,
    chalk.bold(cert.cns.join(', ')),
    chalk.gray(ms(new Date() - new Date(cert.created)) + ' ago')
  ]
}

export default rm
