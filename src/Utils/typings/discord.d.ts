import discord from 'discord.js';

type commands = {
	developer?: boolean,
	staff?: boolean,
	description?: string | undefined
	data: discord.SlashCommandBuilder,
	execute: (interaction: discord.ChatInputCommandInteraction | discord.MessageContextMenuCommandInteraction) => void|unknown
}

declare module 'discord.js' {
    export interface Client {
		commands: discord.Collection<string, commands>,
		description: string,
		version: string,
		help: Array<{name: string, value: string}>
		sendInNetwork(message: string): Promise<void>;
	}
}