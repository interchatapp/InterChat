import DevAnnounceCommand from './send-alert.js';
import BaseCommand from '#src/core/BaseCommand.js';

export default class DevCommand extends BaseCommand {
  constructor() {
    super({
      name: 'dev',
      description: 'ooh spooky',
      types: {
        slash: true,
        prefix: true,
      },
      subcommands: {
        'send-alert': new DevAnnounceCommand(),
      },
    });
  }
}
