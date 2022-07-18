const { SlashCommandBuilder, ChatInputCommandInteraction } = require('discord.js');
const { topgg } = require('../../utils');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('test')
		.setDescription('topgg vote system'),
	/**
	* @param {ChatInputCommandInteraction} interaction
	*/
	async execute(interaction) {
		const voted = await topgg.hasVoted(interaction.user.id);
		if (voted) {await interaction.reply({ content: 'Thanks for voting!' });}
		else { await interaction.reply('You didnt vote :(');}
	},
};