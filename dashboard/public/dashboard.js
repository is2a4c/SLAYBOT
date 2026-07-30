// Prevents double-submitting forms (e.g. a moderation action firing twice from
// an impatient double-click) by disabling submit buttons right after submit.
// The form still submits normally - this only blocks a second click.
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((button) => {
    button.disabled = true;
  });
});
