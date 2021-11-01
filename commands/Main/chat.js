const { SlashCommandBuilder, SlashCommandSubcommandBuilder } = require('@discordjs/builders');
const mongoUtil = require('../../mongoUtil');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('chat')
		.setDescription('Manage the chat network for this server.')
		.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName('connect')
			.setDescription('Connect to the chat network.'),
		)
		.addSubcommand(new SlashCommandSubcommandBuilder()
			.setName('disconnect')
			.setDescription('Disconnect from the chat network.'),
		),
	async execute(interaction) {
		const subcommand = interaction.options.getSubcommand();
		const database = mongoUtil.getDb();
		const connectedList = database.collection('connected_list');

		const subcommandFile = require(`../../commandExecutes/${subcommand}`);
		subcommandFile.execute(interaction, connectedList);
	},
};