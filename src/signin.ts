/**
 * Sign-in gate: passkey, with an emailed code as the backup. The app doesn't start until this resolves.
 * Built here rather than with the Blocks <Authenticator>, whose sign-in form asks for a password.
 */
import { authApi } from 'aws-blocks';
import { html, render, nothing } from 'lit-html';

const EMAIL_KEY = 'studio.email';
const OFFERED_KEY = 'studio.passkeyOffered';
const api = authApi as any;

type Field = { name: string; defaultValue?: string };
type Action = { name: string; fields: Field[]; capability?: string };
type AuthState = { state: string; actions?: Action[]; error?: string };

export const isSignedOutError = (e: any) => e?.status === 401 || e?.statusCode === 401 || e?.name === 'NotAuthenticatedException';

export async function signOut() {
  await api.setAuthState({ action: 'signOut' }).catch(() => {});
  location.reload();
}

// ─── Passkey ceremonies ──────────────────────────────────────────────────────────

const toBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)).buffer;
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decodeList = (list?: any[]) => list?.map((c) => ({ ...c, id: toBuf(c.id) }));

/** Older browsers lack the JSON helpers, so the options and the result are converted by hand there. */
async function runCeremony(kind: 'get' | 'create', optionsJson: string): Promise<string> {
  const json = JSON.parse(optionsJson);
  const PK = PublicKeyCredential as any;
  let cred: any;
  if (kind === 'get') {
    const publicKey = PK.parseRequestOptionsFromJSON?.(json) ?? { ...json, challenge: toBuf(json.challenge), allowCredentials: decodeList(json.allowCredentials) };
    cred = await navigator.credentials.get({ publicKey });
  } else {
    const publicKey = PK.parseCreationOptionsFromJSON?.(json) ?? { ...json, challenge: toBuf(json.challenge), user: { ...json.user, id: toBuf(json.user.id) }, excludeCredentials: decodeList(json.excludeCredentials) };
    cred = await navigator.credentials.create({ publicKey });
  }
  if (!cred) throw new Error('No passkey was returned.');
  if (typeof cred.toJSON === 'function') return JSON.stringify(cred.toJSON());
  const r = cred.response;
  return JSON.stringify({
    id: cred.id, rawId: toB64(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: r.attestationObject
      ? { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject) }
      : { clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature), userHandle: r.userHandle ? toB64(r.userHandle) : undefined },
  });
}

const hiddenValues = (a: Action) => Object.fromEntries(a.fields.filter((f) => f.defaultValue != null).map((f) => [f.name, f.defaultValue]));
const passkeysWork = () => typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials;

// ─── The screen ──────────────────────────────────────────────────────────────────

export async function requireSignIn(root: HTMLElement): Promise<void> {
  let view: 'start' | 'code' | 'savePasskey' = 'start';
  let email = localStorage.getItem(EMAIL_KEY) ?? '';
  let changingEmail = !email;
  let busy = false;
  let error = '';
  let pending: Action | undefined;
  let closed = false;
  let finish = () => {};

  const fail = (e: any) => {
    if (e?.name === 'NotAllowedError') return 'The passkey request was cancelled. Try again, or email yourself a code.';
    return e?.message ?? String(e);
  };

  /** Runs one step, with the shared busy state and error display. */
  const step = async (work: () => Promise<void>) => {
    busy = true; error = ''; draw();
    try { await work(); } catch (e) { error = fail(e); }
    busy = false; draw();
  };

  const done = (viaCode: boolean) => {
    localStorage.setItem(EMAIL_KEY, email);
    if (viaCode && passkeysWork() && !localStorage.getItem(OFFERED_KEY)) { view = 'savePasskey'; return; }
    finish();
  };

  /** Advances after a sign-in call: signed in, or a challenge to answer. */
  const advance = (s: AuthState, viaCode: boolean) => {
    if (s.state === 'signedIn') { done(viaCode); return; }
    if (s.error) throw new Error(s.error);
    pending = s.actions?.find((a) => a.name === 'confirmSignIn');
    if (!pending) throw new Error('This account can’t sign in that way. Use an emailed code.');
  };

  const sendCode = () => step(async () => {
    email = email.trim().toLowerCase();
    advance(await api.setAuthState({ action: 'signIn', username: email, password: '' }), true);
    if (pending) view = 'code';
  });

  const usePasskey = () => step(async () => {
    advance(await api.setAuthState({ action: 'signInWithPasskey', username: email }), false);
    if (!pending?.capability) throw new Error('No passkey on this account yet. Use an emailed code.');
    const opts = hiddenValues(pending);
    const credential = await runCeremony('get', opts.credentialRequestOptions as string);
    const { credentialRequestOptions: _unused, ...rest } = opts;
    advance(await api.setAuthState({ action: 'confirmSignIn', ...rest, credential }), false);
  });

  const submitCode = (code: string) => step(async () => {
    advance(await api.setAuthState({ action: 'confirmSignIn', ...hiddenValues(pending!), code: code.trim() }), true);
  });

  const savePasskey = () => step(async () => {
    const s: AuthState = await api.setAuthState({ action: 'startPasskeyRegistration' });
    const action = s.actions?.find((a) => a.capability === 'webauthn-create');
    if (!action) throw new Error(s.error ?? 'Couldn’t start saving a passkey.');
    const credential = await runCeremony('create', hiddenValues(action).credentialCreationOptions as string);
    await api.setAuthState({ action: 'completePasskeyRegistration', credential });
    localStorage.setItem(OFFERED_KEY, '1');
    finish();
  });

  const skipPasskey = () => { localStorage.setItem(OFFERED_KEY, '1'); finish(); };

  const primary = 'w-full py-3 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-200 transition disabled:opacity-50';
  const secondary = 'w-full py-3 rounded-xl border border-zinc-800 text-sm text-zinc-200 hover:border-zinc-600 transition disabled:opacity-50';
  const link = 'text-xs text-zinc-500 hover:text-white transition';
  const field = 'w-full px-4 py-3 rounded-xl bg-black border border-zinc-800 text-base text-white outline-none focus:border-zinc-500';

  const startView = () => {
    const known = email && !changingEmail;
    return html`
      ${known ? html`<p class="text-sm text-zinc-400 break-all">${email}</p>` : html`
        <input id="signin-email" class=${field} type="email" autocomplete="username webauthn" placeholder="you@example.com" aria-label="Email" .value=${email}
          @input=${(e: Event) => { email = (e.target as HTMLInputElement).value; }}
          @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && email.trim()) sendCode(); }} />`}
      ${known && passkeysWork() ? html`<button class=${primary} ?disabled=${busy} @click=${usePasskey}>Sign in with passkey</button>` : nothing}
      <button class=${known && passkeysWork() ? secondary : primary} ?disabled=${busy} @click=${() => { if (email.trim()) sendCode(); else error = 'Enter your email first.'; draw(); }}>Email me a code</button>
      ${known ? html`<button class=${link} @click=${() => { changingEmail = true; error = ''; draw(); }}>Use a different email</button>` : nothing}`;
  };

  const codeView = () => html`
    <p class="text-sm text-zinc-400">Enter the code we sent to <span class="text-zinc-200 break-all">${email}</span>.</p>
    <input id="signin-code" class="${field} tracking-widest text-center" inputmode="numeric" autocomplete="one-time-code" aria-label="Code"
      @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') submitCode((e.target as HTMLInputElement).value); }} />
    <button class=${primary} ?disabled=${busy} @click=${() => submitCode((document.getElementById('signin-code') as HTMLInputElement).value)}>Sign in</button>
    <button class=${link} @click=${() => { view = 'start'; error = ''; draw(); }}>Back</button>`;

  const passkeyView = () => html`
    <p class="text-sm text-zinc-400">Next time, sign in with Face ID or your fingerprint instead of waiting for an email.</p>
    <button class=${primary} ?disabled=${busy} @click=${savePasskey}>Save a passkey</button>
    <button class=${link} @click=${skipPasskey}>Not now</button>`;

  function draw() {
    if (closed) return;
    render(html`
      <main class="min-h-screen flex items-center justify-center p-6">
        <div class="w-full max-w-sm rounded-3xl bg-zinc-900/30 border border-zinc-800 p-8 flex flex-col gap-4 text-center">
          <h1 class="text-xl font-semibold text-white">Durable Studio</h1>
          ${view === 'start' ? startView() : view === 'code' ? codeView() : passkeyView()}
          ${error ? html`<p role="alert" class="text-sm text-rose-400">${error}</p>` : nothing}
        </div>
      </main>`, root);
  }

  return new Promise((resolve) => {
    finish = () => { closed = true; render(nothing, root); resolve(); };
    api.getAuthState().then((s: AuthState) => {
      if (s.state === 'signedIn') finish(); else draw();
    }).catch((e: any) => { error = fail(e); draw(); });
  });
}
