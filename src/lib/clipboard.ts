// Copies text, falling back to a hidden textarea and execCommand("copy") when
// the async Clipboard API is missing (in-app browsers, non-HTTPS) or refuses
// the write (iOS Safari and some WebViews). Must be called from a user gesture.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  // Off-screen but still selectable; 16px stops iOS from zooming in.
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.fontSize = "16px";
  document.body.appendChild(textarea);

  const previousFocus = document.activeElement as HTMLElement | null;
  try {
    textarea.focus();
    textarea.select();
    // iOS ignores select() on a readonly field; an explicit range works.
    textarea.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("Copy command was refused.");
  } finally {
    textarea.remove();
    previousFocus?.focus?.();
  }
}
