import { stripIndents } from 'common-tags';
import { getDb, constants } from '../../Utils/functions/utils';
import { ModalBuilder, ActionRowBuilder, InteractionCollector, EmbedBuilder, ContextMenuCommandBuilder, ApplicationCommandType, TextInputStyle, TextInputBuilder, MessageContextMenuCommandInteraction, TextChannel, ModalSubmitInteraction, GuildMember } from 'discord.js';

export default {
	description: 'Report a user directly from the Chat Network!',
	data: new ContextMenuCommandBuilder()
		.setName('Report')
		.setType(ApplicationCommandType.Message),

	async execute(interaction: MessageContextMenuCommandInteraction) {
		// The message the interaction is being performed on
		const args = interaction.targetMessage;

		const connectedList = getDb()?.collection('connectedList');
		const channelInDb = await connectedList?.findOne({
			channelId: args.channel.id,
		});

		// check if args.channel is in connectedList DB
		if (!channelInDb) {
			return await interaction.reply({
				content: 'This command only works in connected **network** channels.',
				ephemeral: true,
			});
		}

		if (
			args.author.id != interaction.client.user?.id ||
			!args.embeds[0] ||
			!args.embeds[0].footer ||
			!args.embeds[0].author ||
			!args.embeds[0].author.url
		) {
			return await interaction.reply({
				content: 'Invalid usage.',
				ephemeral: true,
			});
		}

		const reportsChannel = await interaction.client.channels.fetch(constants.channel.reports);

		const reportedUser = await interaction.client.users.fetch(
			args.embeds[0].footer.text.split('┃')[-1],
		);

		const reportedServer = await interaction.client.guilds.fetch(
			args.embeds[0].author.url.split('/')[-1],
		);


		const modal = new ModalBuilder()
			.setCustomId('modal')
			.setTitle('Report')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setRequired(true)
						.setCustomId('para')
						.setStyle(TextInputStyle.Paragraph)
						.setLabel('Please enter a reason for the report')
						.setMaxLength(950),
				),
			);

		await interaction.showModal(modal);

		// create ModalBuilder input collector
		const collector = new InteractionCollector(interaction.client, {
			max: 1,
			time: 60_000,
			filter: (i) =>
				i.isModalSubmit() &&
				i.customId === 'modal' &&
				i.user.id === interaction.user.id,
		});


		// respond to message when ModalBuilder is submitted
		collector.on('collect', async (i: ModalSubmitInteraction) => {
			const reason = i.fields.getTextInputValue('para');

			// create embed with report info
			// and send it to report channel
			const embed = new EmbedBuilder()
				.setAuthor({
					name: `${reportedUser.tag} reported`,
					iconURL: reportedUser.displayAvatarURL(),
				})
				.setTitle('New User report')
				.setDescription(`**Reason**: \`${reason}\``)
				.setColor('#ff0000')
				.addFields([
					{
						name: 'Report:',
						value: stripIndents`
						**Reported User**: ${reportedUser.username}#${reportedUser.discriminator} (${reportedUser.id})
						**User from server:**: ${reportedServer.name} (${reportedServer.id})
						
						**Reported Message**: \`\`\`${args.embeds[0].fields[0].value}\`\`\` `,
					},
					{
						name: 'Reported By:',
						value: `**User**: ${i.user.tag} (${(i.member as GuildMember)?.id})\n**From**: ${i.guild?.name} ${i.guild?.id}`,
					},
				])
				.setTimestamp();
			await (reportsChannel as TextChannel)?.send({ embeds: [embed] });

			// reply to interaction
			await i.reply({ content: 'Thank you for your report!', ephemeral: true });
		});
	},
};
