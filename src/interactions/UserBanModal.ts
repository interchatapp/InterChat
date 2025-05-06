import ComponentContext from '#src/core/CommandContext/ComponentContext.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { handleBan } from '#src/utils/BanUtils.js';

export default class WarnModalHandler {
  @RegisterInteractionHandler('userBanModal')
  async handleModal(ctx: ComponentContext): Promise<void> {
    if (!ctx.isModalSubmit()) return;

    const [userId] = ctx.customId.args;

    const user = await ctx.client.users.fetch(userId).catch(() => null);
    const reason = ctx.getModalFieldValue('reason');

    await handleBan(ctx, userId, user, reason);
  }
}
