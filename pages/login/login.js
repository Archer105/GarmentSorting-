const auth = require('../../utils/auth')
const util = require('../../utils/util')

const app = getApp()
const COUNTDOWN_SECONDS = 60

Page({
  data: {
    heroPadding: 150,
    showPhone: false,
    phone: '',
    code: '',
    phoneError: '',
    focus: '',
    agreed: true,
    wechatLoading: false,
    sending: false,
    submitting: false,
    countdown: 0,
    canSendCode: false,
  },

  onLoad() {
    this.setData({ heroPadding: app.statusBarHeight() + 96 })
    auth.getSession().then((session) => {
      if (session) {
        wx.switchTab({ url: '/pages/index/index' })
      }
    })
  },

  onUnload() {
    this.stopCountdown()
  },

  /* ------------------------------- 交互 ------------------------------- */

  togglePhone() {
    this.setData({ showPhone: true })
  },

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed })
  },

  onFocus(e) {
    this.setData({ focus: e.currentTarget.dataset.name })
  },

  onBlur() {
    this.setData({ focus: '' })
  },

  onPhoneInput(e) {
    const phone = e.detail.value
    this.setData({ phone: phone, phoneError: '' }, () => this.refreshCanSend())
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value })
  },

  refreshCanSend() {
    const ok = /^1\d{10}$/.test(this.data.phone) && this.data.countdown === 0 && !this.data.sending
    if (ok !== this.data.canSendCode) this.setData({ canSendCode: ok })
  },

  /* ------------------------------- 登录 ------------------------------- */

  ensureAgreed() {
    if (!this.data.agreed) {
      util.toast('请先阅读并同意用户协议')
      return false
    }
    return true
  },

  onWechatLogin() {
    if (this.data.wechatLoading) return
    if (!this.ensureAgreed()) return
    this.setData({ wechatLoading: true })
    auth
      .signInWithWechat()
      .then((res) => {
        this.setData({ wechatLoading: false })
        if (!res.ok) {
          util.toast(util.errText(res.message, '微信登录失败'))
          return
        }
        this.enter()
      })
      .catch((error) => {
        this.setData({ wechatLoading: false })
        util.toast(util.errText(error, '微信登录失败'))
      })
  },

  onSendCode() {
    if (this.data.sending || this.data.countdown > 0) return
    const phone = this.data.phone
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ phoneError: '请输入正确的 11 位手机号', canSendCode: false })
      return
    }
    this.setData({ sending: true, phoneError: '' })
    auth
      .sendPhoneCode(phone)
      .then((res) => {
        this.setData({ sending: false })
        if (!res.ok) {
          this.setData({ phoneError: util.errText(res.message, '验证码发送失败') })
          this.refreshCanSend()
          return
        }
        util.toast('验证码已发送')
        this.startCountdown()
      })
      .catch((error) => {
        this.setData({ sending: false, phoneError: util.errText(error, '验证码发送失败') })
        this.refreshCanSend()
      })
  },

  onSubmit() {
    if (this.data.submitting) return
    if (!this.ensureAgreed()) return
    const phone = this.data.phone
    const code = this.data.code
    if (!/^1\d{10}$/.test(phone)) {
      this.setData({ phoneError: '请输入正确的 11 位手机号' })
      return
    }
    if (!auth.hasPendingOtp(phone)) {
      this.setData({ phoneError: '请先获取该手机号的验证码' })
      return
    }
    if (!/^\d{4,6}$/.test(code)) {
      util.toast('请输入收到的验证码')
      return
    }
    this.setData({ submitting: true })
    auth
      .verifyPhoneCode(phone, code)
      .then((res) => {
        this.setData({ submitting: false })
        if (!res.ok) {
          util.toast(util.errText(res.message, '验证失败，请重试'))
          return
        }
        this.enter()
      })
      .catch((error) => {
        this.setData({ submitting: false })
        util.toast(util.errText(error, '验证失败，请重试'))
      })
  },

  startCountdown() {
    this.stopCountdown()
    this.setData({ countdown: COUNTDOWN_SECONDS, canSendCode: false })
    this.timer = setInterval(() => {
      const next = this.data.countdown - 1
      if (next <= 0) {
        this.stopCountdown()
        this.setData({ countdown: 0 }, () => this.refreshCanSend())
        return
      }
      this.setData({ countdown: next })
    }, 1000)
  },

  stopCountdown() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  enter() {
    wx.switchTab({ url: '/pages/index/index' })
  },
})
