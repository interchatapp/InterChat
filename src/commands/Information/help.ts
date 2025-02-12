/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { InfoEmbed } from '#src/utils/EmbedUtils.js';
import { ApplicationCommandOptionType, type Collection } from 'discord.js';

export default class Help extends BaseCommand {
  constructor() {
    super({
      name: 'help',
      description: 'List all of my commands or info about a specific command.',
      types: { prefix: true, slash: true },
      options: [
        {
          name: 'command',
          description: 'The command to get info on.',
          type: ApplicationCommandOptionType.String,
          required: false,
          autocomplete: true,
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const { commands } = ctx.client;

    const command = ctx.options.getString('command');
    if (!command) {
      const embed = this.getHelpEmbed(commands);
      await ctx.reply({ embeds: [embed] });
      return;
    }

    const cmd = commands.get(command);
    if (!cmd) {
      await ctx.reply(`I couldn't find a command named \`${command}\``);
      return;
    }

    const embed = new InfoEmbed()
      .setTitle(`Command: ${cmd.name}`)
      .setDescription(`**Description:** ${cmd.description}`)
      .addFields(
        // { name: '**Usage:**', value: cmd.usage },
        // {
        //   name: '**Aliases:**',
        //   value: cmd.aliases.map((a) => `\`${a}\``).join(', '),
        // },
      );

    await ctx.reply({ embeds: [embed] });
  }

  private getHelpEmbed(commands: Collection<string, BaseCommand>) {
    const embed = new InfoEmbed()
      .setTitle('Available Commands')
      .setFooter({ text: 'Use c!help [command] for more info' });

    let description = '';
    for (const command of commands.values()) {
      description += `\nc!${command.name} \n-# > ${command.description}`;
    }

    embed.setDescription(description);
    return embed;
  }
}
