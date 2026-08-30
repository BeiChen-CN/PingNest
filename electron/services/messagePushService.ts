import { ConfigService } from './config'
import { chatService } from './chatService'
import { MessagePushService } from './messagePushCore'

export type { MessagePushPayload, MessagePushDeps } from './messagePushCore'
export { MessagePushService } from './messagePushCore'

export const messagePushService = new MessagePushService({
  configService: ConfigService.getInstance(),
  chatService
})
