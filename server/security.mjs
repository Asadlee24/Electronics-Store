export const securityHeaders = {
 'X-Content-Type-Options': 'nosniff',
 'Referrer-Policy': 'same-origin',
 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export const documentHeaders = {
 ...securityHeaders,
 'X-Frame-Options': 'DENY',
 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
};
