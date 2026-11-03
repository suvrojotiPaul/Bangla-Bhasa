import { api } from '../api.js';
import { field } from '../components/field.js';
import { h } from '../dom.js';
import { forgetMe, loadMe } from '../session.js';

const MIN_PASSWORD = 8;

/** Sign in, or create your own account. */
export function mount(root, { go, onError }) {
  document.title = 'Sign in · Bhasha';
  let stopped = false;
  const screen = h('main', { class: 'screen setup login' }, h('p', { class: 'home__loading' }, 'Loading…'));
  root.append(screen);

  async function enter() {
    forgetMe();
    let ready = true;
    try {
      ready = (await api.get('/setup/status')).ready;
    } catch {
      // The next screen explains any problem.
    }
    go(ready ? '/home' : '/setup', { replace: true });
  }

  function render(mode) {
    const signingUp = mode === 'signup';
    document.title = signingUp ? 'Create an account · Bhasha' : 'Sign in · Bhasha';
    const banner = h('div', { 'aria-live': 'polite' });
    const say = (text) => banner.replaceChildren(text ? h('p', { class: 'banner banner--error' }, text) : '');

    const name = signingUp ? field('Your name', { autocomplete: 'name', maxlength: 40 }) : null;
    const username = field('Username', {
      autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 32,
    });
    const password = field('Password', {
      type: 'password',
      reveal: true,
      autocomplete: signingUp ? 'new-password' : 'current-password',
      required: true,
      minlength: signingUp ? MIN_PASSWORD : null,
    });
    const submit = h('button', { class: 'btn btn--primary', type: 'submit' }, signingUp ? 'Create account' : 'Sign in');

    async function onSubmit(event) {
      event.preventDefault();
      say(null);
      submit.disabled = true;
      try {
        if (signingUp) {
          await api.post('/auth/signup', {
            displayName: name.input.value, username: username.input.value, password: password.input.value,
          });
        } else {
          await api.post('/auth/login', { username: username.input.value, password: password.input.value });
        }
        if (!stopped) await enter();
      } catch (err) {
        if (stopped) return;
        submit.disabled = false;
        say(err.message);
        password.input.select();
      }
    }

    const switchMode = (event) => {
      event.preventDefault();
      render(signingUp ? 'signin' : 'signup');
    };

    // replaceChildren() would print a null as the text "null", so leave the missing parts out.
    const parts = [
      h(
        'div',
        { class: 'setup__brand' },
        h('div', { class: 'logo', lang: 'bn', 'aria-hidden': 'true' }, 'ভা'),
        h('h1', { class: 'setup__title' }, 'Bhasha'),
        h('p', { class: 'setup__subtitle' }, signingUp ? 'Create your account' : 'Sign in to your course'),
      ),
      h(
        'form',
        { class: 'card login__form', onSubmit },
        name?.el,
        username.el,
        password.el,
        signingUp
          ? h('p', { class: 'setup__note' }, `Usernames use letters, numbers, dots or dashes. Passwords need at least ${MIN_PASSWORD} characters.`)
          : null,
        banner,
        submit,
      ),
      h(
        'p',
        { class: 'setup__note login__help' },
        signingUp ? 'Already have an account? ' : 'New here? ',
        h('a', { href: '#/login', onClick: switchMode }, signingUp ? 'Sign in' : 'Create an account'),
      ),
      signingUp
        ? null
        : h('p', { class: 'setup__note login__help' }, 'Forgot your password? Ask the admin to set a new one for you.'),
    ];
    screen.replaceChildren(...parts.filter(Boolean));
    (name ?? username).input.focus();
  }

  loadMe()
    .then((me) => {
      if (stopped) return;
      if (me.user) go('/home', { replace: true });
      else render('signin');
    })
    .catch((err) => {
      if (!stopped) onError(err);
    });

  return () => {
    stopped = true;
  };
}
