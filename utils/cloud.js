/**
 * 云服务客户端（微信小程序形态）。
 *
 * 只初始化一次，Auth / Database / Storage / LLM 四个模块共用这一个实例。
 * 小程序没有 location.origin，因此 endpoint 必须显式传入，不能依赖同源回退。
 *
 * ⚠️ 这里的初始化必须包 try/catch：
 * 本模块在 app.js 第一行就被 require，一旦初始化抛错，App() 永远不会注册，
 * 真机上的表现就是「整包白屏、没有任何报错」。捕获后降级为「调用即失败」的实例，
 * 让界面至少能够启动，并把真实原因显示出来（见 app.js 的 onError）。
 */
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram')
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics')
const { publicConfig } = require('./config')

/**
 * 云服务不可用时的降级实例。
 * 目标不是「能用」，而是「不崩」：任何属性访问都返回可继续链式的节点，
 * await / .then 时抛出明确原因，让上层 catch 得到可读文案。
 */
function createUnavailableCloud(reason) {
  const ERR_TEXT = '云服务初始化失败：' + reason

  function makeError() {
    const err = new Error(ERR_TEXT)
    err.code = 'CLOUD_INIT_FAILED'
    return err
  }

  function makeNode() {
    const target = {
      then(onFulfilled, onRejected) {
        return Promise.reject(makeError()).then(onFulfilled, onRejected)
      },
      catch(onRejected) {
        return Promise.reject(makeError()).catch(onRejected)
      },
      finally(fn) {
        return Promise.reject(makeError()).finally(fn)
      },
    }
    // Proxy 不可用的极老环境：直接退回空对象，至少模块加载不会抛错
    if (typeof Proxy !== 'function') return target
    return new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop]
        if (typeof prop !== 'string') return undefined
        return function () {
          return makeNode()
        }
      },
    })
  }

  const stub = {}
  ;['auth', 'database', 'storage', 'llm'].forEach((name) => {
    stub[name] = makeNode()
  })
  return stub
}

let cloud = null
let cloudInitError = ''

try {
  cloud = createMiniProgramWorkBuddyCloud({
    endpoint: publicConfig.endpoint,
    publishableKey: publicConfig.publishableKey,
    wx: createDiagnosticWx(wx),
  })
} catch (error) {
  cloudInitError = (error && (error.message || error.errMsg)) || String(error)
  console.error('[cloud] 初始化失败，已降级为不可用实例：' + cloudInitError, error)
  cloud = createUnavailableCloud(cloudInitError)
}

module.exports = { cloud, cloudInitError }
