/**
 * 登录 / 注册。
 *
 * 两种方式：
 *  1) 微信一键登录（优先）—— wx.login 拿 code，交给云服务换取会话；
 *  2) 手机号验证码登录 / 注册 —— 新号码即为注册，老号码直接登录。
 *
 * 所有功能都要求已登录；未登录时统一 reLaunch 到登录页。
 */
const { cloud } = require('./cloud')

let cachedSession = null
let sessionInflight = null
let pendingOtp = null

function cacheSession(session) {
  cachedSession = session || null
  return cachedSession
}

/** 读取当前会话（带缓存）。force=true 时强制向服务端确认 */
function getSession(force) {
  if (cachedSession && !force) {
    return Promise.resolve(cachedSession)
  }
  if (sessionInflight) return sessionInflight

  sessionInflight = cloud.auth
    .getSession()
    .then((res) => {
      sessionInflight = null
      if (!res || res.error || !res.data) return cacheSession(null)
      return cacheSession(res.data)
    })
    .catch(() => {
      sessionInflight = null
      return cacheSession(null)
    })

  return sessionInflight
}

/** 受保护页面的统一入口：没有会话就回登录页 */
function requireLogin() {
  return getSession().then((session) => {
    if (!session) {
      wx.reLaunch({ url: '/pages/login/login' })
      return null
    }
    return session
  })
}

function currentUserId() {
  return cachedSession && cachedSession.user ? cachedSession.user.id : null
}

function currentUserName() {
  if (!cachedSession || !cachedSession.user) return null
  const user = cachedSession.user
  return user.name || user.nickname || null
}

/** 微信一键登录 */
function signInWithWechat() {
  return new Promise((resolve) => {
    wx.login({
      success({ code }) {
        if (!code) {
          resolve({ ok: false, message: '微信登录失败，请重试' })
          return
        }
        let appid = ''
        try {
          appid = wx.getAccountInfoSync().miniProgram.appId
        } catch (e) {
          appid = ''
        }
        cloud.auth
          .signInWithWechat(code, appid)
          .then(({ data, error }) => {
            if (error) {
              resolve({ ok: false, message: error.message || '微信登录失败' })
              return
            }
            cacheSession(data)
            resolve({ ok: true, session: data })
          })
          .catch((error) => {
            console.error(
              '[WorkBuddy Cloud] login failed',
              JSON.stringify({
                stage: 'wechat-login-handler',
                message: error instanceof Error ? error.message : '微信登录失败，请重试',
              })
            )
            resolve({ ok: false, message: '微信登录失败，请重试' })
          })
      },
      fail(error) {
        console.error(
          '[WorkBuddy Cloud] login failed',
          JSON.stringify({ stage: 'wx.login', message: error.errMsg })
        )
        resolve({ ok: false, message: error.errMsg || '微信登录失败' })
      },
    })
  })
}

/** 发送手机验证码。返回 { ok, message } */
function sendPhoneCode(phone) {
  if (!/^1\d{10}$/.test(phone)) {
    return Promise.resolve({ ok: false, message: '请输入正确的 11 位手机号' })
  }
  return cloud.auth
    .sendOtp({ phone })
    .then((res) => {
      if (res.error) {
        pendingOtp = null
        return { ok: false, message: res.error.message || '验证码发送失败' }
      }
      pendingOtp = {
        phone: phone,
        verificationId: res.data.verificationId,
        isExistingUser: res.data.isExistingUser,
      }
      return { ok: true, isExistingUser: !!res.data.isExistingUser }
    })
    .catch((error) => {
      pendingOtp = null
      return { ok: false, message: error && error.message ? error.message : '验证码发送失败' }
    })
}

/** 提交验证码完成登录 / 注册。 */
function verifyPhoneCode(phone, token) {
  const pending = pendingOtp
  if (!pending || pending.phone !== phone) {
    return Promise.resolve({ ok: false, message: '请先获取该手机号的验证码' })
  }
  return cloud.auth
    .verifyOtp({
      phone: pending.phone,
      verificationId: pending.verificationId,
      isExistingUser: pending.isExistingUser,
      token: token,
    })
    .then((res) => {
      if (res.error) {
        return { ok: false, message: res.error.message || '验证码校验失败' }
      }
      pendingOtp = null
      cacheSession(res.data)
      return { ok: true, session: res.data }
    })
    .catch((error) => {
      return { ok: false, message: error && error.message ? error.message : '验证码校验失败' }
    })
}

function clearPendingOtp() {
  pendingOtp = null
}

function hasPendingOtp(phone) {
  return !!pendingOtp && pendingOtp.phone === phone
}

/** 强制刷新会话 */
function refreshSession() {
  return cloud.auth.refreshSession().then((res) => {
    if (res && res.data) cacheSession(res.data)
    return cachedSession
  })
}

function signOut() {
  return cloud.auth
    .signOut()
    .catch(() => null)
    .then(() => {
      cachedSession = null
      pendingOtp = null
      wx.reLaunch({ url: '/pages/login/login' })
    })
}

module.exports = {
  getSession,
  requireLogin,
  currentUserId,
  currentUserName,
  signInWithWechat,
  sendPhoneCode,
  verifyPhoneCode,
  clearPendingOtp,
  hasPendingOtp,
  refreshSession,
  signOut,
  cacheSession,
}
