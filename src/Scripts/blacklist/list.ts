import { stripIndents } from 'common-tags';
import { APIEmbedField, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { paginate } from '../../Utils/functions/paginator';
import { colors, getDb } from '../../Utils/functions/utils';

module.exports = {
  async execute(interaction: ChatInputCommandInteraction) {
    const serverOpt = interaction.options.getString('type');

    const embeds: EmbedBuilder[] = [];
    let fields: APIEmbedField[] = [];

    const LIMIT = 5;
    let counter = 0;

    // loop through all data
    // after counter hits limit (5) assign fields to an embed and push to to embeds array
    // reset counter & clear fields array
    // repeat until you reach the end

    if (serverOpt == 'server') {
      const result = await getDb().blacklistedServers.findMany();

      result.forEach((data, index) => {
        fields.push({
          name: data.serverName,
          value: stripIndents`
          **ServerId:** ${data.serverId}
          **Reason:** ${data.reason}
          **Expires:** ${!data.expires ? 'Never.' : `<t:${Math.round(data.expires.getTime() / 1000)}:R>`}     
          `,
        });

        counter++;
        if (counter >= LIMIT || index === result.length - 1) {
          embeds.push(new EmbedBuilder()
            .setFields(fields)
            .setColor('#0099ff')
            .setAuthor({
              name: 'Blacklisted Servers:',
              iconURL: interaction.client.user?.avatarURL()?.toString(),
            }));

          counter = 0;
          fields = [];
        }
      });
    }
    else if (serverOpt == 'user') {
      const result = await getDb().blacklistedUsers.findMany();

      result.forEach((data, index) => {
        fields.push({
          name: data.username,
          value: stripIndents`
          **UserID:** ${data.userId}
          **Reason:** ${data.reason}
          **Expires:** ${!data.expires ? 'Never.' : `<t:${Math.round(data.expires.getTime() / 1000)}:R>`}
          `,
        });

        counter++;
        if (counter >= LIMIT || index === result.length - 1) {
          embeds.push(new EmbedBuilder()
            .setFields(fields)
            .setColor(colors('chatbot'))
            .setAuthor({
              name: 'Blacklisted Users:',
              iconURL: interaction.client.user?.avatarURL()?.toString(),
            }));

          counter = 0;
          fields = [];
        }
      });
    }

    paginate(interaction, embeds);
  },
};
