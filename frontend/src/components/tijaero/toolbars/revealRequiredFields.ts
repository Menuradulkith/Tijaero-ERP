/**
 * Save buttons stay enabled even while the form is incomplete. Clicking one
 * of them in that state calls revealRequiredFields(): it switches on the
 * highlight for every empty required field (see styles/global.css), scrolls
 * to the first one and tells the user why nothing was saved. The highlight
 * clears itself per field as it gets filled, and everywhere when the form
 * leaves create/edit mode (clearRequiredHighlight).
 */
import { showWarningToast } from "../feedback-extended/toast";

const ATTR = "data-show-required";
const EMPTY_REQUIRED = "input:required:invalid, textarea:required:invalid";

export function clearRequiredHighlight(): void {
  document.documentElement.removeAttribute(ATTR);
}

export function revealRequiredFields(): void {
  document.documentElement.setAttribute(ATTR, "true");

  const first = Array.from(document.querySelectorAll<HTMLElement>(EMPTY_REQUIRED)).find(
    (el) => el.offsetParent !== null || el.closest(".MuiFormControl-root")?.getClientRects().length,
  );

  if (first) {
    const target = first.closest<HTMLElement>(".MuiFormControl-root") ?? first;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // A native select/autocomplete input may be hidden; focusing is best-effort.
    if (first.offsetParent !== null) first.focus({ preventScroll: true });
    showWarningToast("Please fill in the highlighted mandatory fields before saving.");
  } else {
    showWarningToast("Please complete all required information before saving.");
  }
}

/**
 * Click handler for a wizard's Next button, which stays enabled even while the
 * step is incomplete: when the step is valid it moves on (clearing any
 * highlight left from an earlier attempt), otherwise it highlights what is
 * missing and stays put.
 */
export function continueOrReveal(isValid: boolean, proceed: () => void): void {
  if (isValid) {
    clearRequiredHighlight();
    proceed();
  } else {
    revealRequiredFields();
  }
}
