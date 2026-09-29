/**
 * Vue 3 form using `v-model` on every control.
 *
 * `v-model` on a text input listens for the native `input` event; on a checkbox
 * or radio it listens for `change`; on a `<select>` it listens for `change` and
 * matches by option value. So this app tests a different contract from React's:
 * the write must emit the right event *type* for each control, not just mutate
 * the value. `window.__appState()` reads Vue's reactive state.
 *
 * The runtime-compiler build is imported on purpose so the template — and
 * therefore the real `v-model` codegen — is what runs, rather than a hand-written
 * render function that would bypass the thing under test.
 */
import { createApp, reactive } from 'vue/dist/vue.esm-bundler.js';

const template = `
  <form id="vue-form" @submit.prevent="onSubmit">
    <h1>Vue controlled form</h1>

    <label for="v-name">Full name</label>
    <input id="v-name" name="fullName" type="text" v-model="fullName" required />

    <label for="v-email">Email address</label>
    <input id="v-email" name="email" type="email" v-model="email" required />

    <label for="v-phone">Phone number</label>
    <input id="v-phone" name="phone" type="tel" v-model="phone" />

    <label for="v-company">Current company</label>
    <input id="v-company" name="company" type="text" v-model="company" />

    <label for="v-title">Job title</label>
    <input id="v-title" name="jobTitle" type="text" v-model="jobTitle" />

    <label for="v-cover">Cover letter</label>
    <textarea id="v-cover" name="coverLetter" v-model="coverLetter" rows="4"></textarea>

    <label for="v-country">Country</label>
    <select id="v-country" name="country" v-model="country">
      <option value="">Select one</option>
      <option value="India">India</option>
      <option value="United States">United States</option>
      <option value="Germany">Germany</option>
    </select>

    <fieldset>
      <legend>Years of experience</legend>
      <label v-for="band in bands" :key="band">
        <input type="radio" name="experience" :value="band" v-model="experience" />
        {{ band }}
      </label>
    </fieldset>

    <label>
      <input type="checkbox" name="newsletter" v-model="newsletter" />
      Subscribe to the newsletter
    </label>

    <label>
      <input type="checkbox" name="terms" v-model="terms" />
      I accept the terms and conditions
    </label>

    <button type="submit">Submit</button>
  </form>
`;

const state = reactive({
  fullName: '',
  email: '',
  phone: '',
  company: '',
  jobTitle: '',
  coverLetter: '',
  country: '',
  experience: '',
  newsletter: false,
  terms: false,
  bands: ['0-2', '3-5', '6-10'],
  // Unrelated to the form; bumping it re-renders without changing any field.
  nudge: 0,
  // Recorded, never acted on: the E2E suite asserts FormPilot never triggers this.
  onSubmit: () => {
    window.__submitted = true;
  },
});

createApp({ template, setup: () => state }).mount('#root');

window.__appState = () => {
  const { bands, nudge, onSubmit, ...rest } = state;
  void bands;
  void nudge;
  void onSubmit;
  return { ...rest };
};

window.__nudge = () => {
  state.nudge += 1;
};

window.__submitted = false;
