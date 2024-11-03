import { emojis } from '#utils/Constants.js';
import { OriginalMessage } from '#main/utils/network/messageUtils.js';
import { getReplyMethod } from '#main/utils/Utils.js';
import { InfoEmbed } from '#utils/EmbedUtils.js';
import { type supportedLocaleCodes, t } from '#utils/Locale.js';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  RepliableInteraction,
  Snowflake,
} from 'discord.js';

export interface ModAction {
  handle(
    interaction: ButtonInteraction,
    originalMsgId: Snowflake,
    locale: supportedLocaleCodes,
  ): Promise<void>;
  handleModal?(
    interaction: ModalSubmitInteraction,
    originalMsg: OriginalMessage,
    locale: supportedLocaleCodes,
  ): Promise<void>;
}

export async function replyWithUnknownMessage(
  interaction: RepliableInteraction,
  locale: supportedLocaleCodes,
  edit = false,
) {
  const embed = new InfoEmbed().setDescription(
    t('errors.unknownNetworkMessage', locale, { emoji: emojis.no }),
  );

  const replyMethod = getReplyMethod(interaction);

  if (edit) await interaction.editReply({ embeds: [embed] });
  else await interaction[replyMethod]({ embeds: [embed], ephemeral: true });
}
