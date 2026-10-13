/**
 * 云服务客户端（微信小程序形态）。
 *
 * 只初始化一次，Auth / Database / Storage / LLM 四个模块共用这一个实例。
 * 小程序没有 location.origin，因此 endpoint 必须显式传入，不能依赖同源回退。
 */
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')
const { publicConfig } = require('./config')

const cloud = createMiniProgramWorkBuddyCloud({
  endpoint: publicConfig.endpoint,
  publishableKey: publicConfig.publishableKey,
  wx: createDiagnosticWx(wx),
})

module.exports = { cloud }
