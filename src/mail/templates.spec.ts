import { describe, it, expect } from 'vitest';
import { escapeHtml, inviteEmail, genericEmail } from './templates';

describe('mail templates', () => {
  it('escapes html in names', () => {
    const { html } = inviteEmail('<b>x</b>', 'https://app/set?token=abc');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>x</b>');
  });
  it('escapes title, body and href in generic emails', () => {
    const { html } = genericEmail('<i>t</i>', 'a & <script>', { label: 'Go', href: 'https://x/?a=1&b="2"' });
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<i>t</i>');
    expect(html).toContain('href="https://x/?a=1&amp;b=&quot;2&quot;"');
  });
  it('escapeHtml covers & < > " \'', () => { expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;'); });
});
