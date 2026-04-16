import chalk from 'chalk';

export const ok = (msg) => console.log(chalk.green('✓'), msg);
export const warn = (msg) => console.log(chalk.yellow('!'), msg);
export const err = (msg) => console.error(chalk.red('✗'), msg);
export const info = (msg) => console.log(chalk.dim('·'), msg);
export const heading = (msg) => console.log('\n' + chalk.bold(msg));

export function notImplemented(name) {
  warn(`${chalk.bold(name)} — not implemented yet`);
}
