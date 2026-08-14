/**
 * A server's configured timezone: an IANA zone name (`Europe/Moscow`,
 * `America/New_York`), or nothing, meaning "use UTC".
 *
 * There is exactly one way to check whether Node actually knows a zone name -
 * ask `Intl` to format with it and see whether it throws - so both the
 * dashboard's own input validation and the date formatter that uses the stored
 * value share this rather than each guessing at a regex.
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidTimeZone(value) {
  if (!value) return false;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: value });
    return Boolean(formatter);
  } catch {
    return false;
  }
}

/**
 * @param {string|null|undefined} value
 * @param {string} locale
 * @returns {(value: string|Date) => string} a formatter bound to a real zone,
 *   falling back to UTC for anything empty or Node does not recognise
 */
function dateFormatter(value, locale) {
  const timeZone = isValidTimeZone(value) ? value : "UTC";
  const localeTag = locale === "ru" ? "ru-RU" : "en-GB";
  return (input) => new Date(input).toLocaleString(localeTag, { timeZone });
}

module.exports = { dateFormatter, isValidTimeZone };
