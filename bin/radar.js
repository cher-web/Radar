#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as auth from '../src/cli/commands/auth.js';
import * as accounts from '../src/cli/commands/accounts.js';
import * as scanCmd from '../src/cli/commands/scan.js';
import * as eventsCmd from '../src/cli/commands/events.js';
import * as digestCmd from '../src/cli/commands/digest.js';
import * as uiCmd from '../src/cli/commands/ui.js';
import * as publishCmd from '../src/cli/commands/publish.js';
import { closeAllBrowsers } from '../src/scanner/browser.js';

let _shuttingDown = false;
async function shutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  process.stderr.write(`\nreceived ${signal}, cleaning up...\n`);
  await closeAllBrowsers();
  process.exit(130);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
);

const program = new Command();
program
  .name('radar')
  .description('Instagram arts & music event scanner')
  .version(pkg.version);

program
  .command('scan')
  .description('Scan tracked accounts for events')
  .option('--stories', 'scan stories only')
  .option('--posts', 'scan feed posts only')
  .option('--account <handle>', 'scan a single account')
  .action((opts) => scanCmd.scan(opts));

const accountsCmd = program
  .command('accounts')
  .description('Manage tracked accounts');
accountsCmd
  .command('list', { isDefault: true })
  .description('List all tracked accounts')
  .action(() => accounts.list());
accountsCmd
  .command('add <handle>')
  .option('--tag <tag>', 'category tag (venue|music|art|promoter|gallery|festival|collective)')
  .action((handle, opts) => accounts.add(handle, opts));
accountsCmd
  .command('remove <handle>')
  .action((handle) => accounts.remove(handle));
accountsCmd
  .command('import <path>')
  .description('Import accounts from a shared accounts.json file')
  .action((path) => accounts.importFile(path));
accountsCmd
  .command('export <path>')
  .description('Export accounts to a shareable accounts.json file')
  .action((path) => accounts.exportFile(path));

program
  .command('events')
  .description('Show extracted events')
  .option('--all', 'include past and low-confidence events')
  .option('--upcoming', 'show only upcoming events (default)')
  .option('--since <N>', 'events found in the last Nd (e.g. 7d)')
  .action((opts) => eventsCmd.events(opts));

program
  .command('digest')
  .description('Print a formatted event digest')
  .option('--save', 'save digest to ./digests/YYYY-MM-DD.md')
  .option('--format <fmt>', 'text | markdown', 'text')
  .option('--all', 'include low-confidence events')
  .action((opts) => digestCmd.digest(opts));

program
  .command('publish')
  .description('Upload upcoming events + screenshots to R2 for the public calendar')
  .action(() => publishCmd.publish());

program
  .command('ui')
  .description('Start the local web UI')
  .option('--port <n>', 'port to listen on', '4510')
  .option('--no-open', "don't auto-open the browser")
  .action((opts) => uiCmd.ui(opts));

const authCmd = program
  .command('auth')
  .description('Manage Instagram session');
authCmd.command('login').action(() => auth.login());
authCmd.command('status').action(() => auth.status());
authCmd.command('logout').action(() => auth.logout());

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
