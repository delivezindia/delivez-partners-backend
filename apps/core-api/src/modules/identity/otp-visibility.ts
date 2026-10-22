/**
 * Whether the login code is returned to the browser (shown on the login screen).
 * Always in development. In production only while OTP_SHOW_IN_RESPONSE=true AND no real SMS gateway is set —
 * a temporary bridge until MSG91 is live; setting SMS_PROVIDER=MSG91 hides it automatically.
 */
export const showOtpInResponse = (env: NodeJS.ProcessEnv = process.env) =>
  env.NODE_ENV !== 'production' || (env.OTP_SHOW_IN_RESPONSE === 'true' && (env.SMS_PROVIDER ?? 'DEV').toUpperCase() !== 'MSG91');
