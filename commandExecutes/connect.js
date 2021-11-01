const { stripIndents } = require('common-tags');
const logger = require('../logger');

module.exports = {
	async execute(interaction, connectedList) {
		const findChannel = await connectedList.findOne({ channel_id: interaction.channel.id });
		if (findChannel) {
			await interaction.reply('This channel is already connected to the chat network.');
			return;
		}
		const insertChannel = { channel_id: interaction.channel.id, channel_name: interaction.channel.name, server_id: interaction.guild.id, server_name: interaction.guild.name };

		try {
			await connectedList.insertOne(insertChannel);
			await interaction.reply('This channel has been connected to the chat network. Enjoy!');
			logger.info(`${interaction.guild.name} (${interaction.guildId}) has joined the network.`);
		}
		catch (err) {
			logger.error(err);
			await interaction.reply('An error occurred while connecting to the chat network.');
		}

		const allConnectedChannels = await connectedList.find({});

		await allConnectedChannels.forEach(channelEntry => {
			interaction.client.channels.fetch(channelEntry.channel_id).then(async channel => {
				await channel.send(stripIndents`
					A new server has joined us in the Network! <:chat_clipart:772393314413707274>

					**Server Name:** __${interaction.guild.name}__
					**Member Count:** __${interaction.guild.memberCount}__`);
			});
		});
	},
};