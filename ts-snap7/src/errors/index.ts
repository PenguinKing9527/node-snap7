/**
 * Base error for all library-specific failures.
 *
 * Consumers can catch this class to handle all node-snap7 errors
 * without mixing with generic runtime exceptions.
 */
export class Snap7Error extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7Error";
  }
}

/**
 * Raised for transport-level failures (socket closed, timeout, connect failure).
 */
export class Snap7ConnectionError extends Snap7Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7ConnectionError";
  }
}

/**
 * Raised when PLC packets are malformed or violate protocol expectations.
 */
export class Snap7ProtocolError extends Snap7Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7ProtocolError";
  }
}

/**
 * Temporary placeholder error used while staged tasks are still incomplete.
 */
export class Snap7NotImplementedError extends Snap7Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7NotImplementedError";
  }
}
