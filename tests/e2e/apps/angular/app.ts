/**
 * Angular 18 form, JIT-compiled in the browser.
 *
 * Two Angular form styles behave differently under an external write, so both are
 * present on the page:
 *   - template-driven `[(ngModel)]`, which binds through a directive listening to
 *     native `input`/`change`; and
 *   - `ReactiveFormsModule` with a `FormGroup`, where the source of truth is the
 *     FormControl and the DOM is only a view.
 *
 * Angular also runs change detection inside a zone. A write dispatched from an
 * extension's content script originates outside Angular's zone, so if the
 * directive's listener were not zone-patched the model would update but the view
 * would never repaint. `window.__appState()` reads both models; the test asserts
 * against them rather than against the inputs.
 *
 * JIT (`platformBrowserDynamic`) is used so the template strings below compile at
 * runtime and no Angular build toolchain is required. That is a test-harness
 * choice; it does not change how the directives handle events.
 */
import '@angular/compiler';
import 'zone.js';
import { ApplicationRef, Component, NgModule, inject } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { FormsModule, ReactiveFormsModule, FormControl, FormGroup } from '@angular/forms';

interface NgModelState {
  fullName: string;
  email: string;
  phone: string;
  country: string;
  experience: string;
  newsletter: boolean;
}

@Component({
  selector: 'app-root',
  template: `
    <form id="ng-form" (ngSubmit)="noop()">
      <h1>Angular template-driven form</h1>

      <label for="a-name">Full name</label>
      <input id="a-name" name="fullName" type="text" [(ngModel)]="model.fullName" required />

      <label for="a-email">Email address</label>
      <input id="a-email" name="email" type="email" [(ngModel)]="model.email" required />

      <label for="a-phone">Phone number</label>
      <input id="a-phone" name="phone" type="tel" [(ngModel)]="model.phone" />

      <label for="a-country">Country</label>
      <select id="a-country" name="country" [(ngModel)]="model.country">
        <option value="">Select one</option>
        <option value="India">India</option>
        <option value="United States">United States</option>
        <option value="Germany">Germany</option>
      </select>

      <fieldset>
        <legend>Years of experience</legend>
        <label *ngFor="let band of bands">
          <input type="radio" name="experience" [value]="band" [(ngModel)]="model.experience" />
          {{ band }}
        </label>
      </fieldset>

      <label>
        <input type="checkbox" name="newsletter" [(ngModel)]="model.newsletter" />
        Subscribe to the newsletter
      </label>
      <span data-nudge>{{ nudge }}</span>
    </form>

    <form id="ng-reactive-form" [formGroup]="reactive">
      <h1>Angular reactive form</h1>

      <label for="a-company">Current company</label>
      <input id="a-company" name="company" type="text" formControlName="company" />

      <label for="a-title">Job title</label>
      <input id="a-title" name="jobTitle" type="text" formControlName="jobTitle" />

      <label for="a-cover">Cover letter</label>
      <textarea id="a-cover" name="coverLetter" formControlName="coverLetter" rows="4"></textarea>
    </form>
  `,
})
export class AppComponent {
  bands = ['0-2', '3-5', '6-10'];

  /** Unrelated to the form; bumping it repaints without changing any field. */
  nudge = 0;

  // `inject()` rather than a constructor parameter: esbuild cannot emit decorator
  // metadata, so nothing in this app may depend on parameter-based DI.
  private readonly appRef = inject(ApplicationRef);

  model: NgModelState = {
    fullName: '',
    email: '',
    phone: '',
    country: '',
    experience: '',
    newsletter: false,
  };

  reactive = new FormGroup({
    company: new FormControl(''),
    jobTitle: new FormControl(''),
    coverLetter: new FormControl(''),
  });

  constructor() {
    // Exposed for the E2E harness: reads Angular's models, never the DOM.
    const host = window as unknown as Record<string, unknown>;
    host.__appState = () => ({ ...this.model, ...this.reactive.getRawValue() });
    host.__submitted = false;
    host.__nudge = () => {
      this.nudge += 1;
      // The call arrives from outside Angular's zone, so ask for a pass explicitly.
      this.appRef.tick();
    };
  }

  noop(): void {
    // Recorded, never acted on: the E2E suite asserts FormPilot never triggers this.
    (window as unknown as Record<string, unknown>).__submitted = true;
  }
}

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, FormsModule, ReactiveFormsModule],
  bootstrap: [AppComponent],
})
export class AppModule {}

platformBrowserDynamic()
  .bootstrapModule(AppModule)
  .catch((error: unknown) => {
    (window as unknown as Record<string, unknown>).__bootstrapError = String(error);
  });
