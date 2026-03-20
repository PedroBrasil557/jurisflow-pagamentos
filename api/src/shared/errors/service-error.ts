type ServiceErrorStatusCode =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 413
  | 415
  | 500
  | 503

export class ServiceError extends Error {
  constructor(
    public readonly statusCode: ServiceErrorStatusCode,
    message: string,
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}
