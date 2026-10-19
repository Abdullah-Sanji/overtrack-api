export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const layout = (rawTitle: string, rawBody: string, rawCta: { label: string; href: string }) => {
  const title = escapeHtml(rawTitle); const body = escapeHtml(rawBody); const cta = { label: escapeHtml(rawCta.label), href: escapeHtml(rawCta.href) };
  return `<!doctype html>
<html><body style="font-family:Arial,sans-serif;background:#F8FAFC;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border:1px solid #E4E7EB;border-radius:10px;padding:24px">
<h2 style="color:#1E3A5F;margin-top:0">${title}</h2><p style="color:#0F172A;line-height:1.5">${body}</p>
<p><a href="${cta.href}" style="display:inline-block;background:#1E3A5F;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${cta.label}</a></p>
<p style="color:#475569;font-size:12px">If the button does not work, open: ${cta.href}</p></div></body></html>`;
};

export const inviteEmail = (name: string, link: string) => ({ subject: 'You have been invited to OverTrack', html: layout(`Welcome, ${name}`, 'An account was created for you. Set your password to get started. The link is valid for 24 hours.', { label: 'Set password', href: link }) });
export const resetEmail = (name: string, link: string) => ({ subject: 'Reset your OverTrack password', html: layout(`Hi ${name}`, 'We received a request to reset your password. The link is valid for 1 hour. Ignore this email if you did not ask for it.', { label: 'Reset password', href: link }) });
export const genericEmail = (title: string, body: string, cta: { label: string; href: string }) => ({ subject: title, html: layout(title, body, cta) });
