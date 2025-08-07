<div align="center">
  <img src="https://github.com/user-attachments/assets/33f68c3a-67bc-4653-8578-2ab350ac3a75" alt="interchat logo" width="150" height="150" style="border-radius: 50%">

# InterChat

  *Connect Discord communities seamlessly with real-time cross-server communication*

  [![Maintainability](https://api.codeclimate.com/v1/badges/97ca95fdce0e3c2c6146/maintainability)](https://codeclimate.com/github/interchatapp/InterChat/maintainability)
  [![Version](https://img.shields.io/github/package-json/v/interchatapp/interchat?logo=npm&color=fedcba)](https://github.com/interchatapp/InterChat)
  [![Servers](https://top.gg/api/widget/servers/769921109209907241.svg/)](https://top.gg/bot/769921109209907241)
  [![Discord](https://img.shields.io/discord/770256165300338709?style=flat&logo=discord&logoColor=white&label=discord&color=5865F2)](https://discord.gg/cgYgC6YZyX)

  [Add to Discord](https://interchat.tech/invite) • [Documentation](https://interchat.tech/docs) • [Support Server](https://discord.gg/cgYgC6YZyX) • [Vote for Us](https://interchat.tech/vote)

  <a href="https://ko-fi.com/V7V017M8GW"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support us on Ko-fi" height="30"></a>
</div>

> [!WARNING]
> # Archival Notice
> This repository is no longer maintained. The updated and rewritten version is in [interchatapp/InterChat.py](https://github.com/interchatapp/InterChat.py). Rewritten to be all in Python.

## 📋 About InterChat

InterChat is a powerful Discord bot that breaks down the walls between communities by enabling real-time cross-server communication. Whether you're looking to build topic-focused communities, connect with like-minded servers, or simply expand your server's reach, InterChat provides the tools to make it happen.

With InterChat, messages flow naturally between connected servers, creating vibrant, engaged communities that transcend individual Discord servers. Our hub-based system allows you to join existing communities or create your own, while our call feature enables quick one-to-one server connections.

## ✨ Key Features

<!-- <div align="center">
  <img src="https://your-demo-image-url-here.gif" alt="InterChat Demo" width="600">
</div> -->

- 🌐 **Cross-Server Communication**
  - **Hub System**: Join or create themed communities with multiple connected servers
  - **Call Feature**: Quick temporary one-to-one connections between servers
  - **Real-time Messaging**: Messages delivered instantly across all connected servers
  - **Rich Media Support**: Share images, embeds, and reactions across servers

- 🛡️ **Advanced Security & Moderation**
  - **Smart Content Filtering**: Block inappropriate content automatically
  - **Anti-Spam Protection**: Keep conversations clean and relevant
  - **Comprehensive Logging**: Track cross-server activity
  - **Moderation Tools**: Manage users across server boundaries

- 🎮 **Intuitive Dashboard**
  - **Visual Hub Management**: Create, configure, and monitor hubs
  - **Server Insights**: Understand connection activity
  - **Mobile Compatibility**: Manage your communities from any device

- 🔧 **Customization Options**
  - **Custom Welcome Messages**: Personalize the experience for new members
  - **Hub Rules**: Set specific guidelines for your community
  - **Flexible Permissions**: Control who can do what in your hubs
  - **Multiple Languages**: InterChat supports various languages

## 🚀 Getting Started

### Adding InterChat to Your Server

1. **Invite the Bot**: Visit [interchat.tech/invite](https://interchat.tech/invite)
2. **Run Setup**: Type `/setup` in your server to start the guided setup process
3. **Choose Your Path**:
   - **Join a Hub**: Use [interchat.tech/hubs] to find and join existing cross-server groups
   - **Create a Hub**: Use `/hub create` to start your own community
   - **Quick Connect**: Use `/call` for one-to-one server connections

### Basic Commands

```
/setup - Start the guided setup process
/hub create - Create your own hub
/connect - Connect a channel to a hub
/call - Start a direct call with another server
/hangup - End an active call
/vote - Vote for InterChat and unlock perks
/help - View all available commands
```

## 🔧 Required Permissions

InterChat requires the following permissions to function properly:

- **Manage Webhooks** - Essential for message delivery
- **Send Messages** - To relay messages between servers
- **Manage Messages** - For moderation features
- **Embed Links** - For rich content display
- **Read Messages** - To process messages for relay
- **Use External Emojis** - For a better user experience

## 💻 Self-Hosting

```bash
# Clone the repository
git clone https://github.com/interchatapp/InterChat.git

# Install dependencies
cd interchat
npm install

# Configure environment
# Edit .env with your credentials

npx prisma generate
npx prisma db push # sync database schema


npm run build
npm run sync:commands --private --public
npm run sync:emojis
npm run locale-types

# Start development server
npm run dev

# Or production mode
npm start
```

## 🌐 Links & Resources

- **[Official Website](https://interchat.tech)**: Documentation, hub directory, and more
- **[Support Server](https://discord.gg/cgYgC6YZyX)**: Get help, report issues, and connect with the community
- **[Vote for InterChat](https://top.gg/bot/769921109209907241/vote)**: Support us and unlock voter perks
- **[Ko-fi Page](https://ko-fi.com/interchat)**: Support development and get premium features

## 🤝 Contributing

We welcome all contributions! Here's how you can help:

1. 🐛 [Report bugs](https://github.com/interchatapp/InterChat/issues)
2. 💡 [Suggest features](https://github.com/interchatapp/InterChat/issues)
3. 📝 Improve documentation
4. 🌍 [Help with translations](https://crowdin.com/project/interchat)
5. 💻 Submit pull requests

Read our [Contributing Guidelines](CONTRIBUTING.md) to get started.

## 📜 License

InterChat is licensed under [GNU AGPL-3.0](LICENSE)

<div align="center">

## 💖 Contributors

<a href="https://github.com/interchatapp/interchat/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=interchatapp/interchat" />
</a>

---

Made with ❤️ by the [InterChat Team](https://github.com/orgs/interchatapp/people)

</div>
