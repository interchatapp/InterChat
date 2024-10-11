/*
  THIS IS AN AUTOGENERATED FILE. DO NOT EDIT IT DIRECTLY.
  To regenerate this file, run 'pnpm gen:locale-types'.
*/

export type TranslationKeys = {
  rules: 'support_invite';
  'vote.description': never;
  'vote.footer': never;
  'network.accountTooNew': 'emoji' | 'user';
  'network.deleteSuccess': 'emoji' | 'user' | 'deleted' | 'total';
  'network.editSuccess': 'emoji' | 'user' | 'edited' | 'total';
  'network.welcome': 'emoji' | 'user' | 'hub' | 'totalServers' | 'channel' | 'rules_command';
  'network.onboarding.embed.title': 'hubName';
  'network.onboarding.embed.description': 'docs_link';
  'network.onboarding.embed.footer': 'version';
  'network.onboarding.inProgress': 'emoji' | 'channel';
  'blacklist.success': 'emoji' | 'name';
  'blacklist.removed': 'emoji' | 'name';
  'blacklist.modal.reason.label': never;
  'blacklist.modal.reason.placeholder': never;
  'blacklist.modal.duration.label': never;
  'blacklist.modal.duration.placeholder': never;
  'blacklist.user.alreadyBlacklisted': 'emoji';
  'blacklist.user.easterEggs.blacklistBot': never;
  'blacklist.server.alreadyBlacklisted': 'emoji';
  'blacklist.server.unknownError': 'server';
  'blacklist.list.user': 'id' | 'moderator' | 'reason' | 'expires';
  'blacklist.list.server': 'id' | 'moderator' | 'reason' | 'expires';
  'msgInfo.buttons.message': never;
  'msgInfo.buttons.server': never;
  'msgInfo.buttons.user': never;
  'msgInfo.buttons.report': never;
  'msgInfo.message.description': 'emoji' | 'author' | 'server' | 'messageId' | 'hub' | 'createdAt';
  'msgInfo.server.description':
    | 'server'
    | 'description'
    | 'owner'
    | 'createdAtFull'
    | 'createdAt'
    | 'memberCount'
    | 'invite';
  'msgInfo.user.description':
    | 'username'
    | 'id'
    | 'createdAtFull'
    | 'createdAt'
    | 'globalName'
    | 'hubsOwned';
  'msgInfo.report.notEnabled': 'emoji';
  'msgInfo.report.success': 'emoji';
  invite: 'invite_emoji' | 'invite' | 'support_emoji' | 'support';
  'connection.notFound': 'emoji';
  'connection.channelNotFound': 'emoji';
  'connection.alreadyConnected': 'emoji' | 'channel';
  'connection.switchChannel': 'emoji';
  'connection.switchCalled': 'emoji';
  'connection.switchSuccess': 'emoji' | 'channel';
  'connection.inviteRemoved': 'emoji';
  'connection.inviteInvalid': 'emoji';
  'connection.inviteAdded': 'emoji';
  'connection.emColorInvalid': 'emoji';
  'connection.emColorChange': 'emoji' | 'action';
  'connection.embed.title': never;
  'connection.embed.fields.hub': never;
  'connection.embed.fields.channel': never;
  'connection.embed.fields.invite': never;
  'connection.embed.fields.connected': never;
  'connection.embed.fields.emColor': never;
  'connection.embed.fields.compact': never;
  'connection.embed.fields.profanity': never;
  'connection.embed.footer': never;
  'connection.selects.placeholder': never;
  'connection.unpaused.desc': 'tick_emoji' | 'channel';
  'connection.unpaused.tips': 'pause_cmd' | 'customize_cmd';
  'connection.paused.desc': 'clock_emoji' | 'channel';
  'connection.paused.tips': 'unpause_cmd' | 'leave_cmd';
  'hub.notFound': 'emoji';
  'hub.notFound_mod': 'emoji';
  'hub.alreadyJoined': 'emoji' | 'hub' | 'channel';
  'hub.invalidChannel': 'emoji';
  'hub.invalidImgurUrl': 'emoji';
  'hub.join.success': 'hub' | 'channel';
  'hub.servers.total': 'from' | 'to' | 'total';
  'hub.servers.noConnections': 'emoji';
  'hub.servers.notConnected': 'emoji' | 'hub';
  'hub.servers.connectionInfo': 'channelName' | 'channelId' | 'joinedAt' | 'invite' | 'connected';
  'hub.create.modal.title': never;
  'hub.create.modal.name.label': never;
  'hub.create.modal.name.placeholder': never;
  'hub.create.modal.description.label': never;
  'hub.create.modal.description.placeholder': never;
  'hub.create.modal.icon.label': never;
  'hub.create.modal.icon.placeholder': never;
  'hub.create.modal.banner.label': never;
  'hub.create.modal.banner.placeholder': never;
  'hub.create.maxHubs': 'emoji';
  'hub.create.invalidName': 'emoji';
  'hub.create.nameTaken': 'emoji';
  'hub.create.success': 'name' | 'docs_link' | 'support_invite';
  'hub.delete.confirm': 'hub';
  'hub.delete.ownerOnly': 'emoji';
  'hub.delete.success': 'emoji' | 'hub';
  'hub.delete.cancelled': 'emoji';
  'hub.browse.joinConfirm': 'hub' | 'channel';
  'hub.browse.joinFooter': never;
  'hub.browse.noHubs': 'emoji';
  'hub.browse.rating.invalid': never;
  'hub.browse.rating.success': never;
  'hub.invite.create.success': 'inviteCode' | 'expiry' | 'docs_link';
  'hub.invite.revoke.invalidCode': 'emoji';
  'hub.invite.revoke.success': 'emoji' | 'inviteCode';
  'hub.invite.list.title': never;
  'hub.invite.list.noInvites': 'emoji';
  'hub.invite.list.notPrivate': 'emoji';
  'hub.joined.noJoinedHubs': 'emoji';
  'hub.joined.joinedHubs': 'total';
  'hub.leave.noHub': 'emoji';
  'hub.leave.confirm': 'hub' | 'channel';
  'hub.leave.confirmFooter': never;
  'hub.leave.success': 'emoji' | 'channel';
  'hub.moderator.noModerators': 'emoji';
  'hub.moderator.add.success': 'emoji' | 'user' | 'position';
  'hub.moderator.add.alreadyModerator': 'emoji' | 'user';
  'hub.moderator.remove.success': 'emoji' | 'user';
  'hub.moderator.remove.notModerator': 'emoji' | 'user';
  'hub.moderator.remove.notOwner': 'emoji';
  'hub.moderator.update.success': 'emoji' | 'user' | 'position';
  'hub.moderator.update.notModerator': 'emoji' | 'user';
  'hub.moderator.update.notAllowed': 'emoji';
  'hub.moderator.update.notOwner': 'emoji';
  'hub.manage.enterImgurUrl': never;
  'hub.manage.icon.changed': never;
  'hub.manage.icon.modal.title': never;
  'hub.manage.icon.modal.label': never;
  'hub.manage.icon.selects.label': never;
  'hub.manage.icon.selects.description': never;
  'hub.manage.description.changed': never;
  'hub.manage.description.modal.title': never;
  'hub.manage.description.modal.label': never;
  'hub.manage.description.modal.placeholder': never;
  'hub.manage.description.selects.label': never;
  'hub.manage.description.selects.description': never;
  'hub.manage.banner.changed': never;
  'hub.manage.banner.removed': never;
  'hub.manage.banner.modal.title': never;
  'hub.manage.banner.modal.label': never;
  'hub.manage.banner.selects.label': never;
  'hub.manage.banner.selects.description': never;
  'hub.manage.visibility.success': 'emoji' | 'visibility';
  'hub.manage.visibility.selects.label': never;
  'hub.manage.visibility.selects.description': never;
  'hub.manage.logs.title': never;
  'hub.manage.logs.reset': 'emoji' | 'type';
  'hub.manage.logs.roleSuccess': 'emoji' | 'type' | 'role';
  'hub.manage.logs.channelSuccess': 'emoji' | 'type' | 'channel';
  'hub.manage.logs.channelSelect': never;
  'hub.manage.logs.roleSelect': never;
  'hub.manage.logs.reportChannelFirst': 'emoji';
  'hub.manage.logs.config.title': 'type';
  'hub.manage.logs.config.description': 'arrow' | 'arrow';
  'hub.manage.logs.config.fields.channel': never;
  'hub.manage.logs.config.fields.role': never;
  'hub.manage.logs.reports.label': never;
  'hub.manage.logs.reports.description': never;
  'hub.manage.logs.modLogs.label': never;
  'hub.manage.logs.modLogs.description': never;
  'hub.manage.logs.profanity.label': never;
  'hub.manage.logs.profanity.description': never;
  'hub.manage.logs.joinLeaves.label': never;
  'hub.manage.logs.joinLeaves.description': never;
  'hub.manage.logs.appeals.label': never;
  'hub.manage.logs.appeals.description': never;
  'report.modal.title': never;
  'report.modal.other.label': never;
  'report.modal.other.placeholder': never;
  'report.modal.bug.input1.label': never;
  'report.modal.bug.input1.placeholder': never;
  'report.modal.bug.input2.label': never;
  'report.modal.bug.input2.placeholder': never;
  'report.submitted': 'emoji' | 'support_command';
  'report.bug.title': never;
  'report.bug.affected': never;
  'report.bug.description': never;
  'language.set': 'lang';
  'errors.messageNotSentOrExpired': never;
  'errors.notYourAction': 'emoji';
  'errors.notMessageAuthor': 'emoji';
  'errors.commandError': 'emoji' | 'support_invite' | 'errorId';
  'errors.mustVote': never;
  'errors.inviteLinks': 'emoji';
  'errors.invalidLangCode': 'emoji';
  'errors.unknownServer': 'emoji';
  'errors.unknownNetworkMessage': 'emoji';
  'errors.userNotFound': 'emoji';
  'errors.blacklisted': 'emoji';
  'errors.userBlacklisted': 'emoji';
  'errors.serverBlacklisted': 'emoji';
  'errors.serverNotBlacklisted': 'emoji';
  'errors.userNotBlacklisted': 'emoji';
  'errors.missingPermissions': 'emoji' | 'permissions';
  'errors.botMissingPermissions': 'emoji' | 'permissions';
  'errors.unknown': 'emoji' | 'support_invite';
  'errors.notUsable': 'emoji';
  'errors.cooldown': 'emoji' | 'time';
  'errors.banned': 'emoji' | 'reason' | 'support_invite';
  'misc.webhookNoLongerExists': 'emoji';
  'misc.noReason': never;
  'misc.noDesc': never;
  'misc.version': 'version';
  'misc.loading': 'emoji';
  'misc.reportOptionMoved': 'emoji' | 'support_invite';
};

export type ErrorLocaleKeys = Extract<keyof TranslationKeys, `errors.${string}`>;
