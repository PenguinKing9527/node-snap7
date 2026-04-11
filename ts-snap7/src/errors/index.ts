export class Snap7Error extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7Error";
  }
}

export class Snap7ConnectionError extends Snap7Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7ConnectionError";
  }
}

export class Snap7ProtocolError extends Snap7Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7ProtocolError";
  }
}

export class Snap7NotImplementedError extends Snap7Error {
  public constructor(message: string) {
    super(message);
    this.name = "Snap7NotImplementedError";
  }
}
