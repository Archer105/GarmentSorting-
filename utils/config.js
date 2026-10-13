/**
 * 云服务公开配置。
 *
 * 这里只允许出现 publicConfig 里的四个字段（resourceId / endpoint / oauthRelayBaseUrl /
 * publishableKey）。它们是唯一可以放进前端代码的值；publishableKey 本身不带权限，
 * 服务端会做来源校验。请勿在此写入任何长期密钥，也不要在日志里打印它。
 */
const publicConfig = {
  resourceId: 'wbcs_g0Ek9uv30DhloLujQBgkik',
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_2YN6Wi1n7MiR84OMwFUEUe_NlpSrvyKFOCxssUjiDEH385tdIdDpSYI',
}

module.exports = { publicConfig }
