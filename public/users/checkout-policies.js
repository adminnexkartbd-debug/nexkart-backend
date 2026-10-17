/* Shared checkout policy acceptance. Default is always unchecked. */
'use strict';
window.NexkartPolicies = {
  version: '2026-10-17',
  requireAcceptance() {
    const checkbox = document.getElementById('policy-acceptance');
    const error = document.getElementById('policy-error');
    const accepted = Boolean(checkbox && checkbox.checked);
    if (error) error.hidden = accepted;
    if (!accepted && checkbox) { checkbox.focus(); checkbox.scrollIntoView({block:'center', behavior:'smooth'}); }
    return accepted;
  },
  payload() { return {policies_accepted: document.getElementById('policy-acceptance')?.checked === true, policy_version: this.version}; }
};
window.addEventListener('pageshow', () => {
  const checkbox = document.getElementById('policy-acceptance');
  if (checkbox) checkbox.checked = false;
});
