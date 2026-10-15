/**
 * 云服务公开配置。
 *
 * 这里只允许出现 publicConfig 里的四个字段（resourceId / endpoint / oauthRelayBaseUrl /
 * publishableKey）。它们是唯一可以放进前端代码的值；publishableKey 本身不带权限，
 * 服务端会做来源校验。请勿在此写入任何长期密钥，也不要在日志里打印它。
 *
 * 例外：TENCENT_LBS_KEY 是腾讯位置服务（WebServiceAPI）的「前端明文密钥」。它不符合上面的
 * “长期密钥”定义（有每日配额上限、可在控制台随时重置、仅用于客户端调用），且小程序端直连
 * 天气接口必须明文携带。如介意盗刷风险，可在腾讯控制台开启「签名校验」并改用自有服务端中转。
 */
const publicConfig = {
  resourceId: 'wbcs_g0Ek9uv30DhloLujQBgkik',
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_2YN6Wi1n7MiR84OMwFUEUe_NlpSrvyKFOCxssUjiDEH385tdIdDpSYI',
}

/**
 * 腾讯位置服务 · 天气 WebServiceAPI 密钥。
 * 申请：https://lbs.qq.com （控制台 → 密钥管理 → 创建 key，勾选 WebServiceAPI）。
 * 关键配置：
 *   1) 直连调用需在「该 key → 授权 AppID」里填入本小程序的 AppID（或关闭签名校验，不推荐）；
 *   2) 在微信公众平台「开发管理 → 服务器域名 → request 合法域名」加入 https://apis.map.qq.com ；
 *   3) 免费额度 6000 次/日（非商业）。
 * 留空时天气继续走「本地气候估算 + AI 精修」兜底，不影响其它功能。
 */
const TENCENT_LBS_KEY = ''

module.exports = { publicConfig, TENCENT_LBS_KEY }
