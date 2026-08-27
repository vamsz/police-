import { api } from '../core/api.js';
import { session } from '../core/session.js';
import { $ } from '../core/dom.js';

const tabs = {
  signIn: $('#tabSignIn'),
  register: $('#tabRegister'),
};

const forms = {
  signIn: $('#signInForm'),
  register: $('#registerForm'),
};

const message = $('#message');

// Someone who is already signed in has no business on this page.
if (session.token && session.user) {
  window.location.replace(session.homePath());
}

function showMessage(text, kind = 'error') {
  message.textContent = text;
  message.className = `message message--${kind}`;
  message.hidden = false;
}

function clearMessage() {
  message.hidden = true;
}

function selectTab(name) {
  clearMessage();
  for (const key of Object.keys(tabs)) {
    const isActive = key === name;
    tabs[key].setAttribute('aria-selected', String(isActive));
    forms[key].hidden = !isActive;
  }
}

tabs.signIn.addEventListener('click', () => selectTab('signIn'));
tabs.register.addEventListener('click', () => selectTab('register'));

/**
 * Runs a submit handler with the button disabled and errors surfaced in one
 * place, so no form can be double-submitted or fail silently.
 */
function onSubmit(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage();

    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Please wait…';

    try {
      const { token, user } = await handler(Object.fromEntries(new FormData(form)));
      session.start(token, user);
      window.location.replace(session.homePath());
    } catch (err) {
      showMessage(err.message || 'Something went wrong. Please try again.');
      button.disabled = false;
      button.textContent = label;
    }
  });
}

onSubmit(forms.signIn, (values) => api.login(values.phone.trim(), values.password));

onSubmit(forms.register, (values) =>
  api.register({
    name: values.name.trim(),
    phone: values.phone.trim(),
    email: values.email.trim() || undefined,
    badgeId: values.badgeId.trim() || undefined,
    password: values.password,
    accessCode: values.accessCode,
  })
);
