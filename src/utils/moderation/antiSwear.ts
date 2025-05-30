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

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { type BlockWord, BlockWordAction } from '#src/generated/prisma/client/client.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import { supportedLocaleCodes, t } from '#src/utils/Locale.js';
import { numberEmojis } from '#utils/Constants.js';
import { CustomID } from '#utils/CustomID.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';

export const ACTION_LABELS = {
  [BlockWordAction.BLOCK_MESSAGE]: '🚫 Block Message',
  [BlockWordAction.SEND_ALERT]: '🔔 Send Alert',
  [BlockWordAction.BLACKLIST]: '⛔ Blacklist User/Server',
} as const;

export const sanitizeWords = (words: string) =>
  words
    // Only trim each word, no regex conversion
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .join(',');

export const buildAntiSpamListEmbed = (
  rules: BlockWord[],
  locale: supportedLocaleCodes,
  client: Client,
) =>
  new InfoEmbed()
    .removeTitle()
    .setDescription(
      t('hub.blockwords.listDescription', locale, {
        totalRules: rules.length.toString(),
        emoji: getEmoji('alert_icon', client),
      }),
    )
    .addFields(
      rules.map(({ name, actions }, index) => ({
        name: `${numberEmojis[index + 1]}: ${name}`,
        value: `**Actions:** ${actions.map((a) => ACTION_LABELS[a]).join(', ') || 'None'}`,
      })),
    )
    .setFooter({ text: t('hub.blockwords.listFooter', locale) });

export const buildEditAntiSwearRuleButton = (hubId: string, ruleId: string) =>
  new ButtonBuilder()
    .setCustomId(new CustomID('antiSwear:editRule', [hubId, ruleId]).toString())
    .setLabel('Edit Rule')
    .setStyle(ButtonStyle.Secondary);

export const buildAntiSwearModal = (
  hubId: string,
  { locale, presetRule }: { locale: supportedLocaleCodes; presetRule?: BlockWord },
) => {
  const customId = new CustomID('antiSwear:modal', [hubId]);
  const modal = new ModalBuilder()
    .setTitle(
      presetRule
        ? t('hub.blockwords.modal.editingRule', locale)
        : t('hub.blockwords.modal.addRule', locale),
    )
    .setCustomId(customId.toString())
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setStyle(TextInputStyle.Short)
          .setLabel(t('hub.blockwords.modal.ruleNameLabel', locale))
          .setMinLength(3)
          .setMaxLength(40)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('words')
          .setStyle(TextInputStyle.Paragraph)
          .setLabel(t('hub.blockwords.modal.wordsLabel', locale))
          .setPlaceholder(t('hub.blockwords.modal.wordsPlaceholder', locale))
          .setMinLength(3)
          .setRequired(true),
      ),
    );

  if (presetRule) {
    modal.setCustomId(customId.setArgs(hubId, presetRule.id).toString());
    modal.components[0].components[0].setValue(presetRule.name);
    modal.components[1].components[0].setValue(presetRule.words);
  }

  return modal;
};

export const buildBlockWordActionsSelect = (
  hubId: string,
  ruleId: string,
  currentActions: BlockWordAction[],
  locale: supportedLocaleCodes,
) =>
  new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(new CustomID('antiSwear:actions', [hubId, ruleId]).toString())
      .setPlaceholder(t('hub.blockwords.actionSelectPlaceholder', locale))
      .setMinValues(1)
      .setMaxValues(Object.keys(BlockWordAction).length)
      .setOptions(
        Object.entries(ACTION_LABELS).map(([value, label]) => ({
          label,
          value,
          default: currentActions.includes(value as BlockWordAction),
        })),
      ),
  );
