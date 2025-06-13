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

import { PrismaClient } from '#src/generated/prisma/client/client.js';
import { stripIndents } from 'common-tags';

const prisma = new PrismaClient();

async function main() {
  // Create tutorials
  const newUserTutorial = await prisma.tutorial.upsert({
    where: { name: 'Getting Started with InterChat' },
    update: {},
    create: {
      name: 'Getting Started with InterChat',
      description: stripIndents`Learn the basics of InterChat and how to connect with other servers.`,
      targetAudience: 'new-user',
      estimatedTimeMinutes: 5,
    },
  });

  const serverSetupTutorial = await prisma.tutorial.upsert({
    where: { name: 'Server Setup Guide' },
    update: {},
    create: {
      name: 'Server Setup Guide',
      description: stripIndents`Set up InterChat in your server with the optimal configuration.`,
      targetAudience: 'admin',
      estimatedTimeMinutes: 10,
    },
  });

  const hubCreationTutorial = await prisma.tutorial.upsert({
    where: { name: 'Creating Your First Hub' },
    update: {},
    create: {
      name: 'Creating Your First Hub',
      description: stripIndents`Learn how to create and configure a hub to connect multiple servers.`,
      targetAudience: 'admin',
      estimatedTimeMinutes: 8,
    },
  });

  // Create steps for the hub creation tutorial
  const hubCreationSteps = [
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Hub Creation Overview',
      description: stripIndents`Welcome to the Hub Creation tutorial! Hubs are the central feature of InterChat, allowing you to create communities that span across multiple Discord servers.

      In this tutorial, you\'ll learn how to create and configure your own hub.`,
      order: 0,
      actionType: 'information',
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Creating a Hub',
      description: stripIndents`To create a hub:

      1. Use the \`/hub create\` command
      2. Fill in the required information in the modal:
         - Hub name (must be unique)
         - Description
         - Optional: Hub icon URL

      Once created, you\'ll become the hub owner with full control over its settings.`,
      order: 1,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub create' }),
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Hub Visibility',
      description: stripIndents`By default, your hub is private. You can change its visibility:

      - **Private hubs** are invitation-only and won\'t appear in the hub browser
      - **Public hubs** are discoverable through the hub browser on our website

      To change visibility, use \`/hub visibility hub:YourHub visibility:public|private\`.`,
      order: 2,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub visibility' }),
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Setting Hub Rules',
      description: stripIndents`Clear rules help maintain a positive community:

      1. Use \`/hub config rules\` to set hub rules
      2. Enter your rules in the modal that appears
      3. Rules will be shown to users when they join the hub

      Well-defined rules make moderation easier and set clear expectations.`,
      order: 3,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub config rules' }),
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Creating Hub Invites',
      description: stripIndents`For private hubs, you\'ll need to create invite codes:

      - Use \`/hub invite create hub:YourHub\` to create a new invite
      - Optional parameters:
        - \`uses\`: Maximum number of uses
        - \`expiry\`: How long the invite is valid

      Share these invite codes with server administrators who want to join your hub.`,
      order: 4,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub invite create' }),
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Setting Up Welcome Messages',
      description: stripIndents`Welcome messages greet new servers when they join your hub:

      1. Use \`/hub config welcome\` to set a welcome message
      2. Enter your message in the modal that appears
      3. This message will be sent when a new server joins

      A good welcome message introduces your hub and explains its purpose.`,
      order: 5,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub config welcome' }),
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Adding Moderators',
      description: stripIndents`As your hub grows, you may want to add moderators:

      - Use \`/hub moderator add hub:YourHub user:@User position:moderator|manager\`
      - Positions:
        - **Manager**: Can manage most hub settings and moderators
        - **Moderator**: Can moderate messages and users

      Choose trusted individuals who understand your community values.`,
      order: 6,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub moderator add' }),
    },
    {
      tutorialId: hubCreationTutorial.id,
      title: 'Hub Management',
      description: stripIndents`Other useful hub management commands:

      - \`/hub edit\` - Edit hub details (name, description, icon)
      - \`/hub config settings\` - Adjust hub settings like filters and reactions
      - \`/hub config logging\` - Set up logging channels
      - \`/hub servers\` - View all servers in your hub
      - \`/hub announce\` - Send an announcement to all channels

      Congratulations! You now know how to create and manage a hub!`,
      order: 7,
      actionType: 'information',
    },
  ];

  for (const step of hubCreationSteps) {
    await prisma.tutorialStep.upsert({
      where: {
        id: `${step.tutorialId}-${step.order}`,
      },
      update: step,
      create: {
        id: `${step.tutorialId}-${step.order}`,
        ...step,
      },
    });
  }

  const moderationTutorial = await prisma.tutorial.upsert({
    where: { name: 'Moderation Tools' },
    update: {},
    create: {
      name: 'Moderation Tools',
      description: 'Discover the moderation tools available to keep your community safe.',
      targetAudience: 'moderator',
      estimatedTimeMinutes: 10,
    },
  });

  // Create steps for the moderation tutorial
  const moderationSteps = [
    {
      tutorialId: moderationTutorial.id,
      title: 'Moderation Overview',
      description: stripIndents`
      Welcome to the Moderation Tools tutorial! As a hub moderator, you have access to powerful tools to keep your community safe and welcoming.

      In this tutorial, you\'ll learn about the various moderation features available in InterChat.`,
      order: 0,
      actionType: 'information',
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'Moderator Roles',
      description: stripIndents`InterChat has three levels of moderation permissions:

      1. **Hub Owner** - Full control over the hub
      2. **Hub Manager** - Can manage most hub settings and moderators
      3. **Hub Moderator** - Can moderate messages and users

      You can view all moderators in a hub with \`/hub moderator list\`.`,
      order: 1,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub moderator list' }),
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'Content Filtering',
      description: stripIndents`InterChat provides automatic content filtering to prevent inappropriate content:

      - Use \`/hub config settings\` to enable spam and NSFW filters
      - Use \`/hub config anti-swear\` to set up custom word filters
      - Filters can use regex patterns for advanced matching

      Filtered messages are automatically blocked and logged.`,
      order: 2,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub config anti-swear' }),
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'User Management',
      description: stripIndents`
      To manage problematic users:

      - Use \`/blacklist user\` to ban a user from the hub
      - Use \`/warn\` to issue a warning to a user
      - Use \`/hub infractions\` to view a user\'s history

      All moderation actions are logged for accountability.`,
      order: 3,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'blacklist user' }),
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'Server Management',
      description: stripIndents`
      If an entire server is causing problems:

      - Use \`/blacklist server\` to remove and ban a server from the hub
      - Use \`/hub servers\` to view all servers in the hub

      Server blacklists affect all users from that server.`,
      order: 4,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub servers' }),
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'Logging',
      description: stripIndents`
      Set up logging to keep track of moderation actions:

      1. Use \`/hub config logging\` to configure log channels
      2. Choose which events to log:
         - Moderation actions
         - Join/leave events
         - Reports
         - Appeals
         - Network alerts

      Proper logging is essential for effective moderation.`,
      order: 5,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub config logging' }),
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'Handling Reports',
      description: stripIndents`Users can report inappropriate content with the \`/report\` command:

      1. Reports appear in your configured report log channel
      2. Each report includes the message content and context
      3. Moderators can take action directly from the report

      Respond to reports promptly to maintain community trust.`,
      order: 6,
      actionType: 'information',
    },
    {
      tutorialId: moderationTutorial.id,
      title: 'Moderation Best Practices',
      description: stripIndents`Tips for effective moderation:

      - Be consistent in enforcing rules
      - Document reasons for moderation actions
      - Use appropriate action levels for violations
      - Communicate clearly with users about expectations
      - Review logs regularly to identify patterns

      Good moderation is key to a healthy community!`,
      order: 7,
      actionType: 'information',
    },
  ];

  for (const step of moderationSteps) {
    await prisma.tutorialStep.upsert({
      where: {
        id: `${step.tutorialId}-${step.order}`,
      },
      update: step,
      create: {
        id: `${step.tutorialId}-${step.order}`,
        ...step,
      },
    });
  }

  // Create prerequisites
  await prisma.tutorialPrerequisite.upsert({
    where: {
      tutorialId_prerequisiteId: {
        tutorialId: hubCreationTutorial.id,
        prerequisiteId: serverSetupTutorial.id,
      },
    },
    update: {},
    create: {
      tutorialId: hubCreationTutorial.id,
      prerequisiteId: serverSetupTutorial.id,
    },
  });

  await prisma.tutorialPrerequisite.upsert({
    where: {
      tutorialId_prerequisiteId: {
        tutorialId: moderationTutorial.id,
        prerequisiteId: newUserTutorial.id,
      },
    },
    update: {},
    create: {
      tutorialId: moderationTutorial.id,
      prerequisiteId: newUserTutorial.id,
    },
  });

  // Create steps for the new user tutorial
  const newUserSteps = [
    {
      tutorialId: newUserTutorial.id,
      title: 'Welcome to InterChat',
      description: stripIndents`'InterChat connects Discord communities through active cross-server discussions. Messages flow naturally between servers in real-time, helping you build engaged topic-focused communities.

      In this tutorial, you'll learn the basics of using InterChat.`,
      order: 0,
      actionType: 'information',
    },
    {
      tutorialId: newUserTutorial.id,
      title: 'Finding Hubs',
      description: stripIndents`Hubs are the central connection points in InterChat. They allow multiple servers to communicate with each other.

      To find available hubs, use the [InterChat Hub Discovery](https://interchat.tech/hubs). This will show you a list of public hubs you can join.`,
      order: 1,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub browse' }),
    },
    {
      tutorialId: newUserTutorial.id,
      title: 'Connecting to a Hub',
      description: stripIndents`Once you've found a hub you\'re interested in, you can connect your channel to it using the \`/connect\` command followed by the hub name.

      For example: \`/connect hub:Gaming\` would connect your current channel to the Gaming hub.`,
      order: 2,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'connect' }),
    },
    {
      tutorialId: newUserTutorial.id,
      title: 'Sending Messages',
      description: stripIndents`Once your server is connected to a hub, you can send messages that will be visible to all other servers in that hub.

      Just type in the connected channel like you normally would in Discord!`,
      order: 3,
      actionType: 'information',
    },
    {
      tutorialId: newUserTutorial.id,
      title: 'Using Commands',
      description: stripIndents`InterChat has many useful commands. You can see a full list by typing \`/help\`.

      Some commonly used commands include:
      - \`/hub\` - Manage your hubs
      - \`/connection\` - Manage your connections
      - \`/disconnect\` - Disconnect a channel from a hub
      - \`/tutorial\` - Access these tutorials again`,
      order: 4,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'help' }),
    },
  ];

  for (const step of newUserSteps) {
    await prisma.tutorialStep.upsert({
      where: {
        id: `${step.tutorialId}-${step.order}`,
      },
      update: step,
      create: {
        id: `${step.tutorialId}-${step.order}`,
        ...step,
      },
    });
  }

  // Create steps for the server setup tutorial
  const serverSetupSteps = [
    {
      tutorialId: serverSetupTutorial.id,
      title: 'Server Setup Overview',
      description: stripIndents`Welcome to the Server Setup Guide! This tutorial will walk you through setting up InterChat in your server.

      As a server admin, you\'ll learn how to configure channels, permissions, and connect to hubs.`,
      order: 0,
      actionType: 'information',
    },
    {
      tutorialId: serverSetupTutorial.id,
      title: 'Creating a Dedicated Channel',
      description: stripIndents`First, it\'s recommended to create a dedicated channel for InterChat connections. This helps keep your server organized.

      1. Go to your server settings
      2. Click on "Channels"
      3. Create a new text channel (e.g., #interchat-connections)

      Once created, make sure InterChat has permission to send messages in this channel.`,
      order: 1,
      actionType: 'information',
    },
    {
      tutorialId: serverSetupTutorial.id,
      title: 'Setting Up Permissions',
      description: stripIndents`Make sure InterChat has the following permissions in your server:

      - Read Messages
      - Send Messages
      - Embed Links
      - Attach Files
      - Read Message History
      - Use External Emojis

      These permissions are essential for InterChat to function properly.`,
      order: 2,
      actionType: 'information',
    },
    {
      tutorialId: serverSetupTutorial.id,
      title: 'Joining or Creating a Hub',
      description: stripIndents`Now you need to either join an existing hub or create your own:

      - To join: Use \`/connect hub:[hub name]\` in the channel you want to connect
      - To create: Use \`/hub create\`

      If you\'re new to InterChat, we recommend joining an existing hub first to see how it works. You can browse available hubs with the [InterChat Hub Discovery](https://interchat.tech/hubs).`,
      order: 3,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub create' }),
    },
    {
      tutorialId: serverSetupTutorial.id,
      title: 'Configuring Hub Settings',
      description: stripIndents`InterChat provides powerful moderation and configuration tools to keep your community safe.

      Use \`/hub config settings\` to configure:
      - Spam filter
      - NSFW content filter
      - Message reactions
      - Anonymous mode

      You can also set up word filters with \`/hub config anti-swear\` and configure logging with \`/hub config logging\`.`,
      order: 4,
      actionType: 'command',
      actionData: JSON.stringify({ command: 'hub config settings' }),
    },
    {
      tutorialId: serverSetupTutorial.id,
      title: 'Setup Complete!',
      description: stripIndents`Congratulations! Your server is now set up with InterChat.

      Next steps:
      - Create your own hub with \`/hub create\`
      - Invite other servers to join your hub with \`/hub invite create\`
      - Set up welcome messages with \`/hub config welcome\`
      - Configure logging with \`/hub config logging\`

      Check out the "Creating Your First Hub" tutorial to learn more!`,
      order: 5,
      actionType: 'information',
    },
  ];

  for (const step of serverSetupSteps) {
    await prisma.tutorialStep.upsert({
      where: {
        id: `${step.tutorialId}-${step.order}`,
      },
      update: step,
      create: {
        id: `${step.tutorialId}-${step.order}`,
        ...step,
      },
    });
  }

  console.log('Tutorial seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
