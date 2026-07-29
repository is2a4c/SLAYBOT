class SmartInviteError extends Error {
  constructor(code, safeMessage, options = {}) {
    super(safeMessage);
    this.name = "SmartInviteError";
    this.code = code;
    this.safeMessage = safeMessage;
    this.temporary = Boolean(options.temporary);
    this.confirmedInvalid = Boolean(options.confirmedInvalid);
    this.httpStatus = options.httpStatus || 400;
    this.cause = options.cause;
  }
}

module.exports = SmartInviteError;
