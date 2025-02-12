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
import UserDbService from '#src/services/UserDbService.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import {
  type supportedLocaleCodes,
  supportedLocales,
  t,
} from '#utils/Locale.js';
import {
  ApplicationCommandOptionType,
} from 'discord.js';

const currSupportedLangs = ['en', 'hi', 'es', 'pt'] as const;

export default class SetLanguage extends BaseCommand {
  constructor() {
    super({
      name: 'language',
      description: '🈂️ Set the language in which I should respond to you',
      types: { slash: true },
      options: [
        {
          name: 'lang',
          description: 'The language to set',
          type: ApplicationCommandOptionType.String,
          required: true,
          choices: currSupportedLangs.map((l) => ({
            name: supportedLocales[l].name,
            value: l,
          })),
        },
      ],
    });
  }

  async execute(ctx: Context) {
    const locale = ctx.options.getString('lang') as supportedLocaleCodes | undefined;

    if (!locale || !Object.keys(supportedLocales).includes(locale)) {
      await ctx.reply({
        content: t(
          'errors.invalidLangCode',
          await fetchUserLocale(ctx.user.id),
          {
            emoji: ctx.getEmoji('info'),
          },
        ),
        flags: ['Ephemeral'],
      });
      return;
    }

    const { id, username } = ctx.user;
    const userService = new UserDbService();
    await userService.upsertUser(id, { locale, username });

    const langInfo = supportedLocales[locale];
    const lang = `${langInfo.emoji} ${langInfo.name}`;

    await ctx.reply({
      content: ctx.getEmoji('tick_icon') + t('language.set', locale, { lang }),
      flags: ['Ephemeral'],
    });
  }
}
