export class PermanentDomainEventError extends Error {
  public constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
