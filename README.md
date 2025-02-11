<p align="center"><img src="https://github.com/user-attachments/assets/33f68c3a-67bc-4653-8578-2ab350ac3a75" alt="interchat logo" style="border-radius: 50%; width: 150px; height: 150px;"></p>

<p align="center"><strong>InterChat</strong></p>

<p align="center">
A powerful Discord bot for easy and real-time chatting hubs across multiple Discord servers.
</p>

<p align="center">
<a href="https://codeclimate.com/github/Discord-InterChat/InterChat/maintainability">
  <img src="https://api.codeclimate.com/v1/badges/97ca95fdce0e3c2c6146/maintainability" alt="Maintainability">
</a>
<img src="https://img.shields.io/github/package-json/v/discord-interchat/interchat?logo=npm&color=fedcba" alt="GitHub package.json version">
<a href="https://top.gg/bot/769921109209907241">
  <img src="https://top.gg/api/widget/servers/769921109209907241.svg/" alt="Discord Bots">
</a>
<a href="https://discord.gg/cgYgC6YZyX">
<img src="https://img.shields.io/discord/770256165300338709?style=flat&logo=discord&logoColor=white&label=discord&color=5865F2" alt="Discord">
</a>
</p>

<br />

<div align="center">
  <a href="#-getting-started"><kbd> <br> Invite InterChat&ensp;<br> </kbd></a>&ensp;&ensp;
  <a href="#-support"><kbd> <br> Support Server&ensp;<br> </kbd></a>&ensp;&ensp;
  <a href="https://interchat.tech/vote"><kbd> <br> Vote on Top.gg <br> </kbd></a>&ensp;&ensp;
</div>

<br>

<div align="center">
  <a href="https://ko-fi.com/V7V017M8GW">
    <img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Donate">
  </a>
</div>

## 🌟 Features

- 🔗 **Cross-Server Messaging**: Connect channels from different servers and allow users to chat in real-time.
- 🕸️ **Flexible Webhooks**: Utilizes webhooks per channel to ensure uninterrupted communication.
- ⛔ **Block Word Lists**: Set up custom block word lists to filter or block specific words and regex patterns in messages.
- 🛠️ **Cross-Server Moderation**: Manage users with built-in NSFW detection and infraction system. Track blacklists, infractions, and appeal requests through modals.
- 🆓 **Generous Free Tier**: Enjoy most features at no cost!
- 🌱 **Mini-Communities**: Form your own "Hubs" by connecting specific channels across multiple servers for shared conversations.

## 🚀 Getting Started

1. Invite InterChat to your Discord server using [this link][invite].
2. Use the `/hub browse` command to configure your first hub.
3. Connect a channel to a hub containing many other discord servers using the `/hub join` command.
4. Start chatting across servers!

For detailed instructions, check out our [Donate](https://ko-fi.com/interchat).

## 💻 Self-Hosting

While InterChat is available as a hosted bot, you can also self-host it. Follow these steps:

1. Clone the repository:

   ```sh
   git clone https://github.com/discord-interchat/interchat.git
   ```

2. Install dependencies:

   ```sh
   bun i
   ```

3. Set up your `.env` file with your Discord bot token and other required environment variables.
4. Run the bot:

   ```sh
   bun dev
   ```

## 🤝 Contributing

We welcome contributions to InterChat! Here's how you can help:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them with a clear commit message.
4. Push your changes to your fork.
5. Submit a pull request to the main repository.

Please read our [Contributing Guidelines](CONTRIBUTING.md) for more details.

## 📜 License

InterChat is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). This license requires that the software and any modifications remain free and open source and that the source code must be made available when the software is used as a network service.
For full terms and conditions, see the [`LICENSE`](LICENSE) file in the repository.

## 📞 Support

If you need help or have any questions, join our [Discord support server][support]

## ✨ Acknowledgements

Thanks to the Discord community and all our contributors:

<a href="https://github.com/discord-interchat/interchat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=discord-interchat/interchat" />
</a>

---

<p align="center">
Made with ❤️ by the <a href="https://github.com/orgs/Discord-InterChat/people">InterChat Team</a>!
</p>

[invite]: https://interchat.tech/invite
[support]: https://discord.gg/cgYgC6YZyX

<!--
## Tensorflow Errors

Some Windows users face the following problem:

```sh
Error: The specified module could not be found.
\\?\C:\Users\<username>\...otherpathstuff\InterChat\node_modules\@tensorflow\tfjs-node\lib\napi-v8\tfjs_binding.node
```

A simple fix would be to copy `node_modules/@tensorflow/tfjs-node/lib/napi-v9/tensorflow.dll` into `node_modules/@tensorflow/tfjs-node/lib/napi-v8/`. Everything should work fine after that. (just use linux frfr)
 -->